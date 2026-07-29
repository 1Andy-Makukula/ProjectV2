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
 * A failed transfer reverses the wallet debit through `fail_withdrawal`.
 * Leaving it debited would take the merchant's money and deliver nothing.
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
      return json({ success: true, claimed: 0, paid: 0, failed: 0, results: [] });
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

        const flwResponse = await fetch("https://api.flutterwave.com/v3/transfers", {
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

        const flwResult = await flwResponse.json();

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
      results,
    });
  } catch (unhandled: unknown) {
    const message = unhandled instanceof Error ? unhandled.message : String(unhandled);
    console.error("[batch-payout-sweeper] Unhandled exception:", message);
    return json({ error: "Internal server error." }, 500);
  }
});
