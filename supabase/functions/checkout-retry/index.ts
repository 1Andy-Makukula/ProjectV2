import { createClient } from "jsr:@supabase/supabase-js@2.49.8";
import { getCorsHeaders } from "../_shared/cors.ts";

interface CheckoutRetryPayload {
  transaction_id: string;
  buyer_id?: string;
}

interface FlutterwaveInitResponse {
  status: string;       // "success" | "error"
  message: string;
  data?: {
    link: string;       // Hosted payment page URL
  };
}

function json(req: Request, data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
  });
}

function generateClaimCode(length = 8): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const alphabetLength = alphabet.length; // 36
  const maxUnbiasedByte = Math.floor(256 / alphabetLength) * alphabetLength; // 252

  let code = "";
  while (code.length < length) {
    const buffer = new Uint8Array(length * 2);
    crypto.getRandomValues(buffer);
    for (const byte of buffer) {
      if (code.length >= length) break;
      if (byte >= maxUnbiasedByte) continue;
      code += alphabet[byte % alphabetLength];
    }
  }
  return code;
}

function getAdminClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!url || !serviceRoleKey) {
    throw new Error(
      "[checkout-retry] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not configured.",
    );
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

async function authenticateCaller(
  req: Request,
  adminClient: ReturnType<typeof getAdminClient>,
): Promise<{ id: string; email?: string; phone?: string } | Response> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return json(req, { error: "A valid Authorization Bearer token is required." }, 401);
  }

  const jwt = authHeader.split(" ")[1];
  const {
    data: { user },
    error: authError,
  } = await adminClient.auth.getUser(jwt);

  if (authError || !user) {
    console.error(
      "[checkout-retry] JWT validation failed:",
      authError?.message ?? "No user returned.",
    );
    return json(
      req,
      { error: "Unauthorized. Your session may have expired — please log in again." },
      401,
    );
  }

  return user;
}

async function generateFlutterwaveLink(
  transactionId: string,
  gatewayTxRef: string,
  totalAmount: number,
  buyerEmail: string,
  buyerPhone: string,
  recipientPhone?: string,
): Promise<string> {
  const secretKey = Deno.env.get("FLUTTERWAVE_SECRET_KEY");
  if (!secretKey) {
    throw new Error(
      "[checkout-retry] FLUTTERWAVE_SECRET_KEY is not configured.",
    );
  }

  const appUrl = (Deno.env.get("APP_URL") ?? "https://project-h48n1.vercel.app").replace(/\/$/, "");

  // Use the recipient's phone as a fallback for the buyer's phone
  const finalPhone = buyerPhone || recipientPhone || "";

  const payload = {
    tx_ref: gatewayTxRef, // Must use the brand new unique reference!
    amount: totalAmount / 100, // Convert from cents/ngwee to ZMW for Flutterwave
    currency: "ZMW",
    redirect_url: `${appUrl}/confirmation/${transactionId}?tx_ref=${gatewayTxRef}`,
    customer: {
      email: buyerEmail,
      ...(finalPhone ? { phonenumber: finalPhone } : {}),
    },
    customizations: {
      title: "KithLy Secure Checkout (Retry)",
      description: "Escrow-protected gift purchase",
    },
    meta: {
      transaction_id: transactionId,
      gateway_tx_ref: gatewayTxRef,
    },
  };

  const response = await fetch("https://api.flutterwave.com/v3/payments", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${secretKey}`,
    },
    body: JSON.stringify(payload),
  });

  const fwData = await response.json() as FlutterwaveInitResponse;

  if (!response.ok || fwData.status !== "success" || !fwData.data?.link) {
    console.error(
      "[checkout-retry] Flutterwave link generation failed:",
      JSON.stringify(fwData),
    );
    throw new Error(
      `Payment gateway error: ${fwData.message ?? "Failed to generate payment link."}`,
    );
  }

  console.log(
    `[checkout-retry] Flutterwave link generated | transaction_id=${transactionId} | ref=${gatewayTxRef} | link=${fwData.data.link}`,
  );

  return fwData.data.link;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: getCorsHeaders(req) });
  }

  if (req.method !== "POST") {
    return json(req, { error: `Method '${req.method}' is not allowed. Use POST.` }, 405);
  }

  try {
    let rawBody: CheckoutRetryPayload;
    try {
      rawBody = await req.json();
    } catch {
      return json(req, { error: "Request body must be valid JSON." }, 400);
    }

    const { transaction_id } = rawBody;
    if (!transaction_id) {
      return json(req, { error: "transaction_id is required." }, 400);
    }

    let adminClient: ReturnType<typeof getAdminClient>;
    try {
      adminClient = getAdminClient();
    } catch (configError: unknown) {
      const msg = configError instanceof Error ? configError.message : "Config error.";
      console.error(msg);
      return json(req, { error: "Server configuration error. Please contact support." }, 500);
    }

    const callerResult = await authenticateCaller(req, adminClient);
    if (callerResult instanceof Response) return callerResult;
    const caller = callerResult;

    // 1. Fetch transaction and verify it exists and belongs to the buyer
    const { data: txn, error: txnError } = await adminClient
      .from("transactions")
      .select("transaction_id, total_amount, status, buyer_id")
      .eq("transaction_id", transaction_id)
      .single();

    if (txnError || !txn) {
      console.error("[checkout-retry] Transaction lookup failed:", txnError?.message);
      return json(req, { error: "Transaction not found." }, 404);
    }

    if (txn.buyer_id !== caller.id) {
      console.error(`[checkout-retry] Unauthorized: transaction buyer '${txn.buyer_id}' does not match caller '${caller.id}'`);
      return json(req, { error: "Unauthorized access to transaction." }, 403);
    }

    if (txn.status === "SUCCESSFUL") {
      return json(req, { error: "Transaction is already completed." }, 400);
    }

    // Get any associated shop_orders recipient phone number as a fallback
    const { data: shopOrders, error: shopOrdersErr } = await adminClient
      .from("shop_orders")
      .select("recipient_phone")
      .eq("transaction_id", transaction_id)
      .limit(1);

    const recipientPhone = (!shopOrdersErr && shopOrders && shopOrders.length > 0)
      ? shopOrders[0].recipient_phone
      : undefined;

    // 2. Generate brand new unique gateway_tx_ref
    const newTxRef = `RETRY-TX-${Date.now()}-${generateClaimCode(6)}`;

    // 3. Atomically update the transaction status/ref and reset shop_orders
    const { error: updateTxErr } = await adminClient
      .from("transactions")
      .update({
        gateway_tx_ref: newTxRef,
        status: "GATEWAY_PROCESSING"
      })
      .eq("transaction_id", transaction_id);

    if (updateTxErr) {
      console.error("[checkout-retry] Failed to update transaction ref/status:", updateTxErr.message);
      return json(req, { error: "Failed to initialize payment retry." }, 500);
    }

    // Reset associated shop orders back to PENDING_PAYMENT
    const { error: updateOrdersErr } = await adminClient
      .from("shop_orders")
      .update({
        claim_status: "PENDING_PAYMENT"
      })
      .eq("transaction_id", transaction_id);

    if (updateOrdersErr) {
      console.warn("[checkout-retry] Warning: Failed to reset shop_orders claim_status:", updateOrdersErr.message);
    }

    // 4. Generate fresh Flutterwave link
    const paymentLink = await generateFlutterwaveLink(
      transaction_id,
      newTxRef,
      txn.total_amount,
      caller.email ?? "customer@kithly.com",
      caller.phone ?? "",
      recipientPhone
    );

    return json(req, {
      success: true,
      transaction_id,
      gateway_tx_ref: newTxRef,
      payment_link: paymentLink,
      total_amount: txn.total_amount
    });

  } catch (unhandled: unknown) {
    const message = unhandled instanceof Error ? unhandled.message : "An unknown error occurred.";
    console.error("[checkout-retry] UNHANDLED EXCEPTION:", message);
    return json(req, { error: "Internal server error." }, 500);
  }
});
