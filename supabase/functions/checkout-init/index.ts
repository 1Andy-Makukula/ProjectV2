import { createClient } from "jsr:@supabase/supabase-js@2.49.8";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * The validated, strongly-typed request body accepted by this function.
 */
interface CheckoutInitPayload {
  buyer_uuid: string;
  shop_id: string;
  item_id: string;
  recipient_name: string;
  recipient_phone: string;
  origin_type: "LOCAL" | "INTERNATIONAL";
}

/**
 * The row returned from the `items` table for this query.
 */
interface ItemRow {
  base_price: number;
}

/**
 * The row inserted into `claim_vouchers` and partially returned to the caller.
 */
interface VoucherInsertResult {
  voucher_id: string;
  claim_code: string;
  checkout_price: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Accepted origin type literals — validated at runtime. */
const VALID_ORIGIN_TYPES = new Set<string>(["LOCAL", "INTERNATIONAL"]);

/**
 * Pricing multipliers for the 3-tier matrix (stored as exact fractions to keep
 * the arithmetic predictable before the final Math.round() call).
 *
 *   LOCAL         → base_price × 1.10  (+10 %)
 *   INTERNATIONAL → base_price × 1.30  (+30 %)
 */
const PRICING_MULTIPLIERS: Record<"LOCAL" | "INTERNATIONAL", number> = {
  LOCAL: 1.1,
  INTERNATIONAL: 1.3,
};

// ---------------------------------------------------------------------------
// CORS headers — required for supabase.functions.invoke() to work
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

/** Serialise any value as a JSON response with CORS headers attached. */
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
    return null;
  }
  return value.trim();
}

/**
 * Generates a cryptographically secure, random 8-character uppercase
 * alphanumeric string suitable for use as a human-readable claim code.
 *
 * Implementation notes:
 *   - Uses `crypto.getRandomValues` (Web Crypto API, available in Deno) for
 *     CSPRNG quality randomness — never `Math.random()`.
 *   - Rejects bytes that would introduce modulo bias: only bytes whose value
 *     falls within a range that is an exact multiple of the alphabet length
 *     are used. Rejected bytes trigger a fresh draw (rejection sampling).
 *   - Alphabet size = 36 (A-Z + 0-9). 256 mod 36 = 4 biased values at the
 *     top of the range, so we cap usable bytes at 252 (= 36 × 7).
 */
function generateClaimCode(length = 8): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const alphabetLength = alphabet.length; // 36
  // Largest value that is an exact multiple of alphabetLength within [0, 255]
  const maxUnbiasedByte = Math.floor(256 / alphabetLength) * alphabetLength; // 252

  let code = "";
  while (code.length < length) {
    // Over-provision the buffer to reduce the number of rejection loops.
    const buffer = new Uint8Array(length * 2);
    crypto.getRandomValues(buffer);
    for (const byte of buffer) {
      if (code.length >= length) break;
      // Skip bytes in the biased tail range
      if (byte >= maxUnbiasedByte) continue;
      code += alphabet[byte % alphabetLength];
    }
  }
  return code;
}

/**
 * Applies the 3-tier pricing matrix and returns the checkout price as a
 * rounded integer (ZMW, stored as raw integer to avoid float storage errors).
 *
 *   LOCAL:         checkout_price = round(base_price * 1.10)
 *   INTERNATIONAL: checkout_price = round(base_price * 1.30)
 */
function calculateCheckoutPrice(
  basePrice: number,
  originType: "LOCAL" | "INTERNATIONAL",
): number {
  const multiplier = PRICING_MULTIPLIERS[originType];
  return Math.round(basePrice * multiplier);
}

// ---------------------------------------------------------------------------
// Request validation
// ---------------------------------------------------------------------------

/**
 * Parses and validates the raw JSON body.
 * Returns a typed `CheckoutInitPayload` on success, or throws a descriptive
 * `Error` so the caller can surface a 400-level response.
 */
function validatePayload(raw: Record<string, unknown>): CheckoutInitPayload {
  const buyer_uuid = requireString(raw.buyer_uuid, "buyer_uuid");
  if (!buyer_uuid) throw new Error("buyer_uuid is required and must be a non-empty string.");

  const shop_id = requireString(raw.shop_id, "shop_id");
  if (!shop_id) throw new Error("shop_id is required and must be a non-empty string.");

  const item_id = requireString(raw.item_id, "item_id");
  if (!item_id) throw new Error("item_id is required and must be a non-empty string.");

  const recipient_name = requireString(raw.recipient_name, "recipient_name");
  if (!recipient_name) throw new Error("recipient_name is required and must be a non-empty string.");

  const recipient_phone = requireString(raw.recipient_phone, "recipient_phone");
  if (!recipient_phone) throw new Error("recipient_phone is required and must be a non-empty string.");

  const origin_type = requireString(raw.origin_type, "origin_type");
  if (!origin_type) throw new Error("origin_type is required and must be a non-empty string.");
  if (!VALID_ORIGIN_TYPES.has(origin_type)) {
    throw new Error(`origin_type must be exactly 'LOCAL' or 'INTERNATIONAL'. Received: '${origin_type}'.`);
  }

  return {
    buyer_uuid,
    shop_id,
    item_id,
    recipient_name,
    recipient_phone,
    origin_type: origin_type as "LOCAL" | "INTERNATIONAL",
  };
}

// ---------------------------------------------------------------------------
// Core handler
// ---------------------------------------------------------------------------

async function handleCheckoutInit(req: Request): Promise<Response> {
  // --- 1. Parse and validate the request body ---
  let rawBody: Record<string, unknown>;
  try {
    rawBody = await req.json();
  } catch {
    return json({ error: "Request body must be valid JSON." }, 400);
  }

  let payload: CheckoutInitPayload;
  try {
    payload = validatePayload(rawBody);
  } catch (validationError: unknown) {
    const message = validationError instanceof Error
      ? validationError.message
      : "Invalid request payload.";
    return json({ error: message }, 400);
  }

  const { buyer_uuid, shop_id, item_id, recipient_name, recipient_phone, origin_type } = payload;

  // --- 2. Read environment variables ---
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey) {
    console.error("[checkout-init] Missing critical Supabase environment variables.");
    return json({ error: "Server configuration error. Please contact support." }, 500);
  }

  // --- 3. Build the caller-auth client (respects RLS on the items table) ---
  //
  // The Authorization header from the frontend carries the logged-in user's JWT.
  // We pass it to createClient so that all reads execute under the caller's
  // identity — this means your RLS policies on `items` are fully enforced.
  const authHeader = req.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return json({ error: "A valid Authorization Bearer token is required." }, 401);
  }

  const callerClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: {
      // Prevent the client from attempting to use/refresh a persisted session.
      // In an Edge Function, we always operate statelessly with the provided JWT.
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  // --- 4. Verify the caller's identity ---
  //
  // We confirm the JWT is valid and extract the user. This prevents a scenario
  // where a forged token slips through the anon-key client.
  const { data: { user: callerUser }, error: authError } = await callerClient.auth.getUser();
  if (authError || !callerUser) {
    console.error("[checkout-init] JWT validation failed:", authError?.message);
    return json({ error: "Unauthorized. Your session may have expired — please log in again." }, 401);
  }

  // Sanity-check: the buyer_uuid in the payload must match the authenticated user.
  // This prevents one user from submitting a checkout on behalf of another.
  if (callerUser.id !== buyer_uuid) {
    console.error(
      `[checkout-init] buyer_uuid mismatch: token owner=${callerUser.id}, payload buyer_uuid=${buyer_uuid}`,
    );
    return json({ error: "Forbidden. buyer_uuid does not match the authenticated user." }, 403);
  }

  // --- 5. Fetch item base_price (via caller client — RLS enforced) ---
  const { data: itemRow, error: itemError } = await callerClient
    .from("items")
    .select("base_price")
    .eq("id", item_id)
    .single<ItemRow>();

  if (itemError) {
    console.error(`[checkout-init] Failed to fetch item '${item_id}':`, itemError.message);
    // 'PGRST116' = "The result contains 0 rows" (PostgREST single() with no match)
    if (itemError.code === "PGRST116") {
      return json({ error: `Item '${item_id}' was not found or is not available for purchase.` }, 404);
    }
    return json({ error: "Failed to retrieve item details. Please try again." }, 500);
  }

  if (itemRow === null || typeof itemRow.base_price !== "number") {
    console.error(`[checkout-init] Item '${item_id}' returned null or malformed base_price.`);
    return json({ error: "Item data is incomplete. Please contact support." }, 500);
  }

  const { base_price } = itemRow;

  // Guard: base_price must be a positive integer.
  if (!Number.isFinite(base_price) || base_price <= 0 || !Number.isInteger(base_price)) {
    console.error(
      `[checkout-init] Item '${item_id}' has an invalid base_price value: ${base_price}`,
    );
    return json({ error: "Item has an invalid price configuration." }, 500);
  }

  // --- 6. Apply the 3-tier pricing matrix ---
  //
  //   LOCAL:         checkout_price = round(base_price × 1.10)
  //   INTERNATIONAL: checkout_price = round(base_price × 1.30)
  //
  // Math.round() ensures the result is a clean integer even if the
  // intermediate floating-point product has a fractional component.
  const checkout_price = calculateCheckoutPrice(base_price, origin_type);

  console.log(
    `[checkout-init] Pricing matrix applied | item=${item_id} | base=${base_price} ZMW | origin=${origin_type} | multiplier=${PRICING_MULTIPLIERS[origin_type]} | checkout=${checkout_price} ZMW`,
  );

  // --- 7. Generate the cryptographically secure claim code ---
  const claim_code = generateClaimCode(8);

  // --- 8. Insert into claim_vouchers using the service-role client ---
  //
  // The voucher insert is a privileged operation — the buyer should not be
  // able to craft arbitrary vouchers for themselves via the RLS anon path.
  // We use the admin client here and rely on the prior auth checks above as
  // the security gate.
  const adminClient = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  const { data: voucherData, error: insertError } = await adminClient
    .from("claim_vouchers")
    .insert({
      buyer_uuid,
      shop_id,
      item_id,
      recipient_name,
      recipient_phone,
      origin_type,
      claim_code,
      checkout_price,
      status: "pending_payment",
      created_at: new Date().toISOString(),
    })
    .select("voucher_id, claim_code, checkout_price")
    .single<VoucherInsertResult>();

  if (insertError || !voucherData) {
    console.error("[checkout-init] Failed to insert claim_voucher:", insertError?.message);
    return json({ error: "Failed to create checkout session. Please try again." }, 500);
  }

  // --- 9. Return the voucher details to the frontend ---
  //
  // The client uses these three values to:
  //   - `voucher_id`     → track the checkout in subsequent API calls
  //   - `claim_code`     → displayed in the UI as the gift code
  //   - `checkout_price` → initialise the Flutterwave payment modal amount
  console.log(
    `[checkout-init] Voucher created | voucher_id=${voucherData.voucher_id} | claim_code=${voucherData.claim_code} | checkout_price=${voucherData.checkout_price}`,
  );

  return json({
    success: true,
    voucher_id: voucherData.voucher_id,
    claim_code: voucherData.claim_code,
    checkout_price: voucherData.checkout_price,
  });
}

// ---------------------------------------------------------------------------
// Deno.serve entry-point
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request): Promise<Response> => {
  // Answer CORS preflight immediately — no auth required for OPTIONS.
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // This function only accepts POST.
  if (req.method !== "POST") {
    return json({ error: `Method '${req.method}' is not allowed. Use POST.` }, 405);
  }

  try {
    return await handleCheckoutInit(req);
  } catch (unhandled: unknown) {
    // Last-resort catch — should not be reachable under normal conditions
    // because `handleCheckoutInit` handles its own errors. Logged for debugging.
    const message = unhandled instanceof Error ? unhandled.message : "An unknown error occurred.";
    console.error("[checkout-init] Unhandled exception:", message);
    return json({ error: "Internal server error." }, 500);
  }
});
