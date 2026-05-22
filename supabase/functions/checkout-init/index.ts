import { createClient } from "jsr:@supabase/supabase-js@2.49.8";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * One vendor group as sent by the frontend's `getGroupedCartPayload()` helper.
 */
interface VendorGroup {
  shop_id: string;
  subtotal: number;
  item_ids: string[]; // may contain duplicates when quantity > 1
}

/**
 * The full grouped cart payload accepted by this function.
 */
interface CheckoutInitPayload {
  total_amount: number;
  vendors: VendorGroup[];
  origin_type: "LOCAL" | "INTERNATIONAL";
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

const corsHeaders: HeadersInit = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Serialise any value as a JSON Response with CORS headers attached. */
function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
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
  // --- total_amount ---
  if (
    typeof raw.total_amount !== "number" ||
    !Number.isFinite(raw.total_amount) ||
    raw.total_amount <= 0
  ) {
    throw new Error("total_amount is required and must be a positive number.");
  }

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

    if (
      typeof vObj.subtotal !== "number" ||
      !Number.isFinite(vObj.subtotal) ||
      vObj.subtotal <= 0
    ) {
      throw new Error(`vendors[${i}].subtotal must be a positive number.`);
    }

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
      subtotal: vObj.subtotal as number,
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

  return {
    total_amount: raw.total_amount as number,
    vendors,
    origin_type: origin_type as "LOCAL" | "INTERNATIONAL",
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
    return json({ error: "A valid Authorization Bearer token is required." }, 401);
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
 *   3. Bulk-inserts all item_ids into `order_items` at the per-item price
 *      (subtotal / item count, rounded to the nearest integer).
 *
 * Returns an array of the created `ShopOrderResult` objects.
 */
async function insertVendorOrders(
  adminClient: ReturnType<typeof getAdminClient>,
  transactionId: string,
  vendors: VendorGroup[],
): Promise<ShopOrderResult[]> {
  const shopOrders: ShopOrderResult[] = [];

  for (const vendor of vendors) {
    // --- 1. Generate claim code ---
    const claimCode = generateClaimCode(8);

    // --- 2. Insert shop_order ---
    const { data: shopOrderData, error: shopOrderError } = await adminClient
      .from("shop_orders")
      .insert({
        transaction_id: transactionId,
        shop_id: vendor.shop_id,
        subtotal: vendor.subtotal,
        claim_code: claimCode,
        status: "PENDING_PAYMENT",
        created_at: new Date().toISOString(),
      })
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
      subtotal: vendor.subtotal,
    });

    console.log(
      `[checkout-init] Shop order created | shop_order_id=${shopOrderId} | shop_id=${vendor.shop_id} | claim_code=${claimCode} | subtotal=${vendor.subtotal}`,
    );

    // --- 3. Bulk insert order_items ---
    // Per-item allocated price: distribute subtotal evenly across all units.
    // Math.round keeps the stored value as an integer (ZMW, no fractional ngwe).
    const itemCount = vendor.item_ids.length;
    const allocatedPricePerUnit = Math.round(vendor.subtotal / itemCount);

    const orderItemRows = vendor.item_ids.map((itemId) => ({
      shop_order_id: shopOrderId,
      item_id: itemId,
      allocated_price: allocatedPricePerUnit,
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
      `[checkout-init] ${itemCount} order item(s) inserted | shop_order_id=${shopOrderId} | allocated_price_each=${allocatedPricePerUnit} ZMW`,
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

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  // Derive the project ref from the Supabase URL (e.g. https://abcxyz.supabase.co → abcxyz)
  const projectRef = supabaseUrl.replace("https://", "").split(".")[0];

  const payload = {
    tx_ref: transactionId,
    amount: totalAmount,
    currency: "ZMW",
    redirect_url: `https://${projectRef}.supabase.co/functions/v1/flutterwave-webhook`,
    customer: {
      email: buyerEmail,
      phonenumber: buyerPhone,
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
    return json({ error: "Request body must be valid JSON." }, 400);
  }

  // --- 2. Validate payload ---
  let payload: CheckoutInitPayload;
  try {
    payload = validatePayload(rawBody);
  } catch (validationError: unknown) {
    const message = validationError instanceof Error
      ? validationError.message
      : "Invalid request payload.";
    return json({ error: message }, 400);
  }

  const { total_amount, vendors, origin_type } = payload;

  // --- 3. Build admin client ---
  let adminClient: ReturnType<typeof getAdminClient>;
  try {
    adminClient = getAdminClient();
  } catch (configError: unknown) {
    const msg = configError instanceof Error ? configError.message : "Config error.";
    console.error(msg);
    return json({ error: "Server configuration error. Please contact support." }, 500);
  }

  // --- 4. Authenticate caller ---
  const callerResult = await authenticateCaller(req, adminClient);
  if (callerResult instanceof Response) return callerResult;
  const caller = callerResult;

  console.log(
    `[checkout-init] Request authenticated | user=${caller.id} | vendors=${vendors.length} | total=${total_amount} ZMW | origin=${origin_type}`,
  );

  // --- 5. Generate gateway transaction reference ---
  // Format: KITHLY-{timestamp}-{6-char random suffix}
  const txRef = `KITHLY-${Date.now()}-${generateClaimCode(6)}`;

  try {
    // --- 6. Insert parent transaction (Step B) ---
    const transactionId = await insertTransaction(
      adminClient,
      caller.id,
      total_amount,
      origin_type,
      txRef,
    );

    // --- 7. Insert shop orders + order items for each vendor (Step C) ---
    const shopOrders = await insertVendorOrders(adminClient, transactionId, vendors);

    console.log(
      `[checkout-init] All vendor orders created | transaction_id=${transactionId} | shop_orders=${shopOrders.length}`,
    );

    // --- 8. Generate Flutterwave payment link (Step D) ---
    const paymentLink = await generateFlutterwaveLink(
      transactionId,
      total_amount,
      caller.email ?? "customer@kithly.com",
      caller.phone ?? "",
    );

    // --- 9. Respond to frontend ---
    return json({
      success: true,
      transaction_id: transactionId,
      shop_orders: shopOrders,
      payment_link: paymentLink,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "An unexpected error occurred.";
    console.error("[checkout-init] Checkout pipeline failed:", message);
    return json({ error: message }, 500);
  }
}

// ---------------------------------------------------------------------------
// Deno.serve entry-point
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request): Promise<Response> => {
  // Answer CORS preflight immediately — no auth required for OPTIONS.
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // Only POST is accepted.
  if (req.method !== "POST") {
    return json({ error: `Method '${req.method}' is not allowed. Use POST.` }, 405);
  }

  try {
    return await handleCheckoutInit(req);
  } catch (unhandled: unknown) {
    const message = unhandled instanceof Error ? unhandled.message : "An unknown error occurred.";
    console.error("[checkout-init] UNHANDLED EXCEPTION:", message);
    return json({ error: "Internal server error." }, 500);
  }
});
