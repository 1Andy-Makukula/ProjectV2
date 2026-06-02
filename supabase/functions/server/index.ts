import { createClient } from "jsr:@supabase/supabase-js@2.49.8";
import { getCorsHeaders } from "../_shared/cors.ts";

/** Request context for CORS (set at the start of each Deno.serve invocation). */
let activeRequest: Request;

/** Convenience wrapper: serialise data as JSON with CORS headers attached. */
function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...getCorsHeaders(activeRequest), "Content-Type": "application/json" },
  });
}

// ---------------------------------------------------------------------------
// Supabase admin client (service-role key — never exposed to the browser)
// ---------------------------------------------------------------------------
const getSupabaseAdmin = () =>
  createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

// ---------------------------------------------------------------------------
// AI provider keys
// ---------------------------------------------------------------------------
const geminiKey = Deno.env.get("GEMINI_API_KEY");
const openRouterKey = Deno.env.get("OPENROUTER_API_KEY");
const groqKey = Deno.env.get("GROQ_API_KEY");

/**
 * Validates the Bearer token in the Authorization header and checks that the
 * caller has the 'admin' role in the `users` table.
 */
const requireAdmin = async (authorizationHeader?: string | null) => {
  const accessToken = authorizationHeader?.split(" ")[1];
  if (!accessToken) return { error: "Unauthorized", status: 401 as const };

  const supabase = getSupabaseAdmin();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser(accessToken);

  if (authError || !user) return { error: "Unauthorized", status: 401 as const };

  const { data: profile, error: profileError } = await supabase
    .from("users")
    .select("id, role")
    .eq("id", user.id)
    .single();

  if (profileError || profile?.role !== "admin")
    return { error: "Unauthorized", status: 401 as const };

  return { supabase, user, profile };
};

/**
 * Validates Bearer token and ensures the caller is assigned to `shopId`
 * via `merchant_shops`.
 */
const requireMerchantForShop = async (
  authorizationHeader: string | null | undefined,
  shopId: string,
) => {
  const accessToken = authorizationHeader?.split(" ")[1];
  if (!accessToken) return { error: "Unauthorized", status: 401 as const };

  const supabase = getSupabaseAdmin();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser(accessToken);

  if (authError || !user) return { error: "Unauthorized", status: 401 as const };

  const { data: assignment, error: assignError } = await supabase
    .from("merchant_shops")
    .select("shop_id")
    .eq("user_id", user.id)
    .eq("shop_id", shopId)
    .maybeSingle();

  if (assignError || !assignment) {
    return { error: "Forbidden", status: 403 as const };
  }

  return { supabase, user };
};

/** Resolves a transaction row by Flutterwave tx_ref (UUID) or gateway_tx_ref. */
async function findTransactionByTxRef(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  txRef: string,
) {
  const isUuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(txRef);

  if (isUuid) {
    return supabase
      .from("transactions")
      .select("transaction_id, total_amount, status, gateway_tx_ref")
      .eq("transaction_id", txRef)
      .single();
  }

  return supabase
    .from("transactions")
    .select("transaction_id, total_amount, status, gateway_tx_ref")
    .eq("gateway_tx_ref", txRef)
    .single();
}

// ---------------------------------------------------------------------------
// Action handlers
// ---------------------------------------------------------------------------

/**
 * action: "initialize_payment"
 *
 * V2 schema: looks up the transaction by transaction_id (passed as orderId).
 * Generates (or re-uses) a Flutterwave hosted payment link for resume support.
 */
async function handleInitializePayment(payload: Record<string, any>): Promise<Response> {
  const { orderId, amount, email, name, phone, txRef } = payload;

  const flutterwaveSecretKey = Deno.env.get("FLUTTERWAVE_SECRET_KEY");

  if (!flutterwaveSecretKey) {
    return json({ error: "Flutterwave keys not configured" }, 500);
  }

  const supabase = getSupabaseAdmin();

  // --- IDEMPOTENCY CHECK (V2 — query `transactions` by gateway_tx_ref) ---
  if (txRef) {
    const { data: existingTxn, error: fetchError } = await supabase
      .from("transactions")
      .select("status")
      .eq("gateway_tx_ref", txRef)
      .single();

    if (!fetchError && existingTxn) {
      if (existingTxn.status === "SUCCESSFUL") {
        console.log(`[server] Transaction ${txRef} is already SUCCESSFUL.`);
        return json({ success: true, alreadyPaid: true });
      }
    }
  }

  // --- "LAST 9" PHONE SANITIZER ---
  const digitsOnly = String(phone ?? "").replace(/\D/g, "");
  const last9 = digitsOnly.slice(-9);
  const cleanPhone = `260${last9}`;

  console.log(`[server] Phone sanitizer: raw="${phone}" → clean="${cleanPhone}" (${cleanPhone.length} digits)`);

  if (cleanPhone.length !== 12) {
    return json({ error: "Invalid Zambian phone number format. Expected a 9-digit local number (e.g. 097XXXXXXX)." }, 400);
  }

  // --- HOSTED CHECKOUT: Flutterwave Payment Link ---
  const appUrl = Deno.env.get("APP_URL") || "https://test-project-orpin-five.vercel.app";
  console.log(`[server] Hosted Checkout: generating payment link for transaction ${orderId}`);

  const chargeResponse = await fetch(
    "https://api.flutterwave.com/v3/payments",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${flutterwaveSecretKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        tx_ref: txRef ?? orderId,
        amount: typeof amount === "number" && amount > 1000 ? amount / 100 : amount,
        currency: "ZMW",
        redirect_url: `${appUrl}/confirmation/${orderId}?tx_ref=${txRef ?? orderId}`,
        customer: {
          email,
          name,
          phonenumber: cleanPhone,
        },
        customizations: {
          title: "KithLy Gift",
          description: "Secure escrow payment for your gift order",
          logo: "",
        },
      }),
    }
  );

  const data = await chargeResponse.json();
  console.log("[server] Flutterwave Hosted Checkout response:", JSON.stringify(data));

  if (data.status === "success") {
    const paymentLink = data.data.link;
    return json({ success: true, paymentLink });
  }

  console.error("[server] Smart Router error:", data);
  return json({ error: data.message ?? "Payment initiation failed. Please check your phone number and try again." }, 400);
}

// ---------------------------------------------------------------------------
// Twilio WhatsApp Notification Engine
// ---------------------------------------------------------------------------

async function sendWhatsAppCode(
  to: string,
  recipientName: string,
  itemName: string,
  claimCode: string,
  shopName: string,
  shopLocation: string,
): Promise<void> {
  const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID");
  const authToken = Deno.env.get("TWILIO_AUTH_TOKEN");

  if (!accountSid || !authToken) {
    console.error("[Twilio] Missing TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN — skipping WhatsApp notification.");
    return;
  }

  const digitsOnly = String(to ?? "").replace(/\D/g, "");
  const cleanTo = `260${digitsOnly.slice(-9)}`;

  const messageBody = `🎁 *You've got a gift!*\n\nHi ${recipientName}, someone just sent you *${itemName}* from *${shopName}* via KithLy.\n\n📍 *Pickup Location:* ${shopLocation}\n🔑 *Claim Code:* *${claimCode}*\n\nShow this code to the shop attendant to claim your gift. Enjoy!`;

  const formBody = new URLSearchParams({
    From: "whatsapp:+14155238886",
    To: `whatsapp:+${cleanTo}`,
    Body: messageBody,
  });

  const credentials = btoa(`${accountSid}:${authToken}`);

  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: formBody.toString(),
    },
  );

  const result = await response.json();

  if (result.error_code) {
    console.error(`[Twilio] WhatsApp send failed (${result.error_code}): ${result.message}`);
  } else {
    console.log(`[Twilio] WhatsApp sent to ${cleanTo} — SID: ${result.sid}`);
  }
}

/**
 * action: "flutterwave_webhook"
 *
 * V2: Marks the matching `transactions` row as SUCCESSFUL and all child
 * `shop_orders` rows as PENDING. Then fires Twilio WhatsApp notifications
 * using recipient details from the shop_orders rows.
 */
async function handleFlutterwaveWebhook(
  req: Request,
  payload: Record<string, any>,
): Promise<Response> {
  console.log("[server] --- WEBHOOK SIGNAL DETECTED ---");

  const signature = req.headers.get("verif-hash");
  const secretHash = Deno.env.get("FLUTTERWAVE_VERIF_HASH");

  if (!signature || signature !== secretHash) {
    console.error("[ERROR] Webhook Authentication Mismatch");
    return new Response("Unauthorized", { status: 401 });
  }

  console.log("[server] Webhook Verified. Processing update...");

  if (payload.event === "charge.completed" && payload.data?.status === "successful") {
    const txRef = payload.data.tx_ref;
    const flwTransactionId = payload.data.id;
    const supabase = getSupabaseAdmin();

    const { data: txn, error: findError } = await findTransactionByTxRef(supabase, txRef);

    if (findError || !txn) {
      console.error("Transaction not found for gateway_tx_ref:", txRef, findError);
      return json({ error: "Transaction not found" }, 404);
    }

    if (txn.status !== "GATEWAY_PROCESSING") {
      console.warn(`Transaction ${txRef} is already in status ${txn.status}. Ignoring.`);
      return json({ success: true });
    }

    // Update the parent transaction
    const { error: confirmError } = await supabase.rpc("confirm_payment_atomic", {
      p_transaction_id: txn.transaction_id,
      p_paid_amount: Math.round(payload.data.amount * 100), // Convert ZMW from Flutterwave to ngwee for DB validation
      p_paid_currency: payload.data.currency ?? "ZMW",
      p_payload: JSON.stringify(payload),
      p_idempotency_key: `${txn.transaction_id}:${payload.data.id}`,
    });

    if (confirmError) {
      console.error("confirm_payment_atomic failed:", confirmError);
      return json({ error: "Failed to confirm payment" }, 500);
    }

    console.log("Transaction marked as SUCCESSFUL:", txn.transaction_id);

    // --- TWILIO WHATSAPP NOTIFICATIONS ---
    // Fetch all shop_orders with recipient details and first item name for notification
    const { data: shopOrders, error: fetchError } = await supabase
      .from("shop_orders")
      .select(`
        shop_order_id,
        claim_code,
        recipient_name,
        recipient_phone,
        shop:shop_id (name, location),
        order_items (
          item:item_id (name)
        )
      `)
      .eq("transaction_id", txn.transaction_id);

    if (fetchError || !shopOrders) {
      console.error("[Twilio] Could not fetch shop order details for notification:", fetchError);
    } else {
      for (const shopOrder of shopOrders) {
        if (!shopOrder.recipient_phone || !shopOrder.recipient_name) continue;

        const shop = shopOrder.shop as any;
        const firstItem = (shopOrder.order_items as any[])?.[0]?.item;
        const itemName = firstItem?.name ?? "your gift";
        const shopName = shop?.name ?? "the shop";
        const shopLocation = shop?.location ?? "see shop for details";

        await sendWhatsAppCode(
          shopOrder.recipient_phone,
          shopOrder.recipient_name,
          itemName,
          shopOrder.claim_code,
          shopName,
          shopLocation,
        );
      }
    }
  }

  return json({ success: true });
}

/**
 * action: "confirm_payment"  (admin only)
 *
 * V2: Manually marks a transaction as SUCCESSFUL and its shop_orders as PENDING.
 * orderId is treated as transaction_id.
 */
async function handleConfirmPayment(
  payload: Record<string, any>,
  authHeader: string | null,
): Promise<Response> {
  const adminCheck = await requireAdmin(authHeader);
  if ("error" in adminCheck) return json({ error: adminCheck.error }, adminCheck.status);

  const { orderId } = payload; // orderId == transaction_id in V2
  if (!orderId) return json({ error: "orderId (transaction_id) is required" }, 400);

  const { supabase } = adminCheck;

  // Update parent transaction
  const { error: txError } = await supabase
    .from("transactions")
    .update({ status: "SUCCESSFUL" })
    .eq("transaction_id", orderId)
    .eq("status", "GATEWAY_PROCESSING");

  if (txError) {
    console.error("Error confirming transaction payment:", txError);
    return json({ error: "Failed to confirm payment" }, 500);
  }

  // Update child shop_orders
  await supabase
    .from("shop_orders")
    .update({ claim_status: "PENDING" })
    .eq("transaction_id", orderId)
    .eq("claim_status", "PENDING_PAYMENT");

  return json({ success: true });
}

/**
 * action: "create_merchant"  (admin only)
 */
async function handleCreateMerchant(
  payload: Record<string, any>,
  authHeader: string | null,
): Promise<Response> {
  const adminCheck = await requireAdmin(authHeader);
  if ("error" in adminCheck) return json({ error: adminCheck.error }, adminCheck.status);

  const { name, email, password, shopId } = payload;

  if (!name || !email || !password || !shopId) {
    return json({ error: "Missing required fields: name, email, password, shopId" }, 400);
  }

  const { supabase } = adminCheck;

  const { data: authData, error: createUserError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name },
  });

  if (createUserError || !authData.user) {
    console.error("Error creating merchant auth user:", createUserError);
    return json(
      { error: createUserError?.message ?? "Failed to create merchant account" },
      400,
    );
  }

  const merchantUserId = authData.user.id;

  const { error: roleUpdateError } = await supabase
    .from("users")
    .update({ name, email, role: "merchant" })
    .eq("id", merchantUserId);

  if (roleUpdateError) {
    console.error("Error updating merchant profile:", roleUpdateError);
    await supabase.auth.admin.deleteUser(merchantUserId);
    return json({ error: "Failed to assign merchant role" }, 500);
  }

  const { error: assignmentError } = await supabase
    .from("merchant_shops")
    .insert({ user_id: merchantUserId, shop_id: shopId });

  if (assignmentError) {
    console.error("Error assigning merchant to shop:", assignmentError);
    await supabase.auth.admin.deleteUser(merchantUserId);
    return json({ error: "Failed to assign merchant to shop" }, 500);
  }

  return json({
    success: true,
    merchant: { id: merchantUserId, email, name, shopId },
  });
}

/**
 * action: "verify_payment"
 *
 * V2: Verifies with Flutterwave and promotes the transaction + shop_orders.
 * txRef here is either the transaction_id or gateway_tx_ref (both work
 * since checkout-init sets gateway_tx_ref = txRef = transaction_id-based string).
 */
async function handleVerifyPayment(payload: Record<string, any>): Promise<Response> {
  const { txRef } = payload;
  if (!txRef) return json({ error: "txRef is required" }, 400);

  const flutterwaveSecretKey = Deno.env.get("FLUTTERWAVE_SECRET_KEY");
  if (!flutterwaveSecretKey) return json({ error: "Flutterwave keys not configured" }, 500);

  const response = await fetch(`https://api.flutterwave.com/v3/transactions/verify_by_reference?tx_ref=${txRef}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${flutterwaveSecretKey}`,
      "Content-Type": "application/json",
    },
  });

  const data = await response.json();

  if (data.status === "success" && data.data.status === "successful") {
    const supabase = getSupabaseAdmin();

    const { data: txn, error: lookupError } = await findTransactionByTxRef(supabase, txRef);

    if (lookupError || !txn) {
      return json({ error: "Transaction not found" }, 404);
    }

    if (txn.status === "SUCCESSFUL") {
      return json({ success: true }); // Idempotent
    }

    const { error: confirmError } = await supabase.rpc("confirm_payment_atomic", {
      p_transaction_id: txn.transaction_id,
      p_paid_amount: Math.round(data.data.amount * 100), // Convert ZMW from Flutterwave back to ngwee for DB validation
      p_paid_currency: data.data.currency ?? "ZMW",
      p_payload: JSON.stringify(data),
      p_idempotency_key: `${txn.transaction_id}:${data.data.id}`,
    });

    if (confirmError) {
      console.error("confirm_payment_atomic failed:", confirmError);
      return json({ success: false, error: `Failed to confirm payment: ${confirmError.message || JSON.stringify(confirmError)}` }, 200);
    }

    // Trigger recipient WhatsApp notifications via background invocation
    (async () => {
      try {
        const { data: txnData } = await supabase
          .from("transactions")
          .select("buyer:buyer_id (name)")
          .eq("transaction_id", txn.transaction_id)
          .single();

        const senderName = (txnData as any)?.buyer?.name || "A friend";

        const { data: bundles } = await supabase
          .from("shop_orders")
          .select("shop_order_id, claim_code, recipient_name, recipient_phone, shop:shop_id (name)")
          .eq("transaction_id", txn.transaction_id);

        if (bundles && bundles.length > 0) {
          for (const bundle of bundles) {
            if (!bundle.recipient_phone || !bundle.recipient_name) continue;
            const shopName = bundle.shop?.name || "KithLy Partner Shop";

            console.log(`[Verify] Invoking send-notification for bundle: ${bundle.shop_order_id}`);
            await supabase.functions.invoke("send-notification", {
              body: {
                recipient_name: bundle.recipient_name,
                recipient_phone: bundle.recipient_phone,
                sender_name: senderName,
                shop_name: shopName,
                claim_code: bundle.claim_code,
              },
            });
          }
        }
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error(`[Verify] Notification background processing exception:`, errMsg);
      }
    })();

    return json({ success: true });
  }

  return json({ success: false, error: `Payment verification failed. Flutterwave status: ${data.status}, tx status: ${data.data?.status}` }, 200);
}

/**
 * action: "settle_payout"  (merchant)
 *
 * V2: Uses shop_orders.shop_order_id as orderId.
 * Reads subtotal from shop_orders instead of orders.amount.
 */
async function handleSettlePayout(
  payload: Record<string, any>,
  authHeader: string | null,
): Promise<Response> {
  const { orderId } = payload; // orderId == shop_order_id in V2
  if (!orderId) return json({ error: "orderId is required" }, 400);

  const supabase = getSupabaseAdmin();

  // Fetch shop_order details
  const { data: shopOrder, error: orderError } = await supabase
    .from("shop_orders")
    .select("subtotal, shop_id, claim_status, settled")
    .eq("shop_order_id", orderId)
    .single();

  if (orderError || !shopOrder || shopOrder.claim_status !== "REDEEMED" || shopOrder.settled) {
    return json({ error: "Order not ready for settlement or already settled" }, 400);
  }

  const merchantCheck = await requireMerchantForShop(authHeader, shopOrder.shop_id);
  if ("error" in merchantCheck) {
    return json({ error: merchantCheck.error }, merchantCheck.status);
  }

  const { data: settleResult, error: settleError } = await supabase.rpc("settle_payout_atomic", {
    p_shop_order_id: orderId,
    p_merchant_user_id: merchantCheck.user.id,
  });

  if (settleError || !settleResult?.success) {
    console.error("[settle_payout] settle_payout_atomic failed:", settleError?.message);
    return json({ error: settleError?.message ?? "Settlement failed" }, 500);
  }

  return json({
    success: true,
    merchantShare: settleResult.merchantShare,
    kithlyCommission: settleResult.kithlyCommission,
  });
}

/**
 * action: "request_withdrawal"  (merchant)
 */
async function handleRequestWithdrawal(
  payload: Record<string, any>,
  authHeader: string | null,
): Promise<Response> {
  const { shopId, amount } = payload;

  if (!shopId || !amount || amount <= 0) {
    return json({ error: "shopId and a positive amount are required" }, 400);
  }

  const merchantCheck = await requireMerchantForShop(authHeader, shopId);
  if ("error" in merchantCheck) {
    return json({ error: merchantCheck.error }, merchantCheck.status);
  }

  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase.rpc("request_withdrawal_atomic", {
    target_shop_id: shopId,
    withdrawal_amount: amount,
  });

  if (error) {
    console.error("[request_withdrawal] RPC failed:", error);
    return json({ error: error.message ?? "Withdrawal request failed" }, 400);
  }

  console.log(`[request_withdrawal] Shop ${shopId} requested withdrawal of ${amount} Ngwee. Ledger ID: ${data}`);

  return json({
    success: true,
    message: "Withdrawal request submitted. KithLy will process it within 1-2 business days.",
    ledgerId: data,
  });
}

// ---------------------------------------------------------------------------
// Entry point — action-based payload router
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request) => {
  activeRequest = req;

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: getCorsHeaders(req) });
  }

  if (req.method === "GET") {
    return json({ status: "ok" });
  }

  try {
    const payload: Record<string, any> = await req.json();
    const authHeader = req.headers.get("Authorization");

    if (req.headers.get("verif-hash")) {
      console.log("[server] Incoming Flutterwave webhook");
      return await handleFlutterwaveWebhook(req, payload);
    }

    const { action } = payload;
    console.log(`[server] action="${action}"`);

    switch (action) {
      case "initialize_payment":
        return await handleInitializePayment(payload);

      case "flutterwave_webhook":
        return await handleFlutterwaveWebhook(req, payload);

      case "verify_payment":
        return await handleVerifyPayment(payload);

      case "confirm_payment":
        return await handleConfirmPayment(payload, authHeader);

      case "create_merchant":
        return await handleCreateMerchant(payload, authHeader);

      case "settle_payout":
        return await handleSettlePayout(payload, authHeader);

      case "request_withdrawal":
        return await handleRequestWithdrawal(payload, authHeader);

      default:
        return json({ error: `Unknown action: "${action ?? ""}"` }, 400);
    }
  } catch (err: any) {
    console.error("[server] Unhandled error:", err);
    return json({ error: err.message ?? "Internal server error" }, 500);
  }
});
