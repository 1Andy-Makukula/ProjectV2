import { createClient } from "jsr:@supabase/supabase-js@2.49.8";
import { getCorsHeaders } from "../_shared/cors.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FulfillVoucherPayload {
  claim_code: string;
  present_item_ids: string[];  // order_item_id[] — items physically handed over
  missing_item_ids: string[];  // order_item_id[] — items out of stock / not given
}

interface ShopOrderRow {
  shop_order_id: string;
  shop_id: string;
  transaction_id: string;
  claim_status: string;
  subtotal: number;
  shop?: {
    name: string;
  };
}

interface OrderItemRow {
  order_item_id: string;
  allocated_price: number;
}

interface TransactionRow {
  buyer_id: string;
}

interface PriceResult {
  present_total: number;
  missing_total: number;
}

// ---------------------------------------------------------------------------
// CORS
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function json(req: Request, data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
  });
}

function getAdminClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("[fulfill-voucher] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

// ---------------------------------------------------------------------------
// Payload validation
// ---------------------------------------------------------------------------

function validatePayload(raw: Record<string, unknown>): FulfillVoucherPayload {
  const { claim_code, present_item_ids, missing_item_ids } = raw;

  if (typeof claim_code !== "string" || claim_code.trim().length === 0) {
    throw new Error("claim_code is required and must be a non-empty string.");
  }
  const code = claim_code.trim().toUpperCase();
  if (!/^[A-Z0-9]{8}$/.test(code)) {
    throw new Error("claim_code must be exactly 8 uppercase alphanumeric characters.");
  }

  if (!Array.isArray(present_item_ids)) {
    throw new Error("present_item_ids must be an array.");
  }
  if (!Array.isArray(missing_item_ids)) {
    throw new Error("missing_item_ids must be an array.");
  }
  if (present_item_ids.length === 0 && missing_item_ids.length === 0) {
    throw new Error("At least one item must be present or missing.");
  }

  // Guard for duplicate IDs across both arrays (cashier UI bug)
  const presentSet = new Set<string>(present_item_ids);
  for (const id of missing_item_ids) {
    if (presentSet.has(id)) {
      throw new Error(`Item '${id}' appears in both present_item_ids and missing_item_ids.`);
    }
  }

  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  for (const id of [...present_item_ids, ...missing_item_ids]) {
    if (typeof id !== "string" || !uuidPattern.test(id)) {
      throw new Error(`Item ID '${id}' is not a valid UUID.`);
    }
  }

  return {
    claim_code: code,
    present_item_ids: present_item_ids as string[],
    missing_item_ids: missing_item_ids as string[],
  };
}

// ---------------------------------------------------------------------------
// Step 1 — Authenticate & verify merchant shop ownership
// ---------------------------------------------------------------------------

async function verifyMerchant(
  httpReq: Request,
  shopId: string,
  db: ReturnType<typeof getAdminClient>,
): Promise<{ user_id: string } | Response> {
  const authHeader = httpReq.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return json(httpReq, { error: "A valid Authorization Bearer token is required." }, 401);
  }

  const { data: { user }, error: authErr } = await db.auth.getUser(authHeader.split(" ")[1]);
  if (authErr || !user) {
    console.error("[fulfill-voucher] JWT invalid:", authErr?.message);
    return json(httpReq, { error: "Unauthorized. Session may have expired." }, 401);
  }

  const { data: assignment, error: assignErr } = await db
    .from("merchant_shops")
    .select("shop_id")
    .eq("user_id", user.id)
    .eq("shop_id", shopId)
    .maybeSingle<{ shop_id: string }>();

  if (assignErr) {
    console.error("[fulfill-voucher] Shop assignment lookup failed:", assignErr.message);
    return json(httpReq, { error: "Failed to verify shop authorisation." }, 500);
  }
  if (!assignment) {
    console.error(`[fulfill-voucher] DENIED: user=${user.id} not assigned to shop=${shopId}`);
    return json(httpReq, { error: "Forbidden. You are not authorised to fulfil orders for this shop." }, 403);
  }

  return { user_id: user.id };
}

// ---------------------------------------------------------------------------
// Step 2 — Fetch pending shop_order (read-only, before auth)
// ---------------------------------------------------------------------------

async function fetchPendingOrder(
  httpReq: Request,
  db: ReturnType<typeof getAdminClient>,
  claimCode: string,
): Promise<ShopOrderRow | Response> {
  const { data: order, error } = await db
    .from("shop_orders")
    .select("shop_order_id, shop_id, transaction_id, claim_status, subtotal, shop:shop_id(name)")
    .eq("claim_code", claimCode)
    .eq("claim_status", "PENDING")
    .maybeSingle<ShopOrderRow>();

  if (error) {
    console.error(`[fulfill-voucher] Lookup failed for claim_code=${claimCode}:`, error.message);
    return json(httpReq, { error: "Failed to look up order." }, 500);
  }
  if (!order) {
    return json(
      httpReq,
      { error: "Invalid claim code or order is not ready for fulfillment.", rejection_reason: "Invalid or already processed." },
      403,
    );
  }

  return order;
}

// ---------------------------------------------------------------------------
// Step 3 — Update order_items fulfillment_status (legacy helpers; RPC preferred)
// ---------------------------------------------------------------------------

async function updateItemStatuses(
  db: ReturnType<typeof getAdminClient>,
  shopOrderId: string,
  presentIds: string[],
  missingIds: string[],
): Promise<void> {
  // COLLECTED items
  if (presentIds.length > 0) {
    const { error } = await db
      .from("order_items")
      .update({ fulfillment_status: "COLLECTED", fulfilled_at: new Date().toISOString() })
      .eq("shop_order_id", shopOrderId)
      .in("order_item_id", presentIds);
    if (error) throw new Error(`Failed to mark items as COLLECTED: ${error.message}`);
  }

  // MISSING items
  if (missingIds.length > 0) {
    const { error } = await db
      .from("order_items")
      .update({ fulfillment_status: "MISSING" })
      .eq("shop_order_id", shopOrderId)
      .in("order_item_id", missingIds);
    if (error) throw new Error(`Failed to mark items as MISSING: ${error.message}`);
  }
}

// ---------------------------------------------------------------------------
// Step 4 — Compute present/missing price split
// ---------------------------------------------------------------------------

async function computePriceSplit(
  db: ReturnType<typeof getAdminClient>,
  shopOrderId: string,
  presentIds: string[],
  missingIds: string[],
): Promise<PriceResult> {
  const allIds = [...presentIds, ...missingIds];

  const { data: rows, error } = await db
    .from("order_items")
    .select("order_item_id, allocated_price")
    .eq("shop_order_id", shopOrderId)
    .in("order_item_id", allIds);

  if (error || !rows) throw new Error(`Failed to fetch item prices: ${error?.message}`);

  const presentSet = new Set(presentIds);
  let present_total = 0;
  let missing_total = 0;

  for (const row of rows as OrderItemRow[]) {
    if (presentSet.has(row.order_item_id)) {
      present_total += row.allocated_price;
    } else {
      missing_total += row.allocated_price;
    }
  }

  return { present_total, missing_total };
}

// ---------------------------------------------------------------------------
// Step 5 — Write payout_ledger credit for merchant (present items)
// ---------------------------------------------------------------------------

async function creditMerchantLedger(
  db: ReturnType<typeof getAdminClient>,
  shopOrderId: string,
  shopId: string,
  amount: number,
  claimCode: string,
): Promise<void> {
  if (amount <= 0) return; // Nothing to pay out

  const { error } = await db
    .from("payout_ledger")
    .insert({
      shop_order_id: shopOrderId,
      shop_id: shopId,
      credit_amount: amount,
      ledger_type: "FULFILLMENT_CREDIT",
      reference: claimCode,
      created_at: new Date().toISOString(),
    });

  if (error) throw new Error(`Failed to write merchant payout ledger: ${error.message}`);

  console.log(`[fulfill-voucher] Merchant credit | shop_id=${shopId} | amount=${amount} ZMW`);
}

// ---------------------------------------------------------------------------
// Step 6 — Write kithly_wallets credit for sender (missing items refund)
// ---------------------------------------------------------------------------

async function creditSenderWallet(
  db: ReturnType<typeof getAdminClient>,
  transactionId: string,
  shopOrderId: string,
  amount: number,
  claimCode: string,
): Promise<void> {
  if (amount <= 0) return; // No missing items — nothing to refund

  // Resolve the original buyer_id from the parent transaction
  const { data: txn, error: txnErr } = await db
    .from("transactions")
    .select("buyer_id")
    .eq("transaction_id", transactionId)
    .single<TransactionRow>();

  if (txnErr || !txn) {
    throw new Error(`Failed to resolve buyer for transaction ${transactionId}: ${txnErr?.message}`);
  }

  // Upsert into kithly_wallets: add the missing-item credit to sender's balance.
  // Using an upsert so a wallet row is created automatically if this is
  // the sender's first credit — no separate wallet-creation step needed.
  const { error } = await db.rpc("increment_wallet_balance", {
    p_user_id: txn.buyer_id,
    p_amount: amount,
    p_reference: `PARTIAL_REFUND:${claimCode}`,
    p_shop_order_id: shopOrderId,
  });

  if (error) {
    // Fallback: direct insert if RPC is not yet deployed
    console.warn("[fulfill-voucher] increment_wallet_balance RPC failed, falling back to insert:", error.message);
    const { error: insertErr } = await db
      .from("kithly_wallets")
      .insert({
        user_id: txn.buyer_id,
        credit_amount: amount,
        wallet_type: "PARTIAL_REFUND",
        reference: `PARTIAL_REFUND:${claimCode}`,
        shop_order_id: shopOrderId,
        created_at: new Date().toISOString(),
      });
    if (insertErr) throw new Error(`Failed to credit sender wallet: ${insertErr.message}`);
  }

  console.log(`[fulfill-voucher] Sender wallet credit | buyer_id=${txn.buyer_id} | amount=${amount} ZMW`);
}

// ---------------------------------------------------------------------------
// Step 7 — Update shop_orders status (idempotency fence)
// ---------------------------------------------------------------------------

async function finaliseShopOrder(
  db: ReturnType<typeof getAdminClient>,
  shopOrderId: string,
  hasMissingItems: boolean,
): Promise<boolean> {
  const claimStatus = hasMissingItems ? "PARTIAL_FULFILLMENT" : "FULFILLED";
  const settlementTargetTime = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(); // NOW + 48 h

  const { data, error } = await db
    .from("shop_orders")
    .update({
      claim_status: claimStatus,
      settlement_target_time: settlementTargetTime,
      fulfilled_at: new Date().toISOString(),
    })
    .eq("claim_status", "PROCESSING_FULFILLMENT")
    .eq("shop_order_id", shopOrderId)
    .select("shop_order_id");

  if (error) throw new Error(`Failed to finalise shop_order: ${error.message}`);

  const rowsAffected = (data as unknown[])?.length ?? 0;

  if (rowsAffected === 0) {
    throw new Error(`Failed to finalise shop_order: lock was lost or order not in PROCESSING_FULFILLMENT state.`);
  }

  console.log(`[fulfill-voucher] shop_order finalised | id=${shopOrderId} | status=${claimStatus} | settlement=${settlementTargetTime}`);
  return true;
}

// ---------------------------------------------------------------------------
// Step 8 — Immutable transaction_events ledger write
// ---------------------------------------------------------------------------

async function writeLedgerEvent(
  db: ReturnType<typeof getAdminClient>,
  shopOrderId: string,
  merchantUserId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const { error } = await db
    .from("transaction_events")
    .insert({
      shop_order_id: shopOrderId,
      event_type: "CLAIM_VERIFIED",
      payload,
      created_at: new Date().toISOString(),
    });

  if (error) {
    // Non-fatal: log for ops but never block the success response.
    console.error(
      `[fulfill-voucher] LEDGER WRITE FAILED | shop_order_id=${shopOrderId}:`,
      error.code, error.message,
    );
  } else {
    console.log(`[fulfill-voucher] Ledger event written | shop_order_id=${shopOrderId} | merchant=${merchantUserId}`);
  }
}

// ---------------------------------------------------------------------------
// Core handler
// ---------------------------------------------------------------------------

async function handleFulfillVoucher(req: Request): Promise<Response> {
  try {
    // 1. Parse body
    let raw: Record<string, unknown>;
    try {
      raw = await req.json();
    } catch {
      return json(req, { error: "Request body must be valid JSON." }, 400);
    }

    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      return json(req, { error: "Request body must be a JSON object." }, 400);
    }

    // 2. Validate payload
    let payload: FulfillVoucherPayload;
    try {
      payload = validatePayload(raw);
    } catch (e: unknown) {
      return json(req, { error: e instanceof Error ? e.message : "Invalid payload." }, 400);
    }

    const { claim_code, present_item_ids, missing_item_ids } = payload;

    console.log(
      `[fulfill-voucher] Request | claim_code=${claim_code} | present=${present_item_ids.length} | missing=${missing_item_ids.length}`,
    );

    // 3. Admin client
    let db: ReturnType<typeof getAdminClient>;
    try {
      db = getAdminClient();
    } catch (e: unknown) {
      console.error(e instanceof Error ? e.message : e);
      return json(req, { error: "Server configuration error." }, 500);
    }

    // 4. Read pending order (no lock yet — prevents unauthenticated DoS)
    const pendingResult = await fetchPendingOrder(req, db, claim_code);
    if (pendingResult instanceof Response) return pendingResult;
    const pendingOrder = pendingResult;

    // 5. Verify the caller is a merchant assigned to this order's shop
    const merchantResult = await verifyMerchant(req, pendingOrder.shop_id, db);
    if (merchantResult instanceof Response) return merchantResult;
    const { user_id: merchantUserId } = merchantResult;

    console.log(`[fulfill-voucher] Merchant verified | user=${merchantUserId} | shop=${pendingOrder.shop_id}`);

    // 6. Atomic financial pipeline (lock + ledger inside Postgres)
    let fulfillResult: any;
    try {
      const { data, error: fulfillError } = await db.rpc("fulfill_voucher_atomic", {
        p_claim_code: claim_code,
        p_present_item_ids: present_item_ids,
        p_missing_item_ids: missing_item_ids,
        p_merchant_user_id: merchantUserId,
      });

      if (fulfillError) {
        console.error("[fulfill-voucher] fulfill_voucher_atomic database error:", fulfillError);
        return json(req, {
          error: "Database transaction failed.",
          details: fulfillError.message,
          code: fulfillError.code,
          hint: fulfillError.hint
        }, 400);
      }
      fulfillResult = data;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[fulfill-voucher] rpc call threw exception:", msg);
      return json(req, { error: "RPC invocation failed.", details: msg }, 500);
    }

    if (!fulfillResult || !fulfillResult.success) {
      console.error("[fulfill-voucher] fulfill_voucher_atomic returned unsuccessful response:", fulfillResult);
      return json(req, { error: "Fulfillment failed to execute successfully.", result: fulfillResult }, 500);
    }

    // --- Step 9: Telemetry Logging for real-time customer tracking ---
    const shopName = pendingOrder.shop?.name || "KithLy Partner Shop";
    const { error: telemetryErr } = await db
      .from("transaction_events")
      .insert({
        shop_order_id: pendingOrder.shop_order_id,
        transaction_id: pendingOrder.transaction_id,
        event_type: "FULFILLMENT_PROCESSED",
        payload: {
          present_count: present_item_ids.length,
          missing_count: missing_item_ids.length,
          shop_name: shopName,
        },
        created_at: new Date().toISOString(),
      });

    if (telemetryErr) {
      console.error("[fulfill-voucher] Telemetry insert failed:", telemetryErr.message);
    } else {
      console.log("[fulfill-voucher] FULFILLMENT_PROCESSED telemetry event successfully logged.");
    }

    return json(req, {
      success: true,
      claim_status: fulfillResult.claim_status,
      merchant_credit_zmw: fulfillResult.merchant_credit_zmw,
      sender_refund_zmw: fulfillResult.sender_refund_zmw,
      settlement_window_hours: 48,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error.";
    console.error("[fulfill-voucher] Execution crash:", msg);
    return json(req, { error: "An unexpected error occurred during fulfillment.", details: msg }, 500);
  }
}

// ---------------------------------------------------------------------------
// Deno.serve entry-point
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: getCorsHeaders(req) });
  }
  if (req.method !== "POST") {
    return json(req, { error: `Method '${req.method}' not allowed. Use POST.` }, 405);
  }
  try {
    return await handleFulfillVoucher(req);
  } catch (unhandled: unknown) {
    const msg = unhandled instanceof Error ? unhandled.message : "Unknown error.";
    console.error("[fulfill-voucher] UNHANDLED EXCEPTION:", msg);
    return json(req, { error: "Internal server error." }, 500);
  }
});
