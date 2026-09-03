/**
 * admin-confirm-payment
 *
 * Admin-only manual payment recovery. Promotes a transaction that is stuck in
 * `GATEWAY_PROCESSING` to `SUCCESS` and releases its child `shop_orders`
 * from `PENDING_PAYMENT` to `PENDING`.
 *
 * This bypasses gateway verification, so it is deliberately narrow: it refuses
 * any transaction that is not currently `GATEWAY_PROCESSING`, and every use is
 * written to `transaction_events` and `admin_action_log` with the acting
 * admin's id.
 *
 * Both state changes and both audit rows go through
 * `admin_confirm_payment_atomic` in one database transaction. They used to be
 * separate HTTP writes from here, which could tear and leave a paid order whose
 * vouchers were permanently uncollectable.
 *
 * Prefer `verify-payment` (which checks with Flutterwave) whenever the charge
 * may actually have succeeded — this endpoint is for the case where the gateway
 * record is unrecoverable and an operator is vouching for the payment.
 *
 * Replaces the `confirm_payment` action of the retired monolithic `server`
 * function, and the never-routed `/orders/:id/confirm-payment` path the admin
 * screens used to call.
 */

import { getCorsHeaders, jsonWithCors } from "../_shared/cors.ts";
import {
  createAdminClient,
  createCallerClient,
  requireAdmin,
  type AdminClient,
} from "../_shared/auth.ts";

const FN = "admin-confirm-payment";

interface AdminConfirmPaymentPayload {
  transaction_id?: string;
  reason?: string;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: getCorsHeaders(req) });
  }

  if (req.method !== "POST") {
    return jsonWithCors(req, { error: `Method '${req.method}' not allowed. Use POST.` }, 405);
  }

  try {
    let body: AdminConfirmPaymentPayload;
    try {
      body = await req.json();
    } catch {
      return jsonWithCors(req, { error: "Request body must be valid JSON." }, 400);
    }

    const transactionId = body.transaction_id?.trim();
    if (!transactionId) {
      return jsonWithCors(req, { error: "transaction_id is required." }, 400);
    }

    let adminClient: AdminClient;
    try {
      adminClient = createAdminClient(FN);
    } catch (configError: unknown) {
      console.error(configError instanceof Error ? configError.message : configError);
      return jsonWithCors(req, { error: "Server configuration error." }, 500);
    }

    const admin = await requireAdmin(req, adminClient, FN);
    if (admin instanceof Response) return admin;

    // One RPC, one database transaction.
    //
    // This used to be two independent PostgREST writes -- promote the
    // transaction, then release its shop_orders -- with nothing tying them
    // together. A crash or timeout between them left the parent SUCCESS and the
    // children stuck in PENDING_PAYMENT, and that state is unrecoverable by the
    // automatic rail: a later webhook sees SUCCESS, takes confirm_payment_
    // atomic's already_confirmed branch, and never touches shop_orders. Paid
    // order, uncollectable voucher.
    //
    // admin_confirm_payment_atomic (20260903000000) does both updates plus the
    // transaction_events and admin_action_log rows in a single transaction, and
    // re-checks the caller's admin role itself. The status gating that used to
    // live here moved into the function with it, so there is one definition of
    // what may be confirmed rather than two that can drift.
    // Called as the admin, not as service_role. The RPC authorises through
    // auth.uid()/current_user_role(), which a service-role client cannot
    // satisfy -- it has no session, so the function would refuse a legitimate
    // admin with "Authentication required".
    let callerClient: ReturnType<typeof createCallerClient>;
    try {
      callerClient = createCallerClient(req, FN);
    } catch (configError: unknown) {
      console.error(configError instanceof Error ? configError.message : configError);
      return jsonWithCors(req, { error: "Server configuration error." }, 500);
    }

    const { data: result, error: rpcError } = await callerClient.rpc(
      "admin_confirm_payment_atomic",
      { p_transaction_id: transactionId, p_reason: body.reason ?? null },
    );

    if (rpcError) {
      const message = rpcError.message ?? "";
      console.error(`[${FN}] Manual confirmation failed:`, message);

      // The function raises for a missing transaction and for a status that
      // cannot be confirmed. Map those to the codes the admin screens already
      // handle, rather than reporting every refusal as a server fault.
      if (message.includes("Transaction not found")) {
        return jsonWithCors(req, { error: "Transaction not found." }, 404);
      }
      if (message.includes("can be confirmed manually")) {
        return jsonWithCors(req, { error: message }, 400);
      }
      if (message.includes("administrator") || message.includes("Authentication required")) {
        return jsonWithCors(req, { error: "Administrator privileges are required." }, 403);
      }
      return jsonWithCors(req, { error: "Failed to confirm payment." }, 500);
    }

    const confirmed = (result ?? {}) as {
      success?: boolean;
      already_confirmed?: boolean;
      shop_orders_updated?: number;
    };

    console.log(`[${FN}] Admin ${admin.id} manually confirmed transaction ${transactionId}.`);

    return jsonWithCors(req, {
      success: true,
      alreadyConfirmed: confirmed.already_confirmed ?? false,
      shopOrdersUpdated: confirmed.shop_orders_updated ?? 0,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error";
    console.error(`[${FN}] Unhandled error:`, message);
    return jsonWithCors(req, { error: message }, 500);
  }
});
