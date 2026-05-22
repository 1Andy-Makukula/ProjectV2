import { createClient } from "jsr:@supabase/supabase-js@2.49.8";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * The validated, strongly-typed request payload accepted by this function.
 */
interface FulfillVoucherPayload {
  /**
   * The 8-character uppercase alphanumeric claim code printed on the gift or
   * delivered via WhatsApp. The merchant scans or types this at the POS.
   */
  claim_code: string;

  /**
   * The UUID of the shop performing the redemption. Used by the RPC to
   * enforce shop-boundary isolation — a merchant can only fulfil vouchers
   * belonging to their own shop.
   */
  shop_id: string;
}

/**
 * The row shape returned by the `atomic_fulfill_voucher` Postgres RPC.
 *
 * The RPC executes the following atomically inside a single transaction:
 *   1. Validates that `claim_code` exists and belongs to `shop_id`.
 *   2. Validates that `payout_status = 'PENDING_BATCH'` (payment confirmed).
 *   3. Validates that `claim_status = 'PENDING'` (not already redeemed).
 *   4. If any check fails, raises an exception whose message begins with
 *      'FRAUD_REJECTION:' so this function can discriminate it precisely.
 *   5. On success: sets `claim_status = 'REDEEMED'` and `redeemed_at = now()`.
 *   6. Returns the voucher metadata for the POS display.
 */
interface AtomicFulfillResult {
  voucher_id: string;
  item_name: string;
  recipient_name: string;
  claim_code: string;
  shop_id: string;
}

/**
 * The row inserted into `transaction_events` after a fulfillment attempt.
 * We only select back the PK to confirm the insert succeeded.
 */
interface LedgerInsertResult {
  id: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * The exact prefix the `atomic_fulfill_voucher` Postgres function raises in
 * its exception message when it detects a fraud or policy violation.
 *
 * The RPC is expected to raise exceptions in the format:
 *   RAISE EXCEPTION 'FRAUD_REJECTION: <reason>'
 *
 * This prefix is the discriminant that separates intentional business-rule
 * rejections from unexpected infrastructure errors.
 */
const FRAUD_REJECTION_PREFIX = "FRAUD_REJECTION:" as const;

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

/** Serialise a value as a JSON response with CORS headers attached. */
function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/**
 * Returns a Supabase admin client initialised with the service-role key.
 * Bypasses Row Level Security — appropriate here because:
 *   a) The caller's identity is verified via JWT before this client is used.
 *   b) The RPC itself enforces shop-boundary isolation at the database level.
 *   c) The ledger insert must succeed regardless of the caller's RLS context.
 *
 * @throws `Error` if required environment variables are absent.
 */
function getAdminClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!url || !serviceRoleKey) {
    throw new Error(
      "[fulfill-voucher] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not configured.",
    );
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      // Edge Functions are stateless — never persist or refresh sessions.
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

// ---------------------------------------------------------------------------
// Payload validation
// ---------------------------------------------------------------------------

/**
 * Validates and normalises the raw JSON request body.
 *
 * Normalisation:
 *   - `claim_code` is trimmed and uppercased to tolerate minor input
 *     variations (e.g. a merchant who types "abc12345" instead of "ABC12345").
 *   - `shop_id` is trimmed only — UUIDs are case-insensitive but we preserve
 *     the caller's casing so Postgres can use its index without a cast.
 *
 * @throws `Error` with a descriptive message on any validation failure.
 */
function validatePayload(raw: Record<string, unknown>): FulfillVoucherPayload {
  const { claim_code, shop_id } = raw;

  // --- claim_code ---
  if (claim_code === undefined || claim_code === null) {
    throw new Error("claim_code is required.");
  }
  if (typeof claim_code !== "string") {
    throw new Error("claim_code must be a string.");
  }
  const normalisedCode = claim_code.trim().toUpperCase();
  if (normalisedCode.length === 0) {
    throw new Error("claim_code must not be empty.");
  }
  if (normalisedCode.length !== 8) {
    throw new Error(
      `claim_code must be exactly 8 characters (received ${normalisedCode.length}).`,
    );
  }
  if (!/^[A-Z0-9]{8}$/.test(normalisedCode)) {
    throw new Error(
      "claim_code must contain only uppercase letters and digits (A-Z, 0-9).",
    );
  }

  // --- shop_id ---
  if (shop_id === undefined || shop_id === null) {
    throw new Error("shop_id is required.");
  }
  if (typeof shop_id !== "string") {
    throw new Error("shop_id must be a string.");
  }
  const normalisedShopId = shop_id.trim();
  if (normalisedShopId.length === 0) {
    throw new Error("shop_id must not be empty.");
  }
  // Loose UUID format check — Postgres will reject malformed UUIDs anyway,
  // but this gives a cleaner error message before hitting the database.
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      normalisedShopId,
    )
  ) {
    throw new Error(
      "shop_id must be a valid UUID (xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx).",
    );
  }

  return {
    claim_code: normalisedCode,
    shop_id: normalisedShopId,
  };
}

// ---------------------------------------------------------------------------
// Merchant identity verification
// ---------------------------------------------------------------------------

/**
 * Verifies the Bearer JWT in the Authorization header and confirms that the
 * authenticated user is assigned to the `shop_id` in the payload.
 *
 * This prevents a scenario where a rogue merchant authenticates with their
 * own valid JWT and attempts to redeem vouchers belonging to another shop.
 *
 * @returns The authenticated user object on success.
 * @returns A `Response` to return immediately on auth or authorisation failure.
 */
async function verifyMerchantIdentity(
  req: Request,
  shopId: string,
  adminClient: ReturnType<typeof getAdminClient>,
): Promise<{ user: { id: string } } | Response> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return json({ error: "A valid Authorization Bearer token is required." }, 401);
  }

  // Validate the JWT by calling getUser() — this hits the Supabase Auth API
  // and confirms the token signature and expiry.
  const {
    data: { user },
    error: authError,
  } = await adminClient.auth.getUser(authHeader.split(" ")[1]);

  if (authError || !user) {
    console.error(
      "[fulfill-voucher] JWT validation failed:",
      authError?.message ?? "No user returned.",
    );
    return json(
      { error: "Unauthorized. Your session may have expired — please log in again." },
      401,
    );
  }

  // Confirm the authenticated user is assigned to the target shop.
  // Uses the admin client to bypass RLS so the check is always authoritative.
  const { data: assignment, error: assignmentError } = await adminClient
    .from("merchant_shops")
    .select("shop_id")
    .eq("user_id", user.id)
    .eq("shop_id", shopId)
    .maybeSingle<{ shop_id: string }>();

  if (assignmentError) {
    console.error(
      `[fulfill-voucher] Shop assignment lookup failed for user=${user.id}, shop=${shopId}:`,
      assignmentError.message,
    );
    return json({ error: "Failed to verify shop authorisation. Please try again." }, 500);
  }

  if (!assignment) {
    console.error(
      `[fulfill-voucher] AUTHORISATION DENIED: user=${user.id} is not assigned to shop=${shopId}.`,
    );
    return json(
      { error: "Forbidden. You are not authorised to redeem vouchers for this shop." },
      403,
    );
  }

  return { user };
}

// ---------------------------------------------------------------------------
// Immutable ledger write
// ---------------------------------------------------------------------------

/**
 * Appends an event row to the `transaction_events` audit ledger.
 *
 * This function is intentionally fault-tolerant: errors are logged but not
 * propagated. The fulfillment result has already been determined by the time
 * this is called — the ledger is an audit record, not a gate.
 *
 * @param voucherId  The voucher UUID returned by the RPC.
 * @param eventType  'CLAIM_VERIFIED' on success, 'FRAUD_REJECTION' on fraud.
 * @param payload    Structured JSON object to store alongside the event.
 */
async function writeLedgerEvent(
  adminClient: ReturnType<typeof getAdminClient>,
  voucherId: string,
  eventType: "CLAIM_VERIFIED" | "FRAUD_REJECTION",
  payload: Record<string, unknown>,
): Promise<void> {
  const { data: ledgerRow, error: ledgerError } = await adminClient
    .from("transaction_events")
    .insert({
      voucher_id: voucherId,
      event_type: eventType,
      payload: JSON.stringify(payload),
      created_at: new Date().toISOString(),
    })
    .select("id")
    .single<LedgerInsertResult>();

  if (ledgerError) {
    // Log with full PostgREST error detail so ops can investigate if the
    // ledger is silently failing (e.g. FK violation, RLS, schema mismatch).
    console.error(
      `[fulfill-voucher] LEDGER WRITE FAILED | voucher_id=${voucherId} | event_type=${eventType}:`,
      ledgerError.code,
      ledgerError.message,
      ledgerError.details ?? "",
    );
    return;
  }

  console.log(
    `[fulfill-voucher] Ledger event written | id=${ledgerRow.id} | voucher_id=${voucherId} | event_type=${eventType}`,
  );
}

// ---------------------------------------------------------------------------
// Core handler
// ---------------------------------------------------------------------------

async function handleFulfillVoucher(req: Request): Promise<Response> {
  // --- 1. Parse the request body ---
  let rawBody: Record<string, unknown>;
  try {
    rawBody = await req.json();
  } catch {
    return json({ error: "Request body must be valid JSON." }, 400);
  }

  if (typeof rawBody !== "object" || rawBody === null || Array.isArray(rawBody)) {
    return json({ error: "Request body must be a JSON object." }, 400);
  }

  // --- 2. Validate and normalise the payload ---
  let payload: FulfillVoucherPayload;
  try {
    payload = validatePayload(rawBody);
  } catch (validationError: unknown) {
    const message = validationError instanceof Error
      ? validationError.message
      : "Invalid request payload.";
    return json({ error: message }, 400);
  }

  const { claim_code, shop_id } = payload;

  console.log(
    `[fulfill-voucher] Fulfillment request | claim_code=${claim_code} | shop_id=${shop_id}`,
  );

  // --- 3. Obtain the admin client ---
  let adminClient: ReturnType<typeof getAdminClient>;
  try {
    adminClient = getAdminClient();
  } catch (configError: unknown) {
    const message = configError instanceof Error ? configError.message : "Configuration error.";
    console.error(message);
    return json({ error: "Server configuration error. Please contact support." }, 500);
  }

  // --- 4. Verify the caller is an authenticated merchant assigned to this shop ---
  const identityResult = await verifyMerchantIdentity(req, shop_id, adminClient);
  if (identityResult instanceof Response) {
    // Auth or authorisation failure — return the pre-built error response.
    return identityResult;
  }
  const { user: callerUser } = identityResult;

  console.log(
    `[fulfill-voucher] Merchant verified | user_id=${callerUser.id} | shop_id=${shop_id}`,
  );

  // --- 5. Call the atomic_fulfill_voucher Postgres RPC ---
  //
  // The RPC executes inside a single database transaction. If the voucher is
  // invalid, already redeemed, belongs to a different shop, or the payment
  // has not been confirmed (payout_status != 'PENDING_BATCH'), the RPC raises
  // an exception whose message begins with 'FRAUD_REJECTION:'.
  //
  // We use the admin client so the RPC can execute SET LOCAL and row-level
  // locking without RLS interference. The shop-boundary check is enforced
  // inside the RPC itself via the p_shop_id parameter.
  const { data: rpcResult, error: rpcError } = await adminClient.rpc(
    "atomic_fulfill_voucher",
    {
      p_claim_code: claim_code,
      p_shop_id: shop_id,
    },
  );

  // --- 6. Handle the RPC result ---

  if (rpcError) {
    const errorMessage: string = rpcError.message ?? "";

    // ---- FRAUD_REJECTION path ----
    //
    // The RPC raised an exception that begins with FRAUD_REJECTION:.
    // This covers: invalid code, wrong shop, already redeemed, payment not confirmed.
    // We must log the attempt to the immutable ledger for audit before returning 400.
    if (errorMessage.startsWith(FRAUD_REJECTION_PREFIX)) {
      // Extract the human-readable reason after the prefix.
      const rejectionReason = errorMessage
        .slice(FRAUD_REJECTION_PREFIX.length)
        .trim();

      console.error(
        `[fulfill-voucher] FRAUD_REJECTION | claim_code=${claim_code} | shop_id=${shop_id} | reason=${rejectionReason}`,
      );

      // We don't have a voucher_id because the RPC rejected the lookup.
      // We log the fraud attempt against a synthetic sentinel so the ledger
      // row still provides an ops-searchable record by claim_code.
      // The convention is to use the claim_code itself as the payload key.
      await writeLedgerEvent(
        adminClient,
        // The voucher_id is unknown for rejected attempts. We write to a
        // "sentinel" system-level event instead by using an existing FK-safe
        // approach: write the payload only (see NOTE below).
        // NOTE: If your transaction_events.voucher_id column has a FK
        // constraint to claim_vouchers, you cannot write a free-form UUID here.
        // In that case, look up the voucher_id by claim_code before this block,
        // or relax the FK to allow NULL and make this field nullable.
        // For now we pass a zero UUID as a sentinel — update to NULL if schema allows.
        "00000000-0000-0000-0000-000000000000",
        "FRAUD_REJECTION",
        {
          claim_code,
          shop_id,
          merchant_user_id: callerUser.id,
          rejection_reason: rejectionReason,
          terminal_ip: "edge",
          action: "storefront_scan",
        },
      );

      return json(
        {
          error: "Voucher rejected.",
          rejection_reason: rejectionReason,
          event_type: "FRAUD_REJECTION",
        },
        400,
      );
    }

    // ---- Unexpected infrastructure error ----
    //
    // Not a FRAUD_REJECTION — this is a genuine database or network error.
    // We do NOT write a FRAUD_REJECTION ledger event here because the failure
    // is not the buyer's or merchant's fault.
    console.error(
      `[fulfill-voucher] RPC infrastructure error | claim_code=${claim_code}:`,
      rpcError.code,
      rpcError.message,
      rpcError.details ?? "",
    );
    return json(
      { error: "Voucher verification failed due to a server error. Please try again." },
      500,
    );
  }

  // ---- SUCCESS path ----
  //
  // The RPC succeeded: the voucher is valid, paid, and has been atomically
  // marked as REDEEMED inside the RPC transaction.

  // Type-narrow the result. The RPC returns an array when called via .rpc()
  // in supabase-js; we take the first (and only) row.
  const resultRow = Array.isArray(rpcResult) ? rpcResult[0] : rpcResult;

  if (
    !resultRow ||
    typeof resultRow.voucher_id !== "string" ||
    typeof resultRow.item_name !== "string" ||
    typeof resultRow.recipient_name !== "string"
  ) {
    console.error(
      "[fulfill-voucher] RPC returned a success result with an unexpected shape:",
      JSON.stringify(resultRow),
    );
    return json(
      { error: "Fulfillment completed but the server returned unexpected data. Contact support." },
      500,
    );
  }

  const fulfillResult = resultRow as AtomicFulfillResult;

  console.log(
    `[fulfill-voucher] SUCCESS | voucher_id=${fulfillResult.voucher_id} | item=${fulfillResult.item_name} | recipient=${fulfillResult.recipient_name}`,
  );

  // --- 7. Write the CLAIM_VERIFIED event to the immutable ledger ---
  //
  // The payload is a structured JSON object that provides an audit trail
  // linking the fulfillment to the terminal session and action type.
  await writeLedgerEvent(
    adminClient,
    fulfillResult.voucher_id,
    "CLAIM_VERIFIED",
    {
      terminal_ip: "edge",
      action: "storefront_scan",
      merchant_user_id: callerUser.id,
      shop_id,
      claim_code,
    },
  );

  // --- 8. Return the POS display data to the merchant frontend ---
  //
  // The merchant's storefront app uses item_name and recipient_name to
  // display a confirmation screen: "Gift for [Recipient] — [Item] claimed."
  return json({
    success: true,
    voucher_id: fulfillResult.voucher_id,
    item_name: fulfillResult.item_name,
    recipient_name: fulfillResult.recipient_name,
    claim_code: fulfillResult.claim_code,
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
    return json(
      { error: `Method '${req.method}' is not allowed. Use POST.` },
      405,
    );
  }

  try {
    return await handleFulfillVoucher(req);
  } catch (unhandled: unknown) {
    // Last-resort catch — all expected error paths are handled above.
    // Landing here indicates a genuine programming fault or OOM condition.
    const message = unhandled instanceof Error
      ? unhandled.message
      : "An unknown error occurred.";
    console.error("[fulfill-voucher] UNHANDLED EXCEPTION:", message);
    return json({ error: "Internal server error." }, 500);
  }
});
