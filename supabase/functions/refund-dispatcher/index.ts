/**
 * refund-dispatcher
 *
 * Returns money to the card or account the sender paid with (§4.5).
 *
 * WHY THIS DID NOT EXIST UNTIL NOW
 * --------------------------------
 * The escrow model shipped `claim_due_refunds`, `complete_refund` and
 * `fail_refund` and nothing that called them. Refunds landed in SCHEDULED and
 * sat there. Writing this function is what surfaced two defects in the path it
 * drives -- refunds addressed to KithLy's own reference rather than the
 * gateway's charge id, and the buyer's service fee never leaving the sender's
 * liability -- both fixed in 20260917000000. That is the usual lesson: an
 * unexercised code path is an untested one, however carefully it was written.
 *
 * THE SAME THREE-OUTCOME RULE AS PAYOUTS
 * --------------------------------------
 * `ok` completes, `failed` retries or holds, and `unknown` does NEITHER. A
 * timeout means the refund may already be moving; retrying it would refund
 * twice and there is no way to claw the second one back. An unknown leaves the
 * row in SENT for a human, exactly as a stuck payout does.
 *
 * WHAT IT REFUSES TO DO
 * ---------------------
 * It performs no currency arithmetic. `refund_charge_instruction` decides which
 * charge, which currency and how much -- including the foreign-currency case,
 * where the refund is a proportion of the original charge rather than a
 * conversion of a kwacha figure. If that function declines, this one records
 * why and moves on rather than improvising an amount.
 *
 * Deploy: `supabase functions deploy refund-dispatcher`, then schedule with the
 * `x-dispatcher-secret` header. Hourly is ample -- refunds are not urgent in
 * the way a merchant payout is, and a slower cadence keeps the retry backoff
 * meaningful.
 */

import { isServiceRoleCaller, createAdminClient } from "../_shared/auth.ts";
import { getCorsHeaders } from "../_shared/cors.ts";

function dispatcherCors(req: Request): Record<string, string> {
  return {
    ...getCorsHeaders(req),
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-dispatcher-secret",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

interface ClaimedRefund {
  id: string;
  buyer_id: string;
  transaction_id: string | null;
  amount_ngwee: number;
  original_ref: string | null;
  idempotency_key: string;
  attempt_count: number;
}

interface ChargeInstruction {
  ok: boolean;
  reason?: string;
  detail?: string;
  gateway_charge_id?: string;
  currency?: string;
  amount_minor?: number;
  amount_major?: string;
  is_foreign?: boolean;
}

type Outcome =
  | { result: "ok"; providerId: string }
  | { result: "failed"; reason: string }
  | { result: "unknown"; reason: string };

/**
 * Flutterwave refund. `POST /v3/transactions/{id}/refund`, amount in major
 * units.
 *
 * A 5xx or a thrown request is `unknown`, never `failed`: the refund may have
 * been accepted and we simply did not hear about it.
 */
async function flutterwaveRefund(
  secretKey: string,
  chargeId: string,
  amountMajor: string,
): Promise<Outcome> {
  let res: Response;
  try {
    res = await fetch(
      `https://api.flutterwave.com/v3/transactions/${encodeURIComponent(chargeId)}/refund`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${secretKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ amount: amountMajor }),
      },
    );
  } catch (e) {
    return { result: "unknown", reason: `network: ${(e as Error).message}` };
  }

  const body = await res.json().catch(() => ({}));

  if (res.status >= 500) {
    return { result: "unknown", reason: `Flutterwave returned ${res.status}` };
  }

  if (res.ok && body?.status === "success") {
    const state = body?.data?.status;
    // A refund Flutterwave has accepted but not settled is not yet money
    // returned. Treated as unknown so it is resolved rather than assumed.
    if (state && state !== "completed" && state !== "successful") {
      return {
        result: "unknown",
        reason: `Flutterwave reports the refund as '${state}'`,
      };
    }
    return { result: "ok", providerId: String(body?.data?.id ?? chargeId) };
  }

  return {
    result: "failed",
    reason: body?.message ?? `Flutterwave rejected the refund (${res.status})`,
  };
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

  const secretKey = Deno.env.get("FLUTTERWAVE_SECRET_KEY");
  if (!secretKey) {
    console.error("[refund-dispatcher] FLUTTERWAVE_SECRET_KEY is not configured.");
    // Nothing is claimed, so nothing burns a retry for a misconfiguration that
    // is ours rather than the sender's.
    return new Response(
      JSON.stringify({ error: "Refunds are not configured." }),
      { status: 503, headers: { ...cors, "Content-Type": "application/json" } },
    );
  }

  const admin = createAdminClient("refund-dispatcher");
  const url = new URL(req.url);
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 25) || 25, 100);

  const { data: claimed, error: claimError } = await admin.rpc("claim_due_refunds", {
    p_limit: limit,
  });

  if (claimError) {
    return new Response(
      JSON.stringify({ error: "Failed to claim refunds", detail: claimError.message }),
      { status: 500, headers: { ...cors, "Content-Type": "application/json" } },
    );
  }

  const batch = (claimed ?? []) as ClaimedRefund[];
  const results: Record<string, unknown>[] = [];

  for (const refund of batch) {
    // What to send, decided in SQL. This function does no currency arithmetic
    // of its own -- see the header.
    const { data: instructionData, error: instructionError } = await admin.rpc(
      "refund_charge_instruction",
      { p_refund_id: refund.id },
    );

    if (instructionError) {
      await admin.rpc("fail_refund", {
        p_refund_id: refund.id,
        p_error: `Could not build a refund instruction: ${instructionError.message}`,
        p_retryable: true,
      });
      results.push({ id: refund.id, outcome: "failed", reason: instructionError.message });
      continue;
    }

    const instruction = instructionData as unknown as ChargeInstruction;

    if (!instruction?.ok) {
      // A refund we structurally cannot issue -- no gateway id, charge already
      // fully refunded, rounds to nothing. Not retryable: nothing about waiting
      // changes any of them, and retrying would hide the row behind a backoff
      // instead of putting it in front of a person.
      await admin.rpc("fail_refund", {
        p_refund_id: refund.id,
        p_error: `${instruction?.reason ?? "UNKNOWN"}: ${instruction?.detail ?? "no instruction could be built"}`,
        p_retryable: false,
      });
      results.push({
        id: refund.id,
        outcome: "cannot-issue",
        reason: instruction?.reason,
      });
      continue;
    }

    const outcome = await flutterwaveRefund(
      secretKey,
      instruction.gateway_charge_id!,
      instruction.amount_major!,
    );

    if (outcome.result === "ok") {
      const { error } = await admin.rpc("complete_refund", {
        p_refund_id: refund.id,
        p_external_ref: outcome.providerId,
      });
      results.push({
        id: refund.id,
        outcome: error ? "refunded-but-unrecorded" : "refunded",
        currency: instruction.currency,
        amount: instruction.amount_major,
        ...(error ? { detail: error.message } : {}),
      });
    } else if (outcome.result === "failed") {
      await admin.rpc("fail_refund", {
        p_refund_id: refund.id,
        p_error: outcome.reason,
        p_retryable: true,
      });
      results.push({ id: refund.id, outcome: "failed", reason: outcome.reason });
    } else {
      // Left CLAIMED with the attempt counted. Not completed -- we have no
      // confirmation the money went. Not failed -- a retry could refund twice,
      // and unlike a payout there is no idempotency key the gateway honours on
      // a refund, so the only safe move is to stop and ask a human.
      results.push({
        id: refund.id,
        outcome: "unknown",
        reason: outcome.reason,
        action: "Left claimed. Check Flutterwave for a refund against this charge before retrying.",
      });
    }
  }

  const unknown = results.filter((r) => r.outcome === "unknown").length;

  return new Response(
    JSON.stringify({
      claimed: batch.length,
      refunded: results.filter((r) => r.outcome === "refunded").length,
      failed: results.filter((r) => r.outcome === "failed").length,
      cannot_issue: results.filter((r) => r.outcome === "cannot-issue").length,
      unknown,
      ...(unknown > 0
        ? { warning: `${unknown} refund(s) have an unknown outcome and must be checked by hand.` }
        : {}),
      results,
    }),
    { status: 200, headers: { ...cors, "Content-Type": "application/json" } },
  );
});
