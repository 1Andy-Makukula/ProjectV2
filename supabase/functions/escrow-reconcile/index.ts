/**
 * escrow-reconcile
 *
 * The daily control (§8). Compares the segregated client funds account against
 * what the ledger says is owed, and alerts on any difference.
 *
 * WHY THE BANK BALANCE IS AN INPUT AND NOT A LOOKUP
 * -------------------------------------------------
 * KithLy's segregated account is a bank account, and the bank has no API we
 * are integrated with. Pretending otherwise — deriving the "bank" balance from
 * our own records — would make this job assert that the ledger equals itself,
 * which it always does, and the whole control would be theatre.
 *
 * So the balance comes in: from an ops script, from a person reading the
 * statement, or later from a bank API behind `BANK_BALANCE_URL`. Omitting it is
 * explicitly allowed and records BANK_UNAVAILABLE — a day we could not check is
 * recorded as such, never as a day that balanced.
 *
 * WHAT IT DOES NOT DO
 * -------------------
 * It does not correct anything. A reconciliation job that fixes drift destroys
 * the evidence of what caused it. It records, it alerts, and a human
 * investigates.
 *
 * Deploy and schedule daily with `x-reconcile-secret`. Also runs the internal
 * debits-equal-credits assertion, which is worth running far more often than
 * daily — it costs one aggregate and catches a single-sided write within
 * minutes rather than at the next statement.
 */

import { isServiceRoleCaller, createAdminClient } from "../_shared/auth.ts";
import { getCorsHeaders } from "../_shared/cors.ts";

function reconcileCors(req: Request): Record<string, string> {
  return {
    ...getCorsHeaders(req),
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-reconcile-secret",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

/**
 * Optional bank balance provider.
 *
 * Returns null on any failure rather than throwing: an unreachable bank must
 * produce a recorded BANK_UNAVAILABLE run, not an exception that leaves no
 * trace that today's check was attempted.
 */
async function fetchBankBalanceNgwee(): Promise<number | null> {
  const url = Deno.env.get("BANK_BALANCE_URL");
  const token = Deno.env.get("BANK_BALANCE_TOKEN");
  if (!url) return null;

  try {
    const res = await fetch(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) {
      console.error(`[escrow-reconcile] bank balance endpoint returned ${res.status}`);
      return null;
    }
    const body = await res.json();

    // Accept ngwee directly, or major units we convert once, here. Never guess:
    // an unlabelled number is refused rather than assumed.
    if (typeof body?.balance_ngwee === "number") return Math.round(body.balance_ngwee);
    if (typeof body?.balance_zmw === "number") return Math.round(body.balance_zmw * 100);

    console.error("[escrow-reconcile] bank response had no balance_ngwee or balance_zmw");
    return null;
  } catch (e) {
    console.error("[escrow-reconcile] bank balance fetch failed:", e);
    return null;
  }
}

Deno.serve(async (req: Request) => {
  const cors = reconcileCors(req);

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const authorised = await isServiceRoleCaller(req, "RECONCILE_SECRET");
  if (authorised instanceof Response) return authorised;

  const admin = createAdminClient("escrow-reconcile");

  let body: { bank_balance_ngwee?: number; bank_balance_zmw?: number; as_of?: string } = {};
  try {
    body = await req.json();
  } catch {
    // An empty body is a valid way to run this: it means "check what you can".
  }

  let bankNgwee: number | null = null;
  if (typeof body.bank_balance_ngwee === "number") {
    bankNgwee = Math.round(body.bank_balance_ngwee);
  } else if (typeof body.bank_balance_zmw === "number") {
    bankNgwee = Math.round(body.bank_balance_zmw * 100);
  } else {
    bankNgwee = await fetchBankBalanceNgwee();
  }

  const { data, error } = await admin.rpc("escrow_reconcile", {
    p_bank_balance_ngwee: bankNgwee,
    p_as_of: body.as_of ?? null,
  });

  if (error) {
    console.error("[escrow-reconcile] reconciliation failed to run:", error.message);
    return new Response(
      JSON.stringify({ error: "Reconciliation failed to run", detail: error.message }),
      { status: 500, headers: { ...cors, "Content-Type": "application/json" } },
    );
  }

  const result = data as Record<string, unknown>;
  const status = String(result?.status ?? "UNKNOWN");

  // The HTTP status carries the finding, so a scheduler's own alerting fires
  // without anyone having to parse the body. Drift is a 409: the two sources of
  // truth conflict.
  const httpStatus = status === "BALANCED" ? 200 : status === "BANK_UNAVAILABLE" ? 503 : 409;

  return new Response(
    JSON.stringify({
      ...result,
      human_summary:
        status === "BALANCED"
          ? "The client funds account matches the ledger."
          : status === "BANK_UNAVAILABLE"
          ? "Could not read the client funds account. The ledger's internal check passed; the bank comparison did not run."
          : status === "INTERNAL_IMBALANCE"
          ? "The ledger does not balance against itself. A code path wrote a single-sided entry. This outranks every other finding."
          : `The client funds account is out by ${
            (Number(result?.drift_ngwee ?? 0) / 100).toFixed(2)
          } ZMW against the ledger.`,
    }),
    { status: httpStatus, headers: { ...cors, "Content-Type": "application/json" } },
  );
});
