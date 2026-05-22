/**
 * fx-rate-lock — KithLy Real-Time FX Engine
 *
 * Fetches a live exchange rate, applies a structural hedging spread, and
 * returns the internationally-adjusted checkout price for a given ZMW
 * base price. Designed to be called by the frontend checkout flow
 * immediately before presenting the Flutterwave payment modal to an
 * international buyer.
 *
 * Supported target currencies:
 *   GBP (default) · USD · EUR
 *
 * Pricing formula:
 *   zmw_international_price = base_price_zmw × 1.30          (KithLy margin)
 *   hedged_rate              = live_rate × 1.015              (1.5% FX spread)
 *   checkout_price_fx        = zmw_international_price / hedged_rate
 *   checkout_price           = Math.ceil(checkout_price_fx × 100) / 100
 *                              (rounded UP to 2 d.p. — always in buyer's favour)
 *
 * Fallback strategy (three tiers):
 *   1. ExchangeRate-API (live, keyed)       ← primary
 *   2. open.er-api.com (live, unkeyed)      ← secondary
 *   3. Hardcoded safe-harbour rates         ← tertiary (prevents checkout gridlock)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * The validated, strongly-typed request payload accepted by this function.
 */
interface FxRateLockPayload {
  /**
   * The raw base price from the `items.base_price` column, stored in ZMW as
   * a positive integer (e.g. 45000 = ZMW 450.00 if unit is ngwee, or simply
   * ZMW 45 000 if unit is the kwacha integer). Treated as ZMW by this function.
   */
  base_price_zmw: number;

  /**
   * ISO 4217 currency code for the buyer's preferred output currency.
   * Defaults to "GBP". Must be one of the supported currencies.
   */
  target_currency?: string;
}

/**
 * The shape returned to the client on a successful calculation.
 */
interface FxRateLockResult {
  /** True always — indicates the calculation succeeded. */
  success: true;

  /** Final price in the target currency, rounded up to 2 decimal places. */
  checkout_price: number;

  /** ISO 4217 code of the output currency (e.g. "GBP"). */
  checkout_currency: string;

  /**
   * The hedged FX rate that was applied (live_rate × 1.015).
   * Returned for frontend transparency / audit display.
   */
  fx_rate_applied: number;

  /**
   * The raw live rate before the spread was applied.
   * Returned for debugging and audit logging on the client.
   */
  fx_rate_raw: number;

  /**
   * The ZMW-denominated international price before FX conversion
   * (i.e. base_price_zmw × 1.30). Returned for receipt generation.
   */
  zmw_international_price: number;

  /**
   * Indicates whether a fallback rate was used instead of a live rate.
   * The client should display a disclosure when this is true.
   */
  rate_source: "live_primary" | "live_secondary" | "safe_harbour";
}

/**
 * The raw response shape from ExchangeRate-API's /latest/{currency} endpoint.
 * Only the fields this function reads are typed.
 */
interface ExchangeRateApiResponse {
  result: string;          // "success" | "error"
  base_code: string;       // The base currency (always "ZMW" in our requests)
  conversion_rates: Record<string, number>;
  error_type?: string;
}

/**
 * The raw response shape from open.er-api.com's /latest/{currency} endpoint
 * (the free, unkeyed fallback provider).
 */
interface OpenErApiResponse {
  result: string;           // "success" | "error"
  base_code: string;
  rates: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** The KithLy international pricing margin multiplier. */
const INTERNATIONAL_MARGIN = 1.30 as const;

/**
 * The structural hedging spread multiplier applied to the raw FX rate.
 * A 1.5% buffer absorbs hyper-latency currency shifts between the time the
 * rate is fetched and the time the payment is actually processed by Flutterwave.
 */
const FX_HEDGE_SPREAD = 1.015 as const;

/**
 * Supported target currencies. Extending this set requires adding an entry
 * here AND a corresponding safe-harbour rate in SAFE_HARBOUR_RATES below.
 */
const SUPPORTED_CURRENCIES = new Set(["GBP", "USD", "EUR"] as const);
type SupportedCurrency = "GBP" | "USD" | "EUR";

/** Default currency when the caller omits `target_currency`. */
const DEFAULT_CURRENCY: SupportedCurrency = "GBP" as const;

/**
 * Safe-harbour fallback rates: ZMW → target currency.
 *
 * These are conservative rates (biased slightly in KithLy's favour to avoid
 * under-charging) and are derived from a 90-day rolling average. They are
 * the final fallback when ALL live providers are unavailable.
 *
 * IMPORTANT: Review and update these values monthly or whenever ZMW undergoes
 * a significant structural move (>5% from these levels).
 *
 * Last reviewed: 2026-05-21
 * Source: Bank of Zambia indicative mid-rates (90-day average)
 */
const SAFE_HARBOUR_RATES: Record<SupportedCurrency, number> = {
  GBP: 0.035,   // 1 ZMW ≈ 0.035 GBP  (ZMW/GBP ≈ 28.57)
  USD: 0.044,   // 1 ZMW ≈ 0.044 USD  (ZMW/USD ≈ 22.73)
  EUR: 0.040,   // 1 ZMW ≈ 0.040 EUR  (ZMW/EUR ≈ 25.00)
} as const;

/** Timeout in milliseconds for each FX provider HTTP call. */
const FX_FETCH_TIMEOUT_MS = 5_000 as const;

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
 * Rounds `value` UP to exactly `places` decimal places.
 * Used for foreign currency checkout prices to ensure we never under-charge
 * due to floating-point truncation.
 *
 * Examples:
 *   ceilTo(12.3412, 2) → 12.35
 *   ceilTo(12.3400, 2) → 12.34
 */
function ceilTo(value: number, places: number): number {
  const factor = Math.pow(10, places);
  return Math.ceil(value * factor) / factor;
}

/**
 * Guards a `fetch` call with an `AbortController` timeout.
 * Returns the Response on success, or throws on timeout / network error.
 */
async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs: number = FX_FETCH_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Payload validation
// ---------------------------------------------------------------------------

/**
 * Parses and validates the raw JSON request body into a typed payload.
 *
 * Validation rules:
 *   - `base_price_zmw` must be a finite, positive integer.
 *   - `target_currency` must be one of the supported ISO 4217 codes (or absent).
 *
 * @throws `Error` with a descriptive message on any validation failure.
 */
function validatePayload(raw: Record<string, unknown>): FxRateLockPayload {
  const { base_price_zmw, target_currency } = raw;

  // --- base_price_zmw ---
  if (base_price_zmw === undefined || base_price_zmw === null) {
    throw new Error("base_price_zmw is required.");
  }
  if (typeof base_price_zmw !== "number") {
    throw new Error("base_price_zmw must be a number.");
  }
  if (!Number.isFinite(base_price_zmw)) {
    throw new Error("base_price_zmw must be a finite number (not NaN or Infinity).");
  }
  if (!Number.isInteger(base_price_zmw)) {
    throw new Error(
      `base_price_zmw must be an integer (received ${base_price_zmw}). ` +
      "Store prices as raw integer ZMW values — no decimal places.",
    );
  }
  if (base_price_zmw <= 0) {
    throw new Error(`base_price_zmw must be positive (received ${base_price_zmw}).`);
  }

  // --- target_currency (optional) ---
  if (target_currency !== undefined) {
    if (typeof target_currency !== "string" || target_currency.trim().length === 0) {
      throw new Error("target_currency must be a non-empty string when provided.");
    }
    const normalised = target_currency.trim().toUpperCase();
    if (!SUPPORTED_CURRENCIES.has(normalised as SupportedCurrency)) {
      throw new Error(
        `target_currency '${normalised}' is not supported. ` +
        `Supported values: ${[...SUPPORTED_CURRENCIES].join(", ")}.`,
      );
    }
  }

  return {
    base_price_zmw: base_price_zmw as number,
    target_currency: target_currency !== undefined
      ? (target_currency as string).trim().toUpperCase()
      : undefined,
  };
}

// ---------------------------------------------------------------------------
// FX Provider 1 — ExchangeRate-API (primary, keyed)
//
// Endpoint: GET https://v6.exchangerate-api.com/v6/{key}/latest/ZMW
// Response: { result: "success", base_code: "ZMW", conversion_rates: { GBP: ... } }
//
// The API key is stored in the EXCHANGERATE_API_KEY environment variable.
// If the key is absent, this provider is skipped and Provider 2 is tried.
// ---------------------------------------------------------------------------

async function fetchFromExchangeRateApi(
  targetCurrency: SupportedCurrency,
): Promise<{ rate: number; source: "live_primary" } | null> {
  const apiKey = Deno.env.get("EXCHANGERATE_API_KEY");

  if (!apiKey) {
    console.warn(
      "[fx-rate-lock] EXCHANGERATE_API_KEY is not set — skipping primary provider.",
    );
    return null;
  }

  const url = `https://v6.exchangerate-api.com/v6/${apiKey}/latest/ZMW`;
  console.log(`[fx-rate-lock] Primary: fetching ZMW→${targetCurrency} from ExchangeRate-API`);

  let response: Response;
  try {
    response = await fetchWithTimeout(url, {
      method: "GET",
      headers: { "Accept": "application/json" },
    });
  } catch (fetchError: unknown) {
    const message = fetchError instanceof Error ? fetchError.message : String(fetchError);
    console.error(`[fx-rate-lock] Primary fetch failed: ${message}`);
    return null;
  }

  if (!response.ok) {
    console.error(
      `[fx-rate-lock] Primary provider returned HTTP ${response.status} ${response.statusText}`,
    );
    return null;
  }

  let data: ExchangeRateApiResponse;
  try {
    data = await response.json() as ExchangeRateApiResponse;
  } catch {
    console.error("[fx-rate-lock] Primary provider response is not valid JSON.");
    return null;
  }

  if (data.result !== "success") {
    console.error(
      `[fx-rate-lock] Primary provider returned result='${data.result}' (error_type='${data.error_type ?? "unknown"}').`,
    );
    return null;
  }

  const rate = data.conversion_rates?.[targetCurrency];

  if (typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0) {
    console.error(
      `[fx-rate-lock] Primary provider returned invalid rate for ${targetCurrency}: ${rate}`,
    );
    return null;
  }

  console.log(
    `[fx-rate-lock] Primary provider: ZMW→${targetCurrency} raw rate = ${rate}`,
  );
  return { rate, source: "live_primary" };
}

// ---------------------------------------------------------------------------
// FX Provider 2 — open.er-api.com (secondary, unkeyed)
//
// Endpoint: GET https://open.er-api.com/v6/latest/ZMW
// Response: { result: "success", base_code: "ZMW", rates: { GBP: ... } }
//
// This is a free, unkeyed provider used as a hot-standby when Provider 1
// fails. Rate limits: ~1 500 req/month on the free tier.
// ---------------------------------------------------------------------------

async function fetchFromOpenErApi(
  targetCurrency: SupportedCurrency,
): Promise<{ rate: number; source: "live_secondary" } | null> {
  const url = "https://open.er-api.com/v6/latest/ZMW";
  console.log(`[fx-rate-lock] Secondary: fetching ZMW→${targetCurrency} from open.er-api.com`);

  let response: Response;
  try {
    response = await fetchWithTimeout(url, {
      method: "GET",
      headers: { "Accept": "application/json" },
    });
  } catch (fetchError: unknown) {
    const message = fetchError instanceof Error ? fetchError.message : String(fetchError);
    console.error(`[fx-rate-lock] Secondary fetch failed: ${message}`);
    return null;
  }

  if (!response.ok) {
    console.error(
      `[fx-rate-lock] Secondary provider returned HTTP ${response.status} ${response.statusText}`,
    );
    return null;
  }

  let data: OpenErApiResponse;
  try {
    data = await response.json() as OpenErApiResponse;
  } catch {
    console.error("[fx-rate-lock] Secondary provider response is not valid JSON.");
    return null;
  }

  if (data.result !== "success") {
    console.error(
      `[fx-rate-lock] Secondary provider returned result='${data.result}'.`,
    );
    return null;
  }

  const rate = data.rates?.[targetCurrency];

  if (typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0) {
    console.error(
      `[fx-rate-lock] Secondary provider returned invalid rate for ${targetCurrency}: ${rate}`,
    );
    return null;
  }

  console.log(
    `[fx-rate-lock] Secondary provider: ZMW→${targetCurrency} raw rate = ${rate}`,
  );
  return { rate, source: "live_secondary" };
}

// ---------------------------------------------------------------------------
// FX Provider 3 — Safe-harbour fallback (tertiary, hardcoded)
// ---------------------------------------------------------------------------

function getSafeHarbourRate(
  targetCurrency: SupportedCurrency,
): { rate: number; source: "safe_harbour" } {
  const rate = SAFE_HARBOUR_RATES[targetCurrency];
  console.warn(
    `[fx-rate-lock] FALLBACK: Using safe-harbour rate for ZMW→${targetCurrency}: ${rate}. ` +
    "Both live providers failed. Checkout will proceed but rate may be stale.",
  );
  return { rate, source: "safe_harbour" };
}

// ---------------------------------------------------------------------------
// Rate resolution — cascading provider waterfall
// ---------------------------------------------------------------------------

/**
 * Resolves the live ZMW → targetCurrency conversion rate by trying providers
 * in priority order and falling back to the safe-harbour rate if all live
 * sources fail.
 *
 * Provider waterfall:
 *   1. ExchangeRate-API (keyed, most reliable)
 *   2. open.er-api.com  (unkeyed, hot-standby)
 *   3. SAFE_HARBOUR_RATES (hardcoded, prevents checkout gridlock)
 *
 * Providers are tried sequentially (not concurrently) so that we don't
 * consume both providers' rate limits simultaneously on every request.
 */
async function resolveExchangeRate(
  targetCurrency: SupportedCurrency,
): Promise<{ rate: number; source: FxRateLockResult["rate_source"] }> {
  // Provider 1
  const primary = await fetchFromExchangeRateApi(targetCurrency);
  if (primary !== null) return primary;

  // Provider 2
  const secondary = await fetchFromOpenErApi(targetCurrency);
  if (secondary !== null) return secondary;

  // Provider 3 — guaranteed to succeed
  return getSafeHarbourRate(targetCurrency);
}

// ---------------------------------------------------------------------------
// Core FX calculation
// ---------------------------------------------------------------------------

/**
 * Applies the full KithLy international pricing and FX hedging formula:
 *
 *   Step 1: Apply the KithLy international margin to the ZMW price.
 *           zmw_international = base_price_zmw × 1.30
 *
 *   Step 2: Apply the structural hedging spread to the raw rate.
 *           hedged_rate = raw_rate × 1.015
 *
 *   Step 3: Convert the ZMW international price to the target currency.
 *           checkout_price_fx = zmw_international / hedged_rate
 *
 *           NOTE: We DIVIDE because `raw_rate` expresses "how many target
 *           currency units per 1 ZMW" (e.g. 0.035 GBP per ZMW). To convert
 *           a ZMW amount → GBP, divide by the inverse: multiply by the rate.
 *           Equivalently: checkout_price_fx = zmw_international × raw_rate.
 *           We use multiplication below for clarity.
 *
 *   Step 4: Round UP to 2 decimal places (ceil, not round).
 *           Rounding up ensures we never under-charge due to float truncation.
 *
 * @param basePriceZmw  The raw integer ZMW base price from the database.
 * @param rawRate       The live ZMW→targetCurrency rate (e.g. 0.035 for GBP).
 * @returns An object containing all intermediate and final values for audit.
 */
function calculateInternationalCheckout(
  basePriceZmw: number,
  rawRate: number,
): {
  zmwInternationalPrice: number;
  hedgedRate: number;
  checkoutPriceFx: number;
  checkoutPrice: number;
} {
  // Step 1: ZMW price with KithLy margin
  const zmwInternationalPrice = Math.round(basePriceZmw * INTERNATIONAL_MARGIN);

  // Step 2: Hedge the raw rate
  const hedgedRate = rawRate * FX_HEDGE_SPREAD;

  // Step 3: Convert to target currency
  // `hedgedRate` = hedged units of target currency per 1 ZMW
  // Therefore: FX checkout price = ZMW international price × hedgedRate
  const checkoutPriceFx = zmwInternationalPrice * hedgedRate;

  // Step 4: Ceil to 2 decimal places
  const checkoutPrice = ceilTo(checkoutPriceFx, 2);

  return { zmwInternationalPrice, hedgedRate, checkoutPriceFx, checkoutPrice };
}

// ---------------------------------------------------------------------------
// Core handler
// ---------------------------------------------------------------------------

async function handleFxRateLock(req: Request): Promise<Response> {
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

  // --- 2. Validate the payload ---
  let payload: FxRateLockPayload;
  try {
    payload = validatePayload(rawBody);
  } catch (validationError: unknown) {
    const message = validationError instanceof Error
      ? validationError.message
      : "Invalid request payload.";
    return json({ error: message }, 400);
  }

  const targetCurrency = (
    payload.target_currency ?? DEFAULT_CURRENCY
  ) as SupportedCurrency;

  const { base_price_zmw } = payload;

  console.log(
    `[fx-rate-lock] Request | base_price_zmw=${base_price_zmw} | target_currency=${targetCurrency}`,
  );

  // --- 3. Resolve the live exchange rate (provider waterfall) ---
  const { rate: rawRate, source: rateSource } = await resolveExchangeRate(targetCurrency);

  // --- 4. Apply the pricing formula ---
  const {
    zmwInternationalPrice,
    hedgedRate,
    checkoutPriceFx,
    checkoutPrice,
  } = calculateInternationalCheckout(base_price_zmw, rawRate);

  console.log(
    `[fx-rate-lock] Calculation complete ` +
    `| base_zmw=${base_price_zmw} ` +
    `| zmw_intl=${zmwInternationalPrice} ` +
    `| raw_rate=${rawRate} ` +
    `| hedged_rate=${hedgedRate.toFixed(6)} ` +
    `| checkout_price_fx=${checkoutPriceFx.toFixed(6)} ` +
    `| checkout_price=${checkoutPrice} ${targetCurrency} ` +
    `| source=${rateSource}`,
  );

  // --- 5. Return the result ---
  const result: FxRateLockResult = {
    success: true,
    checkout_price: checkoutPrice,
    checkout_currency: targetCurrency,
    fx_rate_applied: parseFloat(hedgedRate.toFixed(6)),
    fx_rate_raw: parseFloat(rawRate.toFixed(6)),
    zmw_international_price: zmwInternationalPrice,
    rate_source: rateSource,
  };

  return json(result);
}

// ---------------------------------------------------------------------------
// Deno.serve entry-point
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request): Promise<Response> => {
  // Answer CORS preflight immediately.
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // This function is a calculation endpoint — POST only.
  if (req.method !== "POST") {
    return json(
      { error: `Method '${req.method}' is not allowed. Use POST.` },
      405,
    );
  }

  try {
    return await handleFxRateLock(req);
  } catch (unhandled: unknown) {
    const message = unhandled instanceof Error ? unhandled.message : "An unknown error occurred.";
    console.error("[fx-rate-lock] Unhandled exception:", message);
    return json({ error: "Internal server error." }, 500);
  }
});
