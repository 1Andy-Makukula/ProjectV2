/**
 * verify-payment
 *
 * Buyer-initiated payment verification. Called by the Confirmation screen when
 * Flutterwave redirects back with `status=successful`, so the buyer does not
 * have to wait for the asynchronous webhook.
 *
 * Verifies the charge directly with Flutterwave, then promotes the transaction
 * through `confirm_payment_atomic` and fires recipient notifications.
 *
 * Replaces the `verify_payment` action of the retired monolithic `server`
 * function.
 */

import { getCorsHeaders, jsonWithCors } from "../_shared/cors.ts";
import {
  authenticateCaller,
  createAdminClient,
  findTransactionByTxRef,
  type AdminClient,
} from "../_shared/auth.ts";

const FN = "verify-payment";

interface VerifyPaymentPayload {
  txRef?: string;
}

interface TransactionRow {
  transaction_id: string;
  total_amount: number;
  status: string;
  gateway_tx_ref: string | null;
  buyer_id: string;
}

/**
 * Fires a WhatsApp notification per shop_order. Runs after the transaction is
 * already confirmed — notification failures must never fail the verification.
 */
async function notifyRecipients(
  adminClient: AdminClient,
  transactionId: string,
): Promise<void> {
  try {
    const { data: txnData } = await adminClient
      .from("transactions")
      .select("buyer:buyer_id (name)")
      .eq("transaction_id", transactionId)
      .single();

    const senderName = (txnData as { buyer?: { name?: string } } | null)?.buyer?.name ??
      "A friend";

    const { data: bundles } = await adminClient
      .from("shop_orders")
      .select("shop_order_id, claim_code, recipient_name, recipient_phone, shop:shop_id (name)")
      .eq("transaction_id", transactionId);

    for (const bundle of bundles ?? []) {
      if (!bundle.recipient_phone || !bundle.recipient_name) continue;

      const shop = bundle.shop as { name?: string } | null;

      console.log(`[${FN}] Invoking send-notification for ${bundle.shop_order_id}`);
      await adminClient.functions.invoke("send-notification", {
        body: {
          recipient_name: bundle.recipient_name,
          recipient_phone: bundle.recipient_phone,
          sender_name: senderName,
          shop_name: shop?.name ?? "KithLy Partner Shop",
          claim_code: bundle.claim_code,
        },
      });
    }
  } catch (err: unknown) {
    console.error(
      `[${FN}] Notification dispatch failed:`,
      err instanceof Error ? err.message : String(err),
    );
  }
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: getCorsHeaders(req) });
  }

  if (req.method !== "POST") {
    return jsonWithCors(req, { error: `Method '${req.method}' not allowed. Use POST.` }, 405);
  }

  try {
    let body: VerifyPaymentPayload;
    try {
      body = await req.json();
    } catch {
      return jsonWithCors(req, { error: "Request body must be valid JSON." }, 400);
    }

    const txRef = body.txRef?.trim();
    if (!txRef) {
      return jsonWithCors(req, { error: "txRef is required." }, 400);
    }

    let adminClient: AdminClient;
    try {
      adminClient = createAdminClient(FN);
    } catch (configError: unknown) {
      console.error(configError instanceof Error ? configError.message : configError);
      return jsonWithCors(req, { error: "Server configuration error." }, 500);
    }

    const caller = await authenticateCaller(req, adminClient, FN);
    if (caller instanceof Response) return caller;

    const { data: txn, error: lookupError } = await findTransactionByTxRef(adminClient, txRef);

    if (lookupError || !txn) {
      return jsonWithCors(req, { error: "Transaction not found." }, 404);
    }

    const transaction = txn as unknown as TransactionRow;

    if (transaction.buyer_id !== caller.id) {
      console.error(
        `[${FN}] Caller ${caller.id} does not own transaction ${transaction.transaction_id}.`,
      );
      return jsonWithCors(req, { error: "Unauthorized access to transaction." }, 403);
    }

    // Idempotent: an already-confirmed transaction is a success, not an error.
    if (transaction.status === "SUCCESS" || transaction.status === "SUCCESSFUL") {
      return jsonWithCors(req, { success: true, alreadyConfirmed: true });
    }

    const flutterwaveSecretKey = Deno.env.get("FLUTTERWAVE_SECRET_KEY");
    if (!flutterwaveSecretKey) {
      return jsonWithCors(req, { error: "Flutterwave keys not configured." }, 500);
    }

    const response = await fetch(
      `https://api.flutterwave.com/v3/transactions/verify_by_reference?tx_ref=${
        encodeURIComponent(txRef)
      }`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${flutterwaveSecretKey}`,
          "Content-Type": "application/json",
        },
      },
    );

    const data = await response.json();

    if (data.status !== "success" || data.data?.status !== "successful") {
      // 200 with success:false — the client treats this as "not paid yet",
      // which is a normal polling outcome rather than a transport failure.
      return jsonWithCors(req, {
        success: false,
        error:
          `Payment not confirmed. Gateway status: ${data.status}, charge status: ${
            data.data?.status ?? "unknown"
          }`,
      });
    }

    const { error: confirmError } = await adminClient.rpc("confirm_payment_atomic", {
      p_transaction_id: transaction.transaction_id,
      // Flutterwave reports ZMW; the DB validates in ngwee.
      p_paid_amount: Math.round(data.data.amount * 100),
      p_paid_currency: data.data.currency ?? "ZMW",
      p_payload: JSON.stringify(data),
      p_idempotency_key: `${transaction.transaction_id}:${data.data.id}`,
    });

    if (confirmError) {
      console.error(`[${FN}] confirm_payment_atomic failed:`, confirmError.message);
      return jsonWithCors(req, {
        success: false,
        error: `Failed to confirm payment: ${confirmError.message}`,
      });
    }

    await notifyRecipients(adminClient, transaction.transaction_id);

    return jsonWithCors(req, { success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error";
    console.error(`[${FN}] Unhandled error:`, message);
    return jsonWithCors(req, { error: message }, 500);
  }
});
