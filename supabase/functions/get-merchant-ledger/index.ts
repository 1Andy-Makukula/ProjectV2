import { createClient } from "jsr:@supabase/supabase-js@2.49.8";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * The expected request payload shape.
 */
interface GetLedgerPayload {
  /**
   * The UUID of the shop whose pending settlement ledger is being requested.
   */
  shop_id: string;
}

/**
 * Represents the raw shape returned by PostgREST when querying
 * claim_vouchers joined with items.
 */
interface RawLedgerRow {
  voucher_id: string;
  settlement_target_time: string | null;
  items: {
    name: string;
    base_price: number;
  } | null;
}

/**
 * The flattened, strongly-typed shape returned to the frontend.
 */
interface FormattedLedgerRow {
  voucher_id: string;
  item_name: string;
  base_price: number;
  settlement_target_time: string;
}

// ---------------------------------------------------------------------------
// CORS configuration
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

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/**
 * Returns a Supabase admin client. We use the service-role key to bypass
 * RLS on the read path, but explicitly enforce shop-boundary isolation
 * in the application logic.
 */
function getAdminClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!url || !serviceRoleKey) {
    throw new Error(
      "[get-merchant-ledger] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not configured.",
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
// Merchant identity verification
// ---------------------------------------------------------------------------

/**
 * Validates the caller's JWT and enforces shop-boundary isolation by checking
 * the `merchant_shops` junction table.
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

  const {
    data: { user },
    error: authError,
  } = await adminClient.auth.getUser(authHeader.split(" ")[1]);

  if (authError || !user) {
    console.error(
      "[get-merchant-ledger] JWT validation failed:",
      authError?.message ?? "No user returned.",
    );
    return json(
      { error: "Unauthorized. Your session may have expired — please log in again." },
      401,
    );
  }

  const { data: assignment, error: assignmentError } = await adminClient
    .from("merchant_shops")
    .select("shop_id")
    .eq("user_id", user.id)
    .eq("shop_id", shopId)
    .maybeSingle<{ shop_id: string }>();

  if (assignmentError) {
    console.error(
      `[get-merchant-ledger] Shop assignment lookup failed for user=${user.id}, shop=${shopId}:`,
      assignmentError.message,
    );
    return json({ error: "Failed to verify shop authorisation. Please try again." }, 500);
  }

  if (!assignment) {
    console.error(
      `[get-merchant-ledger] AUTHORISATION DENIED: user=${user.id} is not assigned to shop=${shopId}.`,
    );
    return json(
      { error: "Forbidden. You are not authorised to view the ledger for this shop." },
      403,
    );
  }

  return { user };
}

// ---------------------------------------------------------------------------
// Core handler
// ---------------------------------------------------------------------------

async function handleGetMerchantLedger(req: Request): Promise<Response> {
  // --- 1. Parse and validate the payload ---
  let rawBody: Record<string, unknown>;
  try {
    rawBody = await req.json();
  } catch {
    return json({ error: "Request body must be valid JSON." }, 400);
  }

  if (!rawBody || typeof rawBody !== "object" || Array.isArray(rawBody)) {
    return json({ error: "Request body must be a JSON object." }, 400);
  }

  const shop_id = rawBody.shop_id;

  if (typeof shop_id !== "string" || shop_id.trim().length === 0) {
    return json({ error: "shop_id is required and must be a non-empty string." }, 400);
  }

  // --- 2. Build the admin client ---
  let adminClient: ReturnType<typeof getAdminClient>;
  try {
    adminClient = getAdminClient();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Config error";
    console.error(msg);
    return json({ error: "Server configuration error." }, 500);
  }

  // --- 3. Enforce shop ownership ---
  const identityResult = await verifyMerchantIdentity(req, shop_id.trim(), adminClient);
  if (identityResult instanceof Response) {
    return identityResult; // Returns 401/403/500 if auth or authorisation fails
  }

  console.log(
    `[get-merchant-ledger] Authorised ledger request | user=${identityResult.user.id} | shop=${shop_id}`,
  );

  // --- 4. Fetch the pending settlement pipeline ---
  //
  // We perform an inner join to the items table to retrieve the item name and
  // the ZMW base price (which represents the amount owed to the merchant).
  //
  // We specifically filter for payout_status = 'PENDING_BATCH', meaning the
  // buyer's payment has been confirmed by Layer A/C and the funds are awaiting
  // periodic settlement transfer to the merchant.
  const { data: ledgerRows, error: fetchError } = await adminClient
    .from("claim_vouchers")
    .select(`
      voucher_id,
      settlement_target_time,
      items!inner (
        name,
        base_price
      )
    `)
    .eq("shop_id", shop_id.trim())
    .eq("payout_status", "PENDING_BATCH")
    .order("settlement_target_time", { ascending: true });

  if (fetchError) {
    console.error(
      `[get-merchant-ledger] Failed to fetch ledger for shop=${shop_id}:`,
      fetchError.message,
      fetchError.details ?? "",
    );
    return json({ error: "Failed to retrieve the settlement ledger." }, 500);
  }

  // --- 5. Format and return the payload ---
  //
  // We flatten the joined result into a clean 1D array for the frontend.
  // We also provide a default ISO string fallback for settlement_target_time
  // just in case of historical corrupt data, though it should be NOT NULL.
  const formattedLedger: FormattedLedgerRow[] = (ledgerRows as unknown as RawLedgerRow[]).map(
    (row) => {
      return {
        voucher_id: row.voucher_id,
        item_name: row.items?.name ?? "Unknown Item",
        base_price: row.items?.base_price ?? 0,
        settlement_target_time: row.settlement_target_time ?? new Date().toISOString(),
      };
    },
  );

  console.log(
    `[get-merchant-ledger] Fetched ${formattedLedger.length} pending payouts for shop=${shop_id}.`,
  );

  return json({
    success: true,
    data: formattedLedger,
  });
}

// ---------------------------------------------------------------------------
// Deno.serve entry-point
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ error: `Method '${req.method}' is not allowed. Use POST.` }, 405);
  }

  try {
    return await handleGetMerchantLedger(req);
  } catch (unhandled: unknown) {
    const message = unhandled instanceof Error ? unhandled.message : "Unknown error";
    console.error("[get-merchant-ledger] UNHANDLED EXCEPTION:", message);
    return json({ error: "Internal server error." }, 500);
  }
});
