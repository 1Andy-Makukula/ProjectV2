/**
 * payout-dispatcher
 *
 * Drains `payout_instructions` — the queue the redemption path fills — and
 * pays merchants over their verified rail.
 *
 * WHY THIS EXISTS ALONGSIDE batch-payout-sweeper
 * ----------------------------------------------
 * The sweeper pays merchant *withdrawal requests*: a merchant banked with
 * KithLy, accrued a balance, and asked for it. That whole model is stored
 * value, and §9 of the settlement model removes it.
 *
 * This dispatcher pays *instructions*, which nobody requests. A redemption
 * creates one automatically, timed by the merchant's settlement tier. There is
 * no balance and nothing to ask for. The sweeper survives only until
 * `escrow_mode` reaches `escrow_v2`, at which point its queue can no longer be
 * filled — `merchant_withdrawals` refuses inserts — and it drains to empty and
 * stays there.
 *
 * THE RULE THAT MATTERS
 * ---------------------
 * Three outcomes, not two. `ok` completes, `failed` retries or abandons, and
 * `unknown` does NEITHER: the row is left in SENT with its reference, because
 * the money may be in flight and both retrying and reversing would be wrong.
 * A row stuck in SENT is an operational alert, resolved by asking the rail what
 * happened to that reference (`?resolve=1`), never by guessing.
 *
 * Deploy: `supabase functions deploy payout-dispatcher`, then invoke on a
 * schedule with the `x-dispatcher-secret` header. Safe to run often; it returns
 * immediately when nothing is due.
 */

import { isServiceRoleCaller, createAdminClient } from "../_shared/auth.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import {
  airtelConfig,
  airtelDisburse,
  airtelEnquire,
  type RailOutcome,
} from "../_shared/airtel.ts";

function dispatcherCors(req: Request): Record<string, string> {
  return {
    ...getCorsHeaders(req),
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-dispatcher-secret",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

interface ClaimedPayout {
  id: string;
  shop_id: string;
  shop_order_id: string | null;
  rail: string;
  account_identifier: string;
  account_name: string | null;
  amount_ngwee: number;
  idempotency_key: string;
  attempt_count: number;
}

Deno.serve(async (req: Request) => {
  const cors = dispatcherCors(req);

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const authorised = await isServiceRoleCaller(req, "PAYOUT_DISPATCHER_SECRET");
  if (authorised instanceof Response) return authorised;

  const admin = createAdminClient("payout-dispatcher");

  const url = new URL(req.url);
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 25) || 25, 100);
  const resolveStuck = url.searchParams.get("resolve") === "1";

  const results: Record<string, unknown>[] = [];

  // ---------------------------------------------------------------------
  // Optional first pass: resolve rows parked in SENT.
  //
  // Only ever asks the rail. It never decides an outcome on its own, because
  // the entire reason these rows are parked is that we do not know.
  // ---------------------------------------------------------------------
  if (resolveStuck) {
    const { data: stuck } = await admin
      .from("payout_instructions")
      .select("id, rail, idempotency_key, external_ref, sent_at")
      .eq("status", "SENT")
      .lt("sent_at", new Date(Date.now() - 5 * 60 * 1000).toISOString())
      .limit(limit);

    for (const row of stuck ?? []) {
      if (row.rail !== "airtel_money") continue;

      let outcome: RailOutcome;
      try {
        outcome = await airtelEnquire(airtelConfig(), row.idempotency_key);
      } catch (e) {
        results.push({ id: row.id, phase: "resolve", outcome: "unknown", error: String(e) });
        continue;
      }

      if (outcome.result === "ok") {
        await admin.rpc("complete_payout", {
          p_instruction_id: row.id,
          p_external_ref: outcome.providerId,
        });
        results.push({ id: row.id, phase: "resolve", outcome: "settled" });
      } else if (outcome.result === "failed") {
        await admin.rpc("fail_payout", {
          p_instruction_id: row.id,
          p_error: `Resolved as failed: ${outcome.reason}`,
          p_retryable: true,
        });
        results.push({ id: row.id, phase: "resolve", outcome: "failed" });
      } else {
        results.push({ id: row.id, phase: "resolve", outcome: "still unknown" });
      }
    }
  }

  // ---------------------------------------------------------------------
  // Claim what is due. SKIP LOCKED inside the RPC means two overlapping runs
  // cannot take the same instruction.
  // ---------------------------------------------------------------------
  const { data: claimed, error: claimError } = await admin.rpc("claim_due_payouts", {
    p_limit: limit,
  });

  if (claimError) {
    return new Response(
      JSON.stringify({ error: "Failed to claim payouts", detail: claimError.message }),
      { status: 500, headers: { ...cors, "Content-Type": "application/json" } },
    );
  }

  const batch = (claimed ?? []) as ClaimedPayout[];

  for (const payout of batch) {
    // A rail we have no adapter for must not be silently skipped: the money is
    // owed and the instruction would sit claimed forever. Fail it explicitly
    // so ops sees it, and keep it retryable so adding the adapter fixes it.
    if (payout.rail !== "airtel_money") {
      await admin.rpc("fail_payout", {
        p_instruction_id: payout.id,
        p_error: `No dispatcher adapter for rail '${payout.rail}'. Bank transfers are settled manually until one exists.`,
        p_retryable: true,
      });
      results.push({ id: payout.id, rail: payout.rail, outcome: "no adapter" });
      continue;
    }

    let cfg;
    try {
      cfg = airtelConfig();
    } catch (e) {
      // Misconfiguration is not the merchant's fault and must not burn their
      // retry budget: stop the whole run instead.
      return new Response(
        JSON.stringify({
          error: "Airtel is not configured",
          detail: String(e),
          claimed: batch.length,
          note: "Claimed instructions stay CLAIMED and will be retried once configured.",
        }),
        { status: 503, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    // Recorded as SENT *before* the call. If this isolate dies mid-request the
    // row shows that money may be in flight, rather than looking untouched and
    // inviting a second attempt.
    await admin.rpc("mark_payout_sent", {
      p_instruction_id: payout.id,
      p_external_ref: null,
    });

    let outcome: RailOutcome;
    try {
      outcome = await airtelDisburse(cfg, {
        e164: payout.account_identifier,
        amountNgwee: payout.amount_ngwee,
        reference: payout.idempotency_key,
      });
    } catch (e) {
      outcome = { result: "unknown", reason: `threw: ${(e as Error).message}` };
    }

    if (outcome.result === "ok") {
      const { error } = await admin.rpc("complete_payout", {
        p_instruction_id: payout.id,
        p_external_ref: outcome.providerId,
      });
      results.push({
        id: payout.id,
        amount_ngwee: payout.amount_ngwee,
        outcome: error ? "settled-but-unrecorded" : "settled",
        external_ref: outcome.providerId,
        ...(error ? { detail: error.message } : {}),
      });
    } else if (outcome.result === "failed") {
      await admin.rpc("fail_payout", {
        p_instruction_id: payout.id,
        p_error: outcome.reason,
        p_retryable: true,
      });
      results.push({
        id: payout.id,
        amount_ngwee: payout.amount_ngwee,
        outcome: "failed",
        reason: outcome.reason,
      });
    } else {
      // Left in SENT deliberately. Not failed (would retry and risk a double
      // payment), not settled (we have no confirmation the money arrived).
      results.push({
        id: payout.id,
        amount_ngwee: payout.amount_ngwee,
        outcome: "unknown",
        reason: outcome.reason,
        action: "Parked in SENT. Resolve with ?resolve=1 once Airtel answers.",
      });
    }
  }

  const settled = results.filter((r) => r.outcome === "settled").length;
  const unknown = results.filter((r) => r.outcome === "unknown").length;

  return new Response(
    JSON.stringify({
      claimed: batch.length,
      settled,
      failed: results.filter((r) => r.outcome === "failed").length,
      unknown,
      ...(unknown > 0
        ? { warning: `${unknown} payout(s) have an unknown outcome and need resolving.` }
        : {}),
      results,
    }),
    { status: 200, headers: { ...cors, "Content-Type": "application/json" } },
  );
});
