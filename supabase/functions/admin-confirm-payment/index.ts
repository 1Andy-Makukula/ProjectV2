/**
 * admin-confirm-payment
 *
 * Admin-only manual payment recovery. Promotes a transaction that is stuck in
 * `GATEWAY_PROCESSING` to `SUCCESS` and releases its child `shop_orders`
 * from `PENDING_PAYMENT` to `PENDING`.
 *
 * This bypasses gateway verification, so it is deliberately narrow: it refuses
 * any transaction that is not currently `GATEWAY_PROCESSING`, and every use is
 * written to `transaction_events` with the acting admin's id.
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
import { createAdminClient, requireAdmin, type AdminClient } from "../_shared/auth.ts";

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

    const { data: txn, error: lookupError } = await adminClient
      .from("transactions")
      .select("transaction_id, status")
      .eq("transaction_id", transactionId)
      .single();

    if (lookupError || !txn) {
      return jsonWithCors(req, { error: "Transaction not found." }, 404);
    }

    if (txn.status === "SUCCESS") {
      return jsonWithCors(req, { success: true, alreadyConfirmed: true });
    }

    if (txn.status !== "GATEWAY_PROCESSING") {
      return jsonWithCors(
        req,
        {
          error:
            `Only transactions awaiting payment can be confirmed manually. This one is '${txn.status}'.`,
        },
        400,
      );
    }

    const { error: txError } = await adminClient
      .from("transactions")
      .update({ status: "SUCCESS" })
      .eq("transaction_id", transactionId)
      .eq("status", "GATEWAY_PROCESSING");

    if (txError) {
      console.error(`[${FN}] Transaction update failed:`, txError.message);
      return jsonWithCors(req, { error: "Failed to confirm payment." }, 500);
    }

    const { error: shopOrderError } = await adminClient
      .from("shop_orders")
      .update({ claim_status: "PENDING" })
      .eq("transaction_id", transactionId)
      .eq("claim_status", "PENDING_PAYMENT");

    if (shopOrderError) {
      // The parent is already SUCCESS — surface this loudly rather than
      // reporting a clean success the operator would not investigate.
      console.error(`[${FN}] shop_orders release failed:`, shopOrderError.message);
      return jsonWithCors(
        req,
        {
          error:
            "Transaction was marked paid but its gift orders could not be released. Escalate before retrying.",
        },
        500,
      );
    }

    // Privileged money action — always leave an audit trail.
    const { error: auditError } = await adminClient.from("transaction_events").insert({
      transaction_id: transactionId,
      event_type: "ADMIN_MANUAL_CONFIRM",
      payload: JSON.stringify({
        admin_user_id: admin.id,
        admin_email: admin.email ?? null,
        reason: body.reason ?? null,
        confirmed_at: new Date().toISOString(),
      }),
    });

    if (auditError) {
      console.error(`[${FN}] Audit write failed (state change already applied):`, auditError.message);
    }

    console.log(`[${FN}] Admin ${admin.id} manually confirmed transaction ${transactionId}.`);

    return jsonWithCors(req, { success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error";
    console.error(`[${FN}] Unhandled error:`, message);
    return jsonWithCors(req, { error: message }, 500);
  }
});
