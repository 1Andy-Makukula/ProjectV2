import { createClient } from "jsr:@supabase/supabase-js@2.49.8";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PayoutStatus = "PENDING_BATCH" | "SETTLED";

type PayoutMethod = "airtel" | "mtn" | "bank" | string;

interface ClaimVoucherRow {
  voucher_id: string;
  shop_id: string;
  checkout_price: number;
  origin_type: "LOCAL" | "INTERNATIONAL" | string;
  settlement_target_time: string;
}

interface ShopPayoutRow {
  id: string;
  payout_method: PayoutMethod | null;
  payout_details: string | null;
}

interface VoucherSettlement {
  voucher_id: string;
  gross_amount_zmw: number;
  merchant_amount_zmw: number;
  platform_yield_amount_zmw: number;
  platform_yield_bps: number;
}

interface MerchantBatch {
  shop_id: string;
  vouchers: ClaimVoucherRow[];
  settlements: VoucherSettlement[];
  gross_amount_zmw: number;
  merchant_amount_zmw: number;
  platform_yield_amount_zmw: number;
}

interface MockFlutterwaveTransferResult {
  transfer_id: string;
  reference: string;
  status: "SUCCESSFUL";
}

interface MerchantBatchResult {
  shop_id: string;
  voucher_count: number;
  gross_amount_zmw: number;
  merchant_amount_zmw: number;
  platform_yield_amount_zmw: number;
  transfer_id?: string;
  status: "SETTLED" | "SKIPPED" | "FAILED";
  message?: string;
  settled_voucher_ids?: string[];
}

interface LedgerInsertResult {
  id: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FUNCTION_NAME = "batch-payout-sweeper";
const DEFAULT_PAGE_SIZE = 1000;
const DEFAULT_PLATFORM_LOCAL_YIELD_BPS = 500; // 5%
const MAX_BPS = 10_000;
const LEDGER_EVENT_TYPE = "PAYOUT_BATCHED" as const;

const corsHeaders: HeadersInit = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-sweeper-secret",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
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

function getAdminClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!url || !serviceRoleKey) {
    throw new Error(
      `[${FUNCTION_NAME}] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not configured.`,
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

function parseConfiguredBps(): number {
  const rawBps = Deno.env.get("PLATFORM_LOCAL_YIELD_BPS") ??
    Deno.env.get("KITHLY_LOCAL_YIELD_BPS");

  if (rawBps !== undefined && rawBps.trim().length > 0) {
    const parsed = Number(rawBps);
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > MAX_BPS) {
      throw new Error(
        `[${FUNCTION_NAME}] PLATFORM_LOCAL_YIELD_BPS must be an integer between 0 and 10000.`,
      );
    }

    return parsed;
  }

  const rawPercentage = Deno.env.get("PLATFORM_LOCAL_YIELD_PERCENTAGE") ??
    Deno.env.get("KITHLY_LOCAL_YIELD_PERCENTAGE");

  if (rawPercentage === undefined || rawPercentage.trim().length === 0) {
    return DEFAULT_PLATFORM_LOCAL_YIELD_BPS;
  }

  const parsedPercentage = Number(rawPercentage);
  if (
    !Number.isFinite(parsedPercentage) ||
    parsedPercentage < 0 ||
    parsedPercentage > 100
  ) {
    throw new Error(
      `[${FUNCTION_NAME}] PLATFORM_LOCAL_YIELD_PERCENTAGE must be a number between 0 and 100.`,
    );
  }

  return Math.round(parsedPercentage * 100);
}

function assertValidVoucher(row: ClaimVoucherRow): void {
  if (!row.voucher_id || !row.shop_id) {
    throw new Error("Voucher row is missing voucher_id or shop_id.");
  }

  if (
    typeof row.checkout_price !== "number" ||
    !Number.isFinite(row.checkout_price) ||
    !Number.isInteger(row.checkout_price) ||
    row.checkout_price <= 0
  ) {
    throw new Error(
      `Voucher ${row.voucher_id} has invalid checkout_price=${row.checkout_price}.`,
    );
  }
}

function calculateVoucherSettlement(
  voucher: ClaimVoucherRow,
  platformYieldBps: number,
): VoucherSettlement {
  assertValidVoucher(voucher);

  const merchantAmount = Math.floor(
    (voucher.checkout_price * (MAX_BPS - platformYieldBps)) / MAX_BPS,
  );
  const platformYieldAmount = voucher.checkout_price - merchantAmount;

  return {
    voucher_id: voucher.voucher_id,
    gross_amount_zmw: voucher.checkout_price,
    merchant_amount_zmw: merchantAmount,
    platform_yield_amount_zmw: platformYieldAmount,
    platform_yield_bps: platformYieldBps,
  };
}

function groupByMerchant(
  vouchers: ClaimVoucherRow[],
  platformYieldBps: number,
): Map<string, MerchantBatch> {
  const groups = new Map<string, MerchantBatch>();

  for (const voucher of vouchers) {
    const settlement = calculateVoucherSettlement(voucher, platformYieldBps);

    const existing = groups.get(voucher.shop_id) ?? {
      shop_id: voucher.shop_id,
      vouchers: [],
      settlements: [],
      gross_amount_zmw: 0,
      merchant_amount_zmw: 0,
      platform_yield_amount_zmw: 0,
    };

    existing.vouchers.push(voucher);
    existing.settlements.push(settlement);
    existing.gross_amount_zmw += settlement.gross_amount_zmw;
    existing.merchant_amount_zmw += settlement.merchant_amount_zmw;
    existing.platform_yield_amount_zmw += settlement.platform_yield_amount_zmw;

    groups.set(voucher.shop_id, existing);
  }

  return groups;
}

function chunks<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

function verifyOptionalSweeperSecret(req: Request): Response | null {
  const expectedSecret = Deno.env.get("BATCH_PAYOUT_SWEEPER_SECRET");
  if (!expectedSecret) return null;

  const incomingSecret = req.headers.get("x-sweeper-secret");
  const authHeader = req.headers.get("Authorization");
  const bearerToken = authHeader?.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length)
    : null;

  if (incomingSecret === expectedSecret || bearerToken === expectedSecret) {
    return null;
  }

  console.error(`[${FUNCTION_NAME}] Missing or invalid sweeper secret.`);
  return json({ error: "Unauthorized." }, 401);
}

// ---------------------------------------------------------------------------
// Database reads
// ---------------------------------------------------------------------------

async function fetchDueVouchers(
  supabase: ReturnType<typeof getAdminClient>,
  nowIso: string,
): Promise<ClaimVoucherRow[]> {
  const allRows: ClaimVoucherRow[] = [];
  let offset = 0;

  for (;;) {
    const { data, error } = await supabase
      .from("claim_vouchers")
      .select(
        "voucher_id, shop_id, checkout_price, origin_type, settlement_target_time",
      )
      .eq("payout_status", "PENDING_BATCH" satisfies PayoutStatus)
      .lte("settlement_target_time", nowIso)
      .order("settlement_target_time", { ascending: true })
      .order("created_at", { ascending: true })
      .order("voucher_id", { ascending: true })
      .range(offset, offset + DEFAULT_PAGE_SIZE - 1)
      .returns<ClaimVoucherRow[]>();

    if (error) {
      throw new Error(
        `Failed to fetch due claim_vouchers: ${error.code} ${error.message}`,
      );
    }

    const rows = data ?? [];
    allRows.push(...rows);

    if (rows.length < DEFAULT_PAGE_SIZE) break;
    offset += DEFAULT_PAGE_SIZE;
  }

  return allRows;
}

async function fetchShopPayoutDetails(
  supabase: ReturnType<typeof getAdminClient>,
  shopId: string,
): Promise<ShopPayoutRow> {
  const { data, error } = await supabase
    .from("shops")
    .select("id, payout_method, payout_details")
    .eq("id", shopId)
    .single<ShopPayoutRow>();

  if (error) {
    throw new Error(
      `Failed to fetch payout details for shop ${shopId}: ${error.code} ${error.message}`,
    );
  }

  if (!data) {
    throw new Error(`Shop ${shopId} was not found.`);
  }

  if (!data.payout_method || !data.payout_details?.trim()) {
    throw new Error(`Shop ${shopId} is missing payout_method or payout_details.`);
  }

  return {
    id: data.id,
    payout_method: data.payout_method,
    payout_details: data.payout_details.trim(),
  };
}

// ---------------------------------------------------------------------------
// Flutterwave transfer mock
// ---------------------------------------------------------------------------

async function mockFlutterwaveBulkTransfer(
  batch: MerchantBatch,
  shop: ShopPayoutRow,
): Promise<MockFlutterwaveTransferResult> {
  if (batch.merchant_amount_zmw <= 0) {
    throw new Error(
      `Refusing to create transfer for non-positive amount: ${batch.merchant_amount_zmw}.`,
    );
  }

  const reference = `kithly-batch-${batch.shop_id}-${Date.now()}`;
  const transferId = `mock-flw-transfer-${crypto.randomUUID()}`;

  console.log(
    `[${FUNCTION_NAME}] MOCK Flutterwave transfer | shop=${batch.shop_id} | method=${shop.payout_method} | amount=${batch.merchant_amount_zmw} ZMW | vouchers=${batch.vouchers.length} | transfer_id=${transferId}`,
  );

  return {
    transfer_id: transferId,
    reference,
    status: "SUCCESSFUL",
  };
}

// ---------------------------------------------------------------------------
// Settlement writes
// ---------------------------------------------------------------------------

async function markVouchersSettled(
  supabase: ReturnType<typeof getAdminClient>,
  voucherIds: string[],
): Promise<string[]> {
  const settledVoucherIds: string[] = [];

  for (const chunk of chunks(voucherIds, 100)) {
    const { data, error } = await supabase
      .from("claim_vouchers")
      .update({
        payout_status: "SETTLED" satisfies PayoutStatus,
      })
      .in("voucher_id", chunk)
      .eq("payout_status", "PENDING_BATCH" satisfies PayoutStatus)
      .select("voucher_id")
      .returns<Array<{ voucher_id: string }>>();

    if (error) {
      throw new Error(
        `Failed to mark vouchers settled: ${error.code} ${error.message}`,
      );
    }

    settledVoucherIds.push(...((data ?? []).map((row) => row.voucher_id)));
  }

  return settledVoucherIds;
}

async function writePayoutBatchedEvents(
  supabase: ReturnType<typeof getAdminClient>,
  batch: MerchantBatch,
  shop: ShopPayoutRow,
  transfer: MockFlutterwaveTransferResult,
  settledVoucherIds: string[],
  settledAt: string,
): Promise<void> {
  const settlementByVoucherId = new Map(
    batch.settlements.map((settlement) =>
      [settlement.voucher_id, settlement] as const
    ),
  );
  const voucherByVoucherId = new Map(
    batch.vouchers.map((voucher) => [voucher.voucher_id, voucher] as const),
  );

  const events = settledVoucherIds.map((voucherId) => {
    const settlement = settlementByVoucherId.get(voucherId);
    const voucher = voucherByVoucherId.get(voucherId);
    if (!settlement || !voucher) {
      throw new Error(`Missing settlement calculation for voucher ${voucherId}.`);
    }

    return {
      voucher_id: voucherId,
      event_type: LEDGER_EVENT_TYPE,
      payload: JSON.stringify({
        action: "bulk_merchant_payout",
        provider: "flutterwave",
        provider_mode: "mock",
        transfer_id: transfer.transfer_id,
        transfer_reference: transfer.reference,
        transfer_status: transfer.status,
        shop_id: batch.shop_id,
        origin_type: voucher.origin_type,
        payout_method: shop.payout_method,
        gross_amount_zmw: settlement.gross_amount_zmw,
        merchant_amount_zmw: settlement.merchant_amount_zmw,
        platform_yield_amount_zmw: settlement.platform_yield_amount_zmw,
        platform_yield_bps: settlement.platform_yield_bps,
        batch_gross_amount_zmw: batch.gross_amount_zmw,
        batch_merchant_amount_zmw: batch.merchant_amount_zmw,
        batch_platform_yield_amount_zmw: batch.platform_yield_amount_zmw,
        batch_voucher_count: batch.vouchers.length,
        settled_at: settledAt,
      }),
      created_at: settledAt,
    };
  });

  for (const chunk of chunks(events, 100)) {
    const { error } = await supabase
      .from("transaction_events")
      .insert(chunk)
      .select("id")
      .returns<LedgerInsertResult[]>();

    if (error) {
      throw new Error(
        `Failed to write ${LEDGER_EVENT_TYPE} ledger events: ${error.code} ${error.message}`,
      );
    }
  }
}

async function settleMerchantBatch(
  supabase: ReturnType<typeof getAdminClient>,
  batch: MerchantBatch,
): Promise<MerchantBatchResult> {
  const shop = await fetchShopPayoutDetails(supabase, batch.shop_id);
  const transfer = await mockFlutterwaveBulkTransfer(batch, shop);
  const settledAt = new Date().toISOString();
  const voucherIds = batch.vouchers.map((voucher) => voucher.voucher_id);

  const settledVoucherIds = await markVouchersSettled(
    supabase,
    voucherIds,
  );

  if (settledVoucherIds.length === 0) {
    return {
      shop_id: batch.shop_id,
      voucher_count: batch.vouchers.length,
      gross_amount_zmw: batch.gross_amount_zmw,
      merchant_amount_zmw: batch.merchant_amount_zmw,
      platform_yield_amount_zmw: batch.platform_yield_amount_zmw,
      transfer_id: transfer.transfer_id,
      status: "SKIPPED",
      message:
        "Transfer mock succeeded, but no vouchers were still PENDING_BATCH when settlement ran.",
      settled_voucher_ids: [],
    };
  }

  await writePayoutBatchedEvents(
    supabase,
    batch,
    shop,
    transfer,
    settledVoucherIds,
    settledAt,
  );

  if (settledVoucherIds.length !== voucherIds.length) {
    console.warn(
      `[${FUNCTION_NAME}] Partial settlement | shop=${batch.shop_id} | expected=${voucherIds.length} | settled=${settledVoucherIds.length}`,
    );
  }

  return {
    shop_id: batch.shop_id,
    voucher_count: batch.vouchers.length,
    gross_amount_zmw: batch.gross_amount_zmw,
    merchant_amount_zmw: batch.merchant_amount_zmw,
    platform_yield_amount_zmw: batch.platform_yield_amount_zmw,
    transfer_id: transfer.transfer_id,
    status: "SETTLED",
    settled_voucher_ids: settledVoucherIds,
    message: settledVoucherIds.length === voucherIds.length
      ? "Merchant batch settled."
      : "Merchant batch partially settled because some vouchers were no longer pending.",
  };
}

// ---------------------------------------------------------------------------
// Core handler
// ---------------------------------------------------------------------------

async function handleBatchPayoutSweep(req: Request): Promise<Response> {
  const authError = verifyOptionalSweeperSecret(req);
  if (authError) return authError;

  let supabase: ReturnType<typeof getAdminClient>;
  let platformYieldBps: number;

  try {
    supabase = getAdminClient();
    platformYieldBps = parseConfiguredBps();
  } catch (configError: unknown) {
    const message = configError instanceof Error
      ? configError.message
      : "Configuration error.";
    console.error(message);
    return json({ error: "Server configuration error." }, 500);
  }

  const sweepStartedAt = new Date().toISOString();
  console.log(
    `[${FUNCTION_NAME}] Sweep started | now=${sweepStartedAt} | platform_yield_bps=${platformYieldBps}`,
  );

  let dueVouchers: ClaimVoucherRow[];
  try {
    dueVouchers = await fetchDueVouchers(supabase, sweepStartedAt);
  } catch (fetchError: unknown) {
    const message = fetchError instanceof Error
      ? fetchError.message
      : "Failed to fetch due vouchers.";
    console.error(`[${FUNCTION_NAME}] ${message}`);
    return json({ error: "Failed to fetch due vouchers." }, 500);
  }

  if (dueVouchers.length === 0) {
    console.log(`[${FUNCTION_NAME}] No due PENDING_BATCH vouchers found.`);
    return json({
      success: true,
      sweep_started_at: sweepStartedAt,
      due_voucher_count: 0,
      merchant_batch_count: 0,
      settled_merchant_count: 0,
      failed_merchant_count: 0,
      results: [],
    });
  }

  let merchantBatches: Map<string, MerchantBatch>;
  try {
    merchantBatches = groupByMerchant(dueVouchers, platformYieldBps);
  } catch (groupError: unknown) {
    const message = groupError instanceof Error
      ? groupError.message
      : "Failed to group merchant batches.";
    console.error(`[${FUNCTION_NAME}] ${message}`);
    return json({ error: message }, 500);
  }

  const results: MerchantBatchResult[] = [];

  for (const batch of merchantBatches.values()) {
    try {
      console.log(
        `[${FUNCTION_NAME}] Processing merchant batch | shop=${batch.shop_id} | vouchers=${batch.vouchers.length} | amount=${batch.merchant_amount_zmw} ZMW`,
      );

      const result = await settleMerchantBatch(supabase, batch);
      results.push(result);
    } catch (merchantError: unknown) {
      const message = merchantError instanceof Error
        ? merchantError.message
        : "Unknown merchant batch failure.";

      console.error(
        `[${FUNCTION_NAME}] Merchant batch failed | shop=${batch.shop_id}: ${message}`,
      );

      results.push({
        shop_id: batch.shop_id,
        voucher_count: batch.vouchers.length,
        gross_amount_zmw: batch.gross_amount_zmw,
        merchant_amount_zmw: batch.merchant_amount_zmw,
        platform_yield_amount_zmw: batch.platform_yield_amount_zmw,
        status: "FAILED",
        message,
      });
    }
  }

  const settledMerchantCount = results.filter((result) =>
    result.status === "SETTLED"
  ).length;
  const failedMerchantCount = results.filter((result) =>
    result.status === "FAILED"
  ).length;

  console.log(
    `[${FUNCTION_NAME}] Sweep complete | due_vouchers=${dueVouchers.length} | merchants=${merchantBatches.size} | settled=${settledMerchantCount} | failed=${failedMerchantCount}`,
  );

  return json({
    success: failedMerchantCount === 0,
    sweep_started_at: sweepStartedAt,
    due_voucher_count: dueVouchers.length,
    merchant_batch_count: merchantBatches.size,
    settled_merchant_count: settledMerchantCount,
    failed_merchant_count: failedMerchantCount,
    results,
  }, failedMerchantCount === 0 ? 200 : 207);
}

// ---------------------------------------------------------------------------
// Deno.serve entry-point
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method === "GET") {
    return json({ status: "ok", function: FUNCTION_NAME });
  }

  if (req.method !== "POST") {
    return json({ error: `Method '${req.method}' is not allowed. Use POST.` }, 405);
  }

  try {
    return await handleBatchPayoutSweep(req);
  } catch (unhandled: unknown) {
    const message = unhandled instanceof Error
      ? unhandled.message
      : "An unknown error occurred.";
    console.error(`[${FUNCTION_NAME}] UNHANDLED EXCEPTION:`, message);
    return json({ error: "Internal server error." }, 500);
  }
});
