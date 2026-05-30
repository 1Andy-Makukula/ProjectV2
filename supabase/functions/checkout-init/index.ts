import { createClient } from "jsr:@supabase/supabase-js@2.49.8";
import { getCorsHeaders } from "../_shared/cors.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * One vendor group as sent by the frontend's `getGroupedCartPayload()` helper.
 */
interface VendorGroup {
  shop_id: string;
  item_ids: string[]; // may contain duplicates when quantity > 1
}

interface SecureVendorGroup extends VendorGroup {
  secureSubtotal: number;
}

/**
 * The full grouped cart payload accepted by this function.
 * recipient_name, recipient_phone, and message are optional — they are
 * captured in SendFlow.tsx and written to every shop_orders row created.
 */
interface CheckoutInitPayload {
  vendors: VendorGroup[];
  origin_type: "LOCAL" | "INTERNATIONAL";
  recipient_name?: string;
  recipient_phone?: string;
  message?: string;
}

/**
 * Row returned after inserting into `transactions`.
 */
interface TransactionInsertResult {
  transaction_id: string;
}

/**
 * Row returned after inserting a single row into `shop_orders`.
 */
interface ShopOrderInsertResult {
  shop_order_id: string;
}

/**
 * Shape of the Flutterwave Standard Payment Initialisation API response.
 * Only the fields we consume are declared.
 */
interface FlutterwaveInitResponse {
  status: string;       // "success" | "error"
  message: string;
  data?: {
    link: string;       // Hosted payment page URL
  };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VALID_ORIGIN_TYPES = new Set<string>(["LOCAL", "INTERNATIONAL"]);

// ---------------------------------------------------------------------------
// CORS headers
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Serialise any value as a JSON Response with CORS headers attached. */
function json(req: Request, data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
  });
}

/**
 * Validates that `value` is a non-empty string.
 * Returns the trimmed value on success, or `null` on failure.
 */
function requireString(value: unknown, field: string): string | null {
  if (typeof value !== "string" || value.trim().length === 0) {
    console.warn(`[checkout-init] Validation: '${field}' must be a non-empty string.`);
    return null;
  }
  return value.trim();
}

/**
 * Generates a cryptographically secure, random 8-character uppercase
 * alphanumeric string suitable for use as a human-readable claim code.
 *
 * Uses rejection sampling to avoid modulo bias.
 * Alphabet size = 36 (A–Z + 0–9). Max unbiased byte = 252 (= 36 × 7).
 */
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

/**
 * Returns a Supabase admin (service-role) client.
 * Bypasses RLS — all authorisation is enforced in application logic above.
 */
function getAdminClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!url || !serviceRoleKey) {
    throw new Error(
      "[checkout-init] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not configured.",
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

// ---------------------------------------------------------------------------
// Request validation
// ---------------------------------------------------------------------------

/**
 * Parses and validates the raw JSON body into a typed `CheckoutInitPayload`.
 * Throws a descriptive `Error` on any validation failure.
 */
function validatePayload(raw: Record<string, unknown>): CheckoutInitPayload {
  // --- vendors ---
  if (!Array.isArray(raw.vendors) || raw.vendors.length === 0) {
    throw new Error("vendors must be a non-empty array.");
  }

  const vendors: VendorGroup[] = (raw.vendors as unknown[]).map((v, i) => {
    if (typeof v !== "object" || v === null) {
      throw new Error(`vendors[${i}] must be an object.`);
    }
    const vObj = v as Record<string, unknown>;

    const shop_id = requireString(vObj.shop_id, `vendors[${i}].shop_id`);
    if (!shop_id) throw new Error(`vendors[${i}].shop_id is required.`);

    if (!Array.isArray(vObj.item_ids) || vObj.item_ids.length === 0) {
      throw new Error(`vendors[${i}].item_ids must be a non-empty array.`);
    }

    for (const id of vObj.item_ids as unknown[]) {
      if (typeof id !== "string" || id.trim().length === 0) {
        throw new Error(`All item_ids in vendors[${i}] must be non-empty strings.`);
      }
    }

    return {
      shop_id,
      item_ids: (vObj.item_ids as string[]).map((id) => id.trim()),
    };
  });

  // --- origin_type ---
  const origin_type = requireString(raw.origin_type, "origin_type");
  if (!origin_type) throw new Error("origin_type is required.");
  if (!VALID_ORIGIN_TYPES.has(origin_type)) {
    throw new Error(
      `origin_type must be 'LOCAL' or 'INTERNATIONAL'. Received: '${origin_type}'.`,
    );
  }

  // --- optional recipient fields (graceful — no error if missing/empty) ---
  const recipient_name  = typeof raw.recipient_name  === "string" ? raw.recipient_name.trim()  || undefined : undefined;
  const recipient_phone = typeof raw.recipient_phone === "string" ? raw.recipient_phone.trim() || undefined : undefined;
  const message         = typeof raw.message         === "string" ? raw.message.trim()         || undefined : undefined;

  return {
    vendors,
    origin_type: origin_type as "LOCAL" | "INTERNATIONAL",
    recipient_name,
    recipient_phone,
    message,
  };
}

// ---------------------------------------------------------------------------
// Step A — Authenticate caller
// ---------------------------------------------------------------------------

/**
 * Validates the incoming Bearer JWT and returns the authenticated user.
 * Returns a `Response` (401) if authentication fails, or the user object.
 */
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
      "[checkout-init] JWT validation failed:",
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

// ---------------------------------------------------------------------------
// Step B — Insert into `transactions`
// ---------------------------------------------------------------------------

/**
 * Creates the parent transaction record with status 'GATEWAY_PROCESSING'.
 * Returns the generated `transaction_id` UUID.
 */
async function insertTransaction(
  adminClient: ReturnType<typeof getAdminClient>,
  buyerId: string,
  totalAmount: number,
  originType: string,
  txRef: string,
): Promise<string> {
  const { data, error } = await adminClient
    .from("transactions")
    .insert({
      buyer_id: buyerId,
      total_amount: totalAmount,
      origin_type: originType,
      status: "GATEWAY_PROCESSING",
      gateway_tx_ref: txRef,
      created_at: new Date().toISOString(),
    })
    .select("transaction_id")
    .single<TransactionInsertResult>();

  if (error || !data) {
    console.error("[checkout-init] Failed to insert transaction:", error?.message);
    throw new Error("Failed to create transaction record. Please try again.");
  }

  console.log(
    `[checkout-init] Transaction created | transaction_id=${data.transaction_id} | total_amount=${totalAmount} ZMW`,
  );

  return data.transaction_id;
}

// ---------------------------------------------------------------------------
// Step C — Insert into `shop_orders` + `order_items` for each vendor
// ---------------------------------------------------------------------------

export interface ShopOrderResult {
  shop_order_id: string;
  claim_code: string;
  shop_id: string;
  subtotal: number;
}

/**
 * For each vendor in the payload:
 *   1. Generates a secure 8-char claim_code.
 *   2. Inserts one row into `shop_orders`, linking it to the parent transaction.
 *      Recipient fields (recipient_name, recipient_phone, message) are included
 *      when present in the payload.
 *   3. Bulk-inserts all item_ids into `order_items` at the per-item price.
 *
 * Returns an array of the created `ShopOrderResult` objects.
 */
async function insertVendorOrders(
  adminClient: ReturnType<typeof getAdminClient>,
  transactionId: string,
  vendors: SecureVendorGroup[],
  priceMap: Map<string, number>,
  recipientName?: string,
  recipientPhone?: string,
  message?: string,
): Promise<ShopOrderResult[]> {
  const shopOrders: ShopOrderResult[] = [];

  for (const vendor of vendors) {
    // --- 1. Generate claim code ---
    const claimCode = generateClaimCode(8);

    // --- 2. Insert shop_order ---
    const shopOrderRow: Record<string, unknown> = {
      transaction_id: transactionId,
      shop_id: vendor.shop_id,
      subtotal: vendor.secureSubtotal,
      claim_code: claimCode,
      claim_status: "PENDING_PAYMENT",
      created_at: new Date().toISOString(),
    };

    // Attach recipient details when provided
    if (recipientName)  shopOrderRow.recipient_name  = recipientName;
    if (recipientPhone) shopOrderRow.recipient_phone = recipientPhone;
    if (message)        shopOrderRow.message         = message;

    const { data: shopOrderData, error: shopOrderError } = await adminClient
      .from("shop_orders")
      .insert(shopOrderRow)
      .select("shop_order_id")
      .single<ShopOrderInsertResult>();

    if (shopOrderError || !shopOrderData) {
      console.error(
        `[checkout-init] Failed to insert shop_order for shop_id=${vendor.shop_id}:`,
        shopOrderError?.message,
      );
      throw new Error(
        `Failed to create shop order for shop '${vendor.shop_id}'. Please try again.`,
      );
    }

    const shopOrderId = shopOrderData.shop_order_id;
    shopOrders.push({
      shop_order_id: shopOrderId,
      claim_code: claimCode,
      shop_id: vendor.shop_id,
      subtotal: vendor.secureSubtotal,
    });

    console.log(
      `[checkout-init] Shop order created | shop_order_id=${shopOrderId} | shop_id=${vendor.shop_id} | claim_code=${claimCode} | subtotal=${vendor.secureSubtotal}`,
    );

    // --- 3. Bulk insert order_items ---
    const itemCount = vendor.item_ids.length;
    const orderItemRows = vendor.item_ids.map((itemId) => ({
      shop_order_id: shopOrderId,
      item_id: itemId,
      allocated_price: priceMap.get(itemId) ?? 0,
      created_at: new Date().toISOString(),
    }));

    const { error: itemsError } = await adminClient
      .from("order_items")
      .insert(orderItemRows);

    if (itemsError) {
      console.error(
        `[checkout-init] Failed to insert order_items for shop_order_id=${shopOrderId}:`,
        itemsError.message,
      );
      throw new Error(
        `Failed to record order items for shop '${vendor.shop_id}'. Please try again.`,
      );
    }

    console.log(
      `[checkout-init] ${itemCount} order item(s) inserted | shop_order_id=${shopOrderId} | subtotal=${vendor.secureSubtotal} ZMW`,
    );
  }

  return shopOrders;
}

// ---------------------------------------------------------------------------
// Step D — Generate Flutterwave payment link
// ---------------------------------------------------------------------------

/**
 * Calls the Flutterwave Standard Payment Initialisation API and returns the
 * hosted payment page URL.
 *
 * The `tx_ref` is set to the `transaction_id` so that the webhook handler can
 * look up the transaction by echoed reference.
 *
 * @see https://developer.flutterwave.com/docs/collecting-payments/standard
 */
async function generateFlutterwaveLink(
  transactionId: string,
  totalAmount: number,
  buyerEmail: string,
  buyerPhone: string,
): Promise<string> {
  const secretKey = Deno.env.get("FLUTTERWAVE_SECRET_KEY");
  if (!secretKey) {
    throw new Error(
      "[checkout-init] FLUTTERWAVE_SECRET_KEY is not configured.",
    );
  }

  const appUrl = (Deno.env.get("APP_URL") ?? "http://localhost:5173").replace(/\/$/, "");

  const payload = {
    tx_ref: transactionId,
    amount: totalAmount, // Database stores whole ZMW, no conversion needed
    currency: "ZMW",
    redirect_url: `${appUrl}/confirmation/${transactionId}?tx_ref=${transactionId}`,
    customer: {
      email: buyerEmail,
      ...(buyerPhone ? { phonenumber: buyerPhone } : {}),
    },
    customizations: {
      title: "KithLy Secure Checkout",
      description: "Escrow-protected gift purchase",
      logo: "https://kithly.com/logo.png",
    },
    meta: {
      transaction_id: transactionId,
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
      "[checkout-init] Flutterwave link generation failed:",
      JSON.stringify(fwData),
    );
    throw new Error(
      `Payment gateway error: ${fwData.message ?? "Failed to generate payment link."}`,
    );
  }

  console.log(
    `[checkout-init] Flutterwave link generated | transaction_id=${transactionId} | link=${fwData.data.link}`,
  );

  return fwData.data.link;
}

// ---------------------------------------------------------------------------
// Core handler
// ---------------------------------------------------------------------------

async function handleCheckoutInit(req: Request): Promise<Response> {
  // --- 1. Parse raw body ---
  let rawBody: Record<string, unknown>;
  try {
    rawBody = await req.json();
  } catch {
    return json(req, { error: "Request body must be valid JSON." }, 400);
  }

  // --- 2. Validate payload ---
  let payload: CheckoutInitPayload;
  try {
    payload = validatePayload(rawBody);
  } catch (validationError: unknown) {
    const message = validationError instanceof Error
      ? validationError.message
      : "Invalid request payload.";
    return json(req, { error: message }, 400);
  }

  const { vendors, origin_type, recipient_name, recipient_phone, message } = payload;

  // --- 3. Build admin client ---
  let adminClient: ReturnType<typeof getAdminClient>;
  try {
    adminClient = getAdminClient();
  } catch (configError: unknown) {
    const msg = configError instanceof Error ? configError.message : "Config error.";
    console.error(msg);
    return json(req, { error: "Server configuration error. Please contact support." }, 500);
  }

  // --- 4. Authenticate caller ---
  const callerResult = await authenticateCaller(req, adminClient);
  if (callerResult instanceof Response) return callerResult;
  const caller = callerResult;

  // --- 4.5. Enforce Server-Side Math ---
  const allItemIds = [...new Set(vendors.flatMap(v => v.item_ids))];
  if (allItemIds.length === 0) {
    return json(req, { error: "Cart is empty." }, 400);
  }

  const { data: dbItems, error: itemsError } = await adminClient
    .from("items")
    .select("id, price_zmw")
    .in("id", allItemIds);

  if (itemsError || !dbItems || dbItems.length === 0) {
    console.error("[checkout-init] Failed to fetch authoritative prices:", itemsError?.message);
    return json(req, { error: "Failed to verify item prices." }, 500);
  }

  const priceMap = new Map<string, number>();
  for (const item of dbItems) {
    priceMap.set(item.id, item.price_zmw);
  }

  let secureGrandTotal = 0;
  const secureVendors: SecureVendorGroup[] = [];

  for (const v of vendors) {
    let secureSubtotal = 0;
    for (const id of v.item_ids) {
      const price = priceMap.get(id);
      if (typeof price !== "number") {
        return json(req, { error: `Item ${id} is invalid or no longer available.` }, 400);
      }
      secureSubtotal += price;
    }
    secureGrandTotal += secureSubtotal;
    secureVendors.push({ ...v, secureSubtotal });
  }

  console.log(
    `[checkout-init] Request authenticated | user=${caller.id} | vendors=${vendors.length} | secure_total=${secureGrandTotal} ZMW | origin=${origin_type}`,
  );

  // --- 5. Generate gateway transaction reference ---
  // Format: KITHLY-{timestamp}-{6-char random suffix}
  const txRef = `KITHLY-${Date.now()}-${generateClaimCode(6)}`;

  try {
    // --- 6–7. Atomic DB transaction (prices re-verified inside Postgres) ---
    const vendorsPayload = secureVendors.map((v) => ({
      shop_id: v.shop_id,
      item_ids: v.item_ids,
    }));

    const { data: checkoutResult, error: checkoutError } = await adminClient.rpc(
      "checkout_init_atomic",
      {
        p_buyer_id: caller.id,
        p_origin_type: origin_type,
        p_gateway_tx_ref: txRef,
        p_vendors: vendorsPayload,
        p_recipient_name: recipient_name ?? null,
        p_recipient_phone: recipient_phone ?? null,
        p_message: message ?? null,
      },
    );

    if (checkoutError || !checkoutResult) {
      console.error("[checkout-init] checkout_init_atomic failed:", checkoutError?.message);
      throw new Error(checkoutError?.message ?? "Failed to create checkout records.");
    }

    const transactionId = checkoutResult.transaction_id as string;
    const shopOrders = checkoutResult.shop_orders as ShopOrderResult[];

    console.log(
      `[checkout-init] Atomic checkout complete | transaction_id=${transactionId} | shop_orders=${shopOrders.length} | total=${checkoutResult.total_amount}`,
    );

    // --- 8. Generate Flutterwave payment link (Step D) ---
    const paymentLink = await generateFlutterwaveLink(
      transactionId,
      secureGrandTotal,
      caller.email ?? "customer@kithly.com",
      caller.phone ?? "",
    );

    // --- 9. Respond to frontend ---
    return json(req, {
      success: true,
      transaction_id: transactionId,
      shop_orders: shopOrders,
      payment_link: paymentLink,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "An unexpected error occurred.";
    console.error("[checkout-init] Checkout pipeline failed:", message);
    // Temporary: return 200 with error so frontend can read it instead of getting a generic non-2xx error
    return json(req, { success: false, error: message }, 200);
  }
}

// ---------------------------------------------------------------------------
// Deno.serve entry-point
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request): Promise<Response> => {
  // Answer CORS preflight immediately — no auth required for OPTIONS.
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: getCorsHeaders(req) });
  }

  // Only POST is accepted.
  if (req.method !== "POST") {
    return json(req, { error: `Method '${req.method}' is not allowed. Use POST.` }, 405);
  }

  try {
    return await handleCheckoutInit(req);
  } catch (unhandled: unknown) {
    const message = unhandled instanceof Error ? unhandled.message : "An unknown error occurred.";
    console.error("[checkout-init] UNHANDLED EXCEPTION:", message);
    return json(req, { error: "Internal server error." }, 500);
  }
});
