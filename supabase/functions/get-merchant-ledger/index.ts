import { createClient } from "jsr:@supabase/supabase-js@2.49.8";
import { getCorsHeaders } from "../_shared/cors.ts";

interface FormattedLedgerRow {
  /** @deprecated alias — use shop_order_id in new UI */
  voucher_id: string;
  shop_order_id: string;
  item_name: string;
  base_price: number;
  settlement_target_time: string;
  claim_code: string;
}

interface RawShopOrderRow {
  shop_order_id: string;
  subtotal: number;
  settlement_target_time: string | null;
  claim_code: string;
  order_items: Array<{
    item: { name: string; price_zmw: number } | null;
  }> | null;
}

function json(req: Request, data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
  });
}

function getAdminClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceRoleKey) {
    throw new Error("[get-merchant-ledger] Missing Supabase configuration.");
  }
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function verifyMerchantIdentity(
  req: Request,
  shopId: string,
  adminClient: ReturnType<typeof getAdminClient>,
): Promise<{ user: { id: string } } | Response> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return json(req, { error: "A valid Authorization Bearer token is required." }, 401);
  }

  const { data: { user }, error: authError } = await adminClient.auth.getUser(
    authHeader.split(" ")[1],
  );
  if (authError || !user) {
    return json(req, { error: "Unauthorized." }, 401);
  }

  const { data: assignment, error: assignmentError } = await adminClient
    .from("merchant_shops")
    .select("shop_id")
    .eq("user_id", user.id)
    .eq("shop_id", shopId)
    .maybeSingle();

  if (assignmentError) {
    return json(req, { error: "Failed to verify shop authorisation." }, 500);
  }
  if (!assignment) {
    return json(req, { error: "Forbidden." }, 403);
  }

  return { user };
}

async function handleGetMerchantLedger(req: Request): Promise<Response> {
  let rawBody: Record<string, unknown>;
  try {
    rawBody = await req.json();
  } catch {
    return json(req, { error: "Request body must be valid JSON." }, 400);
  }

  const shop_id = rawBody.shop_id;
  if (typeof shop_id !== "string" || shop_id.trim().length === 0) {
    return json(req, { error: "shop_id is required." }, 400);
  }

  const shopId = shop_id.trim();
  const adminClient = getAdminClient();

  const identityResult = await verifyMerchantIdentity(req, shopId, adminClient);
  if (identityResult instanceof Response) return identityResult;

  // V2: fulfilled shop_orders awaiting settlement (48h window), not yet settled
  const { data: rows, error: fetchError } = await adminClient
    .from("shop_orders")
    .select(`
      shop_order_id,
      subtotal,
      settlement_target_time,
      claim_code,
      order_items (
        item:item_id (name, price_zmw)
      )
    `)
    .eq("shop_id", shopId)
    .in("claim_status", ["FULFILLED", "PARTIAL_FULFILLMENT"])
    .eq("settled", false)
    .not("settlement_target_time", "is", null)
    .order("settlement_target_time", { ascending: true });

  if (fetchError) {
    console.error("[get-merchant-ledger] fetch failed:", fetchError.message);
    return json(req, { error: "Failed to retrieve settlement ledger." }, 500);
  }

  const formatted: FormattedLedgerRow[] = ((rows ?? []) as RawShopOrderRow[]).map((row) => {
    const firstItem = row.order_items?.[0]?.item;
    return {
      voucher_id: row.shop_order_id,
      shop_order_id: row.shop_order_id,
      item_name: firstItem?.name ?? "Gift order",
      base_price: row.subtotal,
      settlement_target_time: row.settlement_target_time ?? new Date().toISOString(),
      claim_code: row.claim_code,
    };
  });

  console.log(
    `[get-merchant-ledger] V2 | user=${identityResult.user.id} | shop=${shopId} | rows=${formatted.length}`,
  );

  return json(req, { success: true, data: formatted });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: getCorsHeaders(req) });
  }
  if (req.method !== "POST") {
    return json(req, { error: "Method not allowed." }, 405);
  }
  try {
    return await handleGetMerchantLedger(req);
  } catch (e) {
    console.error("[get-merchant-ledger]", e);
    return json(req, { error: "Internal server error." }, 500);
  }
});
