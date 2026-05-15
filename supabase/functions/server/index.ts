import { createClient } from "jsr:@supabase/supabase-js@2.49.8";

// ---------------------------------------------------------------------------
// Standard CORS headers – required for supabase.functions.invoke() to work
// ---------------------------------------------------------------------------
export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
};

/** Convenience wrapper: serialise data as JSON with CORS headers attached. */
function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
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

// ---------------------------------------------------------------------------
// Action handlers
// Each function receives the parsed payload (and the raw Request where needed)
// and returns a fully-formed Response.
// ---------------------------------------------------------------------------

async function handleInitializePayment(payload: Record<string, any>): Promise<Response> {
  const { orderId, amount, email, name, phone, txRef } = payload;

  const flutterwaveSecretKey = Deno.env.get("FLUTTERWAVE_SECRET_KEY");

  if (!flutterwaveSecretKey) {
    return json({ error: "Flutterwave keys not configured" }, 500);
  }

  const supabase = getSupabaseAdmin();

  // --- IDEMPOTENCY CHECK ---
  if (txRef) {
    const { data: existingOrder, error: fetchError } = await supabase
      .from("orders")
      .select("status, payment_link")
      .eq("flutterwave_tx_ref", txRef)
      .single();

    if (!fetchError && existingOrder) {
      if (existingOrder.status === "paid") {
        console.log(`[server] Order ${txRef} is already paid.`);
        return json({ success: true, alreadyPaid: true });
      }

      if (existingOrder.payment_link) {
        console.log(`[server] Resuming existing payment session for ${txRef}`);
        return json({ success: true, paymentLink: existingOrder.payment_link });
      }
    }
  }

  // --- "LAST 9" PHONE SANITIZER ---
  // Strips all formatting, grabs the last 9 digits, and prepends the clean Zambian country code.
  // This prevents double-prefixing bugs like +0260XXXXXXXXX or 00260XXXXXXXXX.
  const digitsOnly = String(phone ?? "").replace(/\D/g, "");
  const last9 = digitsOnly.slice(-9);
  const cleanPhone = `260${last9}`;

  console.log(`[server] Phone sanitizer: raw="${phone}" → clean="${cleanPhone}" (${cleanPhone.length} digits)`);

  if (cleanPhone.length !== 12) {
    return json({ error: "Invalid Zambian phone number format. Expected a 9-digit local number (e.g. 097XXXXXXX)." }, 400);
  }

  // --- HOSTED CHECKOUT: Flutterwave Payment Link ---
  // Generates a hosted payment page. User is redirected to Flutterwave's UI.
  const appUrl = Deno.env.get("APP_URL") || "https://test-project-orpin-five.vercel.app";
  console.log(`[server] Hosted Checkout: generating payment link for order ${orderId}`);

  const chargeResponse = await fetch(
    "https://api.flutterwave.com/v3/payments",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${flutterwaveSecretKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        tx_ref: txRef,
        amount: amount / 100, // Convert from lowest denomination (ngwe) to ZMW
        currency: "ZMW",
        redirect_url: `${appUrl}/confirmation/${orderId}?tx_ref=${txRef}`,
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

    // Persist the link for idempotency / resume support
    if (txRef) {
      await supabase
        .from("orders")
        .update({ payment_link: paymentLink })
        .eq("flutterwave_tx_ref", txRef);
    }

    return json({
      success: true,
      paymentLink,
    });
  }

  console.error("[server] Smart Router error:", data);
  return json({ error: data.message ?? "Payment initiation failed. Please check your phone number and try again." }, 400);
}

/**
 * action: "flutterwave_webhook"
 * Also triggered automatically when Flutterwave POSTs with a "verif-hash" header.
 * Verifies the signature then marks the matching order as paid.
 */
async function handleFlutterwaveWebhook(
  req: Request,
  payload: Record<string, any>,
): Promise<Response> {
  // 1. LOG EVERYTHING BEFORE THE GATE
  console.log("[server] --- WEBHOOK SIGNAL DETECTED ---");
  
  const signature = req.headers.get("verif-hash");
  const secretHash = Deno.env.get("FLUTTERWAVE_WEBHOOK_SECRET");

  console.log("[DEBUG] Header Signature:", signature);
  console.log("[DEBUG] Env SecretHash:", secretHash);

  // 2. THE SECURITY GATE
  if (!signature || signature !== secretHash) {
    console.error("[ERROR] Webhook Authentication Mismatch");
    return new Response("Unauthorized", { status: 401 });
  }

  // 3. THE ACTUAL LOGIC
  console.log("[server] Webhook Verified. Processing update...");

  if (payload.event === "charge.completed" && payload.data?.status === "successful") {
    const txRef = payload.data.tx_ref;
    const transactionId = payload.data.id;
    const supabase = getSupabaseAdmin();

    const { data: order, error: findError } = await supabase
      .from("orders")
      .select("id")
      .eq("flutterwave_tx_ref", txRef)
      .single();

    if (findError || !order) {
      console.error("Order not found for tx_ref:", txRef, findError);
      return json({ error: "Order not found" }, 404);
    }

    const { error: updateError } = await supabase
      .from("orders")
      .update({
        status: "paid",
        flutterwave_transaction_id: transactionId,
        paid_at: new Date().toISOString(),
      })
      .eq("id", order.id);

    if (updateError) {
      console.error("Error updating order:", updateError);
      return json({ error: "Failed to update order" }, 500);
    }

    console.log("Order marked as paid:", order.id);
  }

  return json({ success: true });
}

/**
 * action: "confirm_payment"  (admin only)
 * Manually marks an order as paid — used for Airtel direct transfers where
 * there is no webhook to confirm automatically.
 */
async function handleConfirmPayment(
  payload: Record<string, any>,
  authHeader: string | null,
): Promise<Response> {
  const adminCheck = await requireAdmin(authHeader);
  if ("error" in adminCheck) return json({ error: adminCheck.error }, adminCheck.status);

  const { orderId } = payload;
  if (!orderId) return json({ error: "orderId is required" }, 400);

  const { error: updateError } = await adminCheck.supabase
    .from("orders")
    .update({ status: "paid", paid_at: new Date().toISOString() })
    .eq("id", orderId);

  if (updateError) {
    console.error("Error confirming payment:", updateError);
    return json({ error: "Failed to confirm payment" }, 500);
  }

  return json({ success: true });
}

/**
 * action: "create_merchant"  (admin only)
 * Creates a brand-new auth user and immediately assigns them the merchant
 * role and links them to an existing shop.
 *
 * Note: MerchantOnboarding.tsx (self-registration) uses the Supabase client
 * directly with the user's own JWT — this action is for admin-created merchants.
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
 * Fetches verification from Flutterwave and marks order as paid.
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
    const { error: updateError } = await supabase
      .from("orders")
      .update({
        status: "paid",
        flutterwave_transaction_id: data.data.id.toString(),
      })
      .eq("flutterwave_tx_ref", txRef);

    if (updateError) {
      console.error("Error updating order:", updateError);
      return json({ error: "Failed to update order" }, 500);
    }

    return json({ success: true });
  }

  return json({ error: "Payment verification failed" }, 400);
}

// ---------------------------------------------------------------------------
// Entry point — action-based payload router
//
// Frontend calls this function via:
//   supabase.functions.invoke('server', { body: { action: '...', ...params } })
//
// Flutterwave calls this function directly via its webhook URL with a
// "verif-hash" header instead of an action field.
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request) => {
  // Always answer CORS preflight immediately
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Health check — simple GET, no body required
  if (req.method === "GET") {
    return json({ status: "ok" });
  }

  try {
    const payload: Record<string, any> = await req.json();
    const authHeader = req.headers.get("Authorization");

    // Flutterwave sends webhooks with a "verif-hash" header instead of an action.
    // Route those directly to the webhook handler regardless of the action field.
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
        // Also routable by explicit action (e.g. for testing)
        return await handleFlutterwaveWebhook(req, payload);

      case "verify_payment":
        return await handleVerifyPayment(payload);

      case "confirm_payment":
        return await handleConfirmPayment(payload, authHeader);

      case "create_merchant":
        return await handleCreateMerchant(payload, authHeader);

      default:
        return json({ error: `Unknown action: "${action ?? ""}"` }, 400);
    }
  } catch (err: any) {
    console.error("[server] Unhandled error:", err);
    return json({ error: err.message ?? "Internal server error" }, 500);
  }
});
