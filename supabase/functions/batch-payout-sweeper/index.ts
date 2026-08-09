/**
 * batch-payout-sweeper
 *
 * Pays out merchant withdrawal requests over Flutterwave transfers.
 *
 * This function previously read `shop_orders` where payout_status was
 * 'PENDING_BATCH' — a value nothing in the codebase ever set, so it never
 * transferred anything. It also deducted 8% or 10% from the merchant, which was
 * the old pricing model; the merchant now gives up 2% and the buyer pays the
 * rest, so recomputing fees here would underpay every shop.
 *
 * It now works the withdrawal queue instead. That is both correct and safer:
 *
 *   - No double payment. `request_withdrawal_atomic` already debited the
 *     merchant's wallet, so a transfer fulfils an existing debit rather than
 *     creating a second payment on top of the settled balance.
 *   - No arithmetic. A withdrawal is exactly the amount the merchant asked for;
 *     fees were applied at settlement and are long since accounted for.
 *   - No double dispatch. `claim_withdrawal_batch` claims rows with SKIP
 *     LOCKED, so two overlapping runs cannot wire the same money twice.
 *
 * A transfer Flutterwave definitely rejected reverses the wallet debit through
 * `fail_withdrawal`. Leaving it debited would take the merchant's money and
 * deliver nothing.
 *
 * A transfer whose outcome is UNKNOWN -- the request threw rather than
 * answering -- is parked as `unverified` with the debit intact, because the
 * money may well be in flight. Reversing there would pay the merchant and
 * refund them for it. The deterministic reference prevents a duplicate
 * request; only this prevents a duplicate credit. Resolution means asking
 * Flutterwave what became of that reference, then reopening the row and
 * completing or failing it normally.
 *
 *   - No guessed routing codes. `claim_withdrawal_batch` resolves each
 *     withdrawal's payout method against `payout_bank_codes`, which starts
 *     every destination — mobile money included — as unverified (see
 *     20260729000000_payout_bank_verification.sql). This function refuses to
 *     dispatch a transfer unless that lookup came back verified, and fails
 *     the withdrawal (refunding the merchant) instead of risking a silent
 *     misroute on an unconfirmed code.
 */

import { createClient } from "jsr:@supabase/supabase-js@2.49.8";

const corsHeaders: HeadersInit = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-sweeper-secret",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

interface ClaimedWithdrawal {
  withdrawal_id: string;
  shop_id: string;
  shop_name: string;
  amount: number;
  payout_method: string | null;
  payout_details: string | null;
  payout_account_name: string | null;
  bank_category: string | null;
  flutterwave_code: string | null;
  is_verified: boolean;
}

/**
 * The subset of Flutterwave's POST /v3/transfers response this function reads.
 *
 * Every field is optional: an error response carries `status` and `message` but
 * no `data`, and the point of typing it is to force the failure path to be
 * handled rather than to assume the success shape.
 */
interface FlutterwaveTransferResponse {
  status?: string;
  message?: string;
  data?: {
    id?: number | string;
  };
}

/** GET /v3/transfers?reference=… — the list shape, filtered to one reference. */
interface FlutterwaveTransferLookup {
  status?: string;
  message?: string;
  data?: Array<{
    id?: number | string;
    /** Flutterwave's own lifecycle: NEW, PENDING, SUCCESSFUL, FAILED. */
    status?: string;
    reference?: string;
  }>;
}

/**
 * Settle withdrawals whose dispatch outcome was never learned.
 *
 * Asks Flutterwave what became of each parked reference and resolves only on an
 * unambiguous answer. Everything else is deliberately left `unverified` for a
 * human, including a lookup that returns no rows at all: an empty result could
 * mean the transfer never landed, or it could mean the query was wrong, the
 * index was lagging, or the endpoint changed. Reversing a merchant's debit on
 * the strength of a negative result from an API call that might simply have
 * failed to find something is the same class of guess that made unknown
 * outcomes dangerous in the first place.
 *
 * Being stuck is recoverable and visible. Being wrongly reversed is neither.
 */
async function resolveUnverifiedWithdrawals(
  supabase: ReturnType<typeof getAdminClient>,
  flutterwaveSecretKey: string,
): Promise<{ checked: number; completed: number; failed: number; stillUnverified: number }> {
  const summary = { checked: 0, completed: 0, failed: 0, stillUnverified: 0 };

  const { data: parked, error } = await supabase
    .from("merchant_withdrawals")
    .select("id, shop_id, amount")
    .eq("status", "unverified")
    .order("created_at", { ascending: true })
    .limit(25);

  if (error) {
    console.error("[batch-payout-sweeper] Could not load unverified withdrawals:", error.message);
    return summary;
  }
  if (!parked || parked.length === 0) return summary;

  console.warn(
    `[batch-payout-sweeper] ${parked.length} withdrawal(s) awaiting verification — resolving.`,
  );

  for (const w of parked) {
    summary.checked += 1;
    const reference = `kithly-withdrawal-${w.id}`;

    let lookup: FlutterwaveTransferLookup;
    try {
      const res = await fetch(
        `https://api.flutterwave.com/v3/transfers?reference=${encodeURIComponent(reference)}`,
        { headers: { Authorization: `Bearer ${flutterwaveSecretKey}` } },
      );
      lookup = await res.json();
      if (!res.ok) throw new Error(lookup.message ?? `HTTP ${res.status}`);
    } catch (err: unknown) {
      console.error(
        `[batch-payout-sweeper] Lookup failed for '${reference}': ${
          err instanceof Error ? err.message : String(err)
        }. Leaving unverified.`,
      );
      summary.stillUnverified += 1;
      continue;
    }

    const match = lookup.data?.find((t) => t.reference === reference) ?? lookup.data?.[0];
    const providerStatus = match?.status?.toUpperCase();

    // Only these two are acted on. NEW and PENDING mean it is still in flight,
    // and an absent match means nothing conclusive at all.
    if (providerStatus !== "SUCCESSFUL" && providerStatus !== "FAILED") {
      console.warn(
        `[batch-payout-sweeper] '${reference}' is inconclusive (provider status: ` +
          `${providerStatus ?? "no match"}). Leaving unverified for review.`,
      );
      summary.stillUnverified += 1;
      continue;
    }

    // Back to `processing` so the existing terminal transitions apply unchanged.
    const { error: reopenError } = await supabase.rpc("reopen_unverified_withdrawal", {
      p_withdrawal_id: w.id,
    });
    if (reopenError) {
      console.error(
        `[batch-payout-sweeper] Could not reopen '${reference}': ${reopenError.message}`,
      );
      summary.stillUnverified += 1;
      continue;
    }

    if (providerStatus === "SUCCESSFUL") {
      const { error: completeError } = await supabase.rpc("complete_withdrawal", {
        p_withdrawal_id: w.id,
        p_transfer_id: String(match?.id ?? ""),
        p_reference: reference,
      });
      if (completeError) {
        // Reopened but not completed: the row sits in `processing`, where it is
        // visible rather than lost. Flagged loudly because the money did move.
        console.error(
          `[batch-payout-sweeper] TRANSFER SUCCEEDED BUT NOT RECORDED for '${reference}': ${completeError.message}`,
        );
        summary.stillUnverified += 1;
        continue;
      }
      summary.completed += 1;
      console.log(`[batch-payout-sweeper] '${reference}' confirmed paid by provider.`);
    } else {
      const { error: failError } = await supabase.rpc("fail_withdrawal", {
        p_withdrawal_id: w.id,
        p_reason: "Provider reported the transfer failed (resolved from unverified)",
      });
      if (failError) {
        console.error(
          `[batch-payout-sweeper] Could not fail '${reference}': ${failError.message}`,
        );
        summary.stillUnverified += 1;
        continue;
      }
      summary.failed += 1;
      console.log(`[batch-payout-sweeper] '${reference}' confirmed failed; debit reversed.`);
    }
  }

  return summary;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function getAdminClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!url || !serviceRoleKey) {
    throw new Error(
      "[batch-payout-sweeper] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not configured.",
    );
  }

  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

/** Mobile money numbers are normalised to 260XXXXXXXXX. */
function normaliseAccount(category: string | null, rawDetails: string): string {
  const account = rawDetails.trim();
  if (category !== "mobile_money") return account;

  const digits = account.replace(/\D/g, "");
  return digits.length >= 9 ? `260${digits.slice(-9)}` : account;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method === "GET") {
    return json({ status: "ok", service: "batch-payout-sweeper" });
  }

  if (req.method !== "POST") {
    return json({ error: `Method '${req.method}' is not allowed. Use POST.` }, 405);
  }

  const authHeader = req.headers.get("Authorization");
  const incomingSecret =
    req.headers.get("x-sweeper-secret") ||
    (authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null);
  const expectedSecret =
    Deno.env.get("BATCH_PAYOUT_SWEEPER_SECRET") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (expectedSecret && incomingSecret !== expectedSecret) {
    console.error("[batch-payout-sweeper] Unauthorized payout sweep request.");
    return json({ error: "Unauthorized." }, 401);
  }

  let supabase;
  try {
    supabase = getAdminClient();
  } catch (err: unknown) {
    console.error(err instanceof Error ? err.message : String(err));
    return json({ error: "Server configuration error." }, 500);
  }

  const flutterwaveSecretKey = Deno.env.get("FLUTTERWAVE_SECRET_KEY");
  if (!flutterwaveSecretKey) {
    console.error("[batch-payout-sweeper] FLUTTERWAVE_SECRET_KEY is not configured.");
    return json({ error: "Flutterwave keys not configured." }, 500);
  }

  // Resolve anything parked as `unverified` before dispatching new work.
  //
  // Runs first so a withdrawal whose outcome was unknown is settled against
  // Flutterwave's own record before this run can add more of them. Failures
  // here are logged, never fatal: an unresolved row simply stays unverified,
  // which is the safe state.
  const resolved = await resolveUnverifiedWithdrawals(supabase, flutterwaveSecretKey);

  try {
    const { data: claimed, error: claimError } = await supabase.rpc("claim_withdrawal_batch", {
      p_limit: 25,
    });

    if (claimError) {
      console.error("[batch-payout-sweeper] Failed to claim withdrawals:", claimError.message);
      return json({ error: "Failed to claim withdrawals." }, 500);
    }

    const withdrawals = (claimed ?? []) as ClaimedWithdrawal[];

    if (withdrawals.length === 0) {
      return json({
        success: true,
        claimed: 0,
        paid: 0,
        failed: 0,
        verification: resolved,
        results: [],
      });
    }

    const results: Array<Record<string, unknown>> = [];
    let paid = 0;
    let failed = 0;

    for (const w of withdrawals) {
      // A shop with no payout destination cannot be paid; reverse it rather
      // than leaving the request stuck in processing forever.
      if (!w.payout_method || !w.payout_details?.trim()) {
        await supabase.rpc("fail_withdrawal", {
          p_withdrawal_id: w.withdrawal_id,
          p_reason: "No payout method or account details on file for this shop.",
        });
        failed += 1;
        results.push({
          withdrawal_id: w.withdrawal_id,
          shop_name: w.shop_name,
          status: "FAILED",
          message: "Missing payout details.",
        });
        continue;
      }

      // claim_withdrawal_batch resolves payout_method/payout_bank_name against
      // payout_bank_codes. Nothing dispatches on a guessed code: every row in
      // that table starts unverified (see 20260729000000_payout_bank_verification.sql
      // for why — Flutterwave's own documented bank-list endpoint does not
      // cover Zambia, so there was never a way to look these up). A human has
      // to confirm the real code against a live Flutterwave account and flip
      // is_verified before this shop can be paid automatically.
      if (!w.is_verified || !w.flutterwave_code) {
        const reason = w.bank_category
          ? `Payout method '${w.payout_method}' is not yet verified for automated transfer. An admin needs to confirm the real Flutterwave routing code before this can be paid out.`
          : `Payout destination for '${w.payout_method}' is not recognised. Please re-select a payout method and bank in shop settings.`;
        await supabase.rpc("fail_withdrawal", {
          p_withdrawal_id: w.withdrawal_id,
          p_reason: reason,
        });
        failed += 1;
        results.push({
          withdrawal_id: w.withdrawal_id,
          shop_name: w.shop_name,
          status: "NEEDS_VERIFICATION",
          message: reason,
        });
        continue;
      }

      const accountNumber = normaliseAccount(w.bank_category, w.payout_details);
      const amountZmw = w.amount / 100;
      const reference = `kithly-withdrawal-${w.withdrawal_id}`;

      try {
        console.log(
          `[batch-payout-sweeper] Transfer: shop='${w.shop_name}' amount=${amountZmw} ZMW bank='${w.flutterwave_code}' ref='${reference}'`,
        );

        // The dispatch is isolated from everything after it.
        //
        // A thrown error here -- socket timeout, dropped connection, DNS
        // failure -- means the request may already have reached Flutterwave and
        // be in flight. Treating that as a failure and reversing the debit pays
        // the merchant AND gives them their balance back. The reference stops a
        // duplicate request being accepted; it does nothing about a reversal
        // for a transfer that actually succeeded.
        //
        // So an unknown outcome parks the row in `unverified` and leaves the
        // debit standing, to be resolved against Flutterwave out of band. Only
        // a definite rejection below reverses anything.
        let flwResponse: Response;
        let flwResult: FlutterwaveTransferResponse;
        try {
          flwResponse = await fetch("https://api.flutterwave.com/v3/transfers", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${flutterwaveSecretKey}`,
            },
            body: JSON.stringify({
              account_bank: w.flutterwave_code,
              account_number: accountNumber,
              amount: amountZmw,
              currency: "ZMW",
              narration: `KithLy payout - ${w.shop_name}`,
              ...(w.payout_account_name ? { beneficiary_name: w.payout_account_name } : {}),
              // Derived from the withdrawal id, so a retry of the same withdrawal
              // is recognisable to Flutterwave rather than looking like new work.
              reference,
            }),
          });

          flwResult = await flwResponse.json();
        } catch (dispatchErr: unknown) {
          // Also covers a malformed/truncated body from .json(): if the
          // response cannot be read, the outcome is not known either.
          const message =
            dispatchErr instanceof Error ? dispatchErr.message : String(dispatchErr);

          console.error(
            `[batch-payout-sweeper] UNKNOWN OUTCOME for withdrawal ${w.withdrawal_id} ` +
              `(ref '${reference}'): ${message}. Debit left in place, not reversed.`,
          );

          await supabase.rpc("mark_withdrawal_unverified", {
            p_withdrawal_id: w.withdrawal_id,
            p_reason: `Dispatch outcome unknown: ${message}`.slice(0, 300),
          });

          failed += 1;
          results.push({
            withdrawal_id: w.withdrawal_id,
            shop_name: w.shop_name,
            status: "UNVERIFIED",
            transfer_reference: reference,
            message,
          });
          continue;
        }

        // Past this point Flutterwave answered, so any failure is definite and
        // reversing the debit is correct.
        if (!flwResponse.ok || flwResult.status !== "success") {
          throw new Error(flwResult.message ?? JSON.stringify(flwResult));
        }

        const { error: completeError } = await supabase.rpc("complete_withdrawal", {
          p_withdrawal_id: w.withdrawal_id,
          p_transfer_id: String(flwResult.data?.id ?? ""),
          p_reference: reference,
        });

        if (completeError) {
          // The money has left. Do not reverse — flag it loudly for a human,
          // because reversing here would credit a balance that was genuinely
          // paid out.
          console.error(
            `[batch-payout-sweeper] TRANSFER SENT BUT NOT RECORDED for withdrawal ${w.withdrawal_id}: ${completeError.message}`,
          );
          results.push({
            withdrawal_id: w.withdrawal_id,
            shop_name: w.shop_name,
            status: "NEEDS_RECONCILIATION",
            transfer_reference: reference,
            message: completeError.message,
          });
          continue;
        }

        paid += 1;
        results.push({
          withdrawal_id: w.withdrawal_id,
          shop_name: w.shop_name,
          status: "PAID",
          amount: amountZmw,
          transfer_id: String(flwResult.data?.id ?? ""),
        });
      } catch (transferErr: unknown) {
        // Definite failures only. An unknown dispatch outcome is handled at the
        // fetch itself and never reaches here, so reversing the debit is safe.
        const message =
          transferErr instanceof Error ? transferErr.message : String(transferErr);
        console.error(`[batch-payout-sweeper] Transfer failed for '${w.shop_name}':`, message);

        await supabase.rpc("fail_withdrawal", {
          p_withdrawal_id: w.withdrawal_id,
          p_reason: message.slice(0, 300),
        });

        failed += 1;
        results.push({
          withdrawal_id: w.withdrawal_id,
          shop_name: w.shop_name,
          status: "FAILED",
          message,
        });
      }
    }

    return json({
      success: true,
      claimed: withdrawals.length,
      paid,
      failed,
      // Surfaced in the response, not just the logs: a non-zero
      // stillUnverified is money in an unknown state and wants a human.
      verification: resolved,
      results,
    });
  } catch (unhandled: unknown) {
    const message = unhandled instanceof Error ? unhandled.message : String(unhandled);
    console.error("[batch-payout-sweeper] Unhandled exception:", message);
    return json({ error: "Internal server error." }, 500);
  }
});
