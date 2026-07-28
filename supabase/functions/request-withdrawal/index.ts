/**
 * request-withdrawal
 *
 * Merchant-initiated payout withdrawal. Verifies the caller is assigned to the
 * shop via `merchant_shops`, then delegates to `request_withdrawal_atomic`.
 *
 * The RPC is `SECURITY DEFINER` and takes `target_shop_id` as a parameter
 * without checking the caller itself — it is revoked from PUBLIC and reachable
 * only with the service role. This function is therefore the authorisation
 * boundary and must not be bypassed.
 *
 * Replaces the `request_withdrawal` action of the retired monolithic `server`
 * function.
 */

import { getCorsHeaders, jsonWithCors } from "../_shared/cors.ts";
import { createAdminClient, requireMerchantForShop, type AdminClient } from "../_shared/auth.ts";

const FN = "request-withdrawal";

interface RequestWithdrawalPayload {
  shopId?: string;
  amount?: number;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: getCorsHeaders(req) });
  }

  if (req.method !== "POST") {
    return jsonWithCors(req, { error: `Method '${req.method}' not allowed. Use POST.` }, 405);
  }

  try {
    let body: RequestWithdrawalPayload;
    try {
      body = await req.json();
    } catch {
      return jsonWithCors(req, { error: "Request body must be valid JSON." }, 400);
    }

    const { shopId, amount } = body;

    if (!shopId || typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
      return jsonWithCors(
        req,
        { error: "shopId and a positive amount are required." },
        400,
      );
    }

    let adminClient: AdminClient;
    try {
      adminClient = createAdminClient(FN);
    } catch (configError: unknown) {
      console.error(configError instanceof Error ? configError.message : configError);
      return jsonWithCors(req, { error: "Server configuration error." }, 500);
    }

    const caller = await requireMerchantForShop(req, adminClient, shopId, FN);
    if (caller instanceof Response) return caller;

    const { data, error } = await adminClient.rpc("request_withdrawal_atomic", {
      target_shop_id: shopId,
      withdrawal_amount: Math.round(amount),
    });

    if (error) {
      console.error(`[${FN}] RPC failed:`, error.message);
      return jsonWithCors(req, { error: error.message ?? "Withdrawal request failed." }, 400);
    }

    console.log(
      `[${FN}] Shop ${shopId} requested withdrawal of ${Math.round(amount)} ngwee by ${caller.id}. Ledger: ${data}`,
    );

    return jsonWithCors(req, {
      success: true,
      message: "Withdrawal requested. It will be sent to your payout account shortly.",
      withdrawalId: data,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error";
    console.error(`[${FN}] Unhandled error:`, message);
    return jsonWithCors(req, { error: message }, 500);
  }
});
