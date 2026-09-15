/**
 * Airtel Money adapter — disbursements and subscriber lookup.
 *
 * WHY THE RETURN TYPE DISTINGUISHES THREE OUTCOMES, NOT TWO
 * ---------------------------------------------------------
 * The single most expensive mistake available here is treating "the request
 * threw" as "the payment failed". It is not. A timeout means the money may
 * already be moving, and a failure path that retries or reverses on a timeout
 * pays the merchant twice.
 *
 * So every call returns `ok` | `failed` | `unknown`:
 *
 *   ok       the rail confirmed success. Close the payable.
 *   failed   the rail explicitly rejected it. Safe to retry or abandon.
 *   unknown  we do not know. Do NOT retry and do NOT reverse. Park the row
 *            and reconcile it against the reference with `enquire`.
 *
 * `batch-payout-sweeper` learned this the hard way and parks unknowns as
 * `unverified`; the same rule governs here.
 *
 * WHY THE REFERENCE IS DETERMINISTIC
 * ----------------------------------
 * `payout_instructions.idempotency_key` is passed to Airtel as the transaction
 * id. If a retry does happen -- a process restart mid-flight, a duplicated
 * dispatcher run -- Airtel sees the same id and refuses the duplicate rather
 * than sending a second transfer. That is the only protection that works when
 * the outcome of the first attempt is genuinely unknown.
 *
 * CONFIGURATION
 * -------------
 *   AIRTEL_BASE_URL        https://openapiuat.airtel.africa (sandbox) or
 *                          https://openapi.airtel.africa (production)
 *   AIRTEL_CLIENT_ID
 *   AIRTEL_CLIENT_SECRET
 *   AIRTEL_COUNTRY         ZM
 *   AIRTEL_CURRENCY        ZMW
 *   AIRTEL_PIN             the disbursement PIN, RSA-encrypted by Airtel's
 *                          published key. Stored encrypted; never plaintext.
 *
 * Missing configuration throws rather than defaulting. A payout rail that
 * silently falls back to a sandbox is worse than one that refuses to start.
 */

export type RailOutcome =
  | { result: "ok"; reference: string; providerId: string; raw: unknown }
  | { result: "failed"; reason: string; code?: string; raw: unknown }
  | { result: "unknown"; reason: string; raw?: unknown };

export interface AirtelConfig {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  country: string;
  currency: string;
  pin: string;
}

export function airtelConfig(): AirtelConfig {
  const baseUrl = Deno.env.get("AIRTEL_BASE_URL");
  const clientId = Deno.env.get("AIRTEL_CLIENT_ID");
  const clientSecret = Deno.env.get("AIRTEL_CLIENT_SECRET");
  const pin = Deno.env.get("AIRTEL_PIN");

  if (!baseUrl || !clientId || !clientSecret) {
    throw new Error(
      "[airtel] AIRTEL_BASE_URL, AIRTEL_CLIENT_ID and AIRTEL_CLIENT_SECRET must all be set.",
    );
  }

  return {
    baseUrl: baseUrl.replace(/\/+$/, ""),
    clientId,
    clientSecret,
    country: Deno.env.get("AIRTEL_COUNTRY") ?? "ZM",
    currency: Deno.env.get("AIRTEL_CURRENCY") ?? "ZMW",
    pin: pin ?? "",
  };
}

/**
 * Token cache.
 *
 * Airtel's tokens last an hour and the endpoint is rate limited, so fetching
 * one per payout would both slow the batch and risk throttling mid-run. Scoped
 * to the isolate, which is the correct lifetime: a cold start gets a fresh one.
 *
 * Expiry is deliberately treated as 60 seconds shorter than stated, so a token
 * cannot expire between the check and the request that uses it.
 */
let cachedToken: { token: string; expiresAt: number } | null = null;

export async function airtelToken(cfg: AirtelConfig): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) {
    return cachedToken.token;
  }

  const res = await fetch(`${cfg.baseUrl}/auth/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "*/*" },
    body: JSON.stringify({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      grant_type: "client_credentials",
    }),
  });

  if (!res.ok) {
    throw new Error(`[airtel] token request failed: ${res.status} ${await res.text()}`);
  }

  const body = await res.json();
  const token = body?.access_token;
  if (!token) {
    throw new Error("[airtel] token response contained no access_token");
  }

  const ttl = Number(body?.expires_in ?? 3600);
  cachedToken = {
    token,
    expiresAt: Date.now() + Math.max(ttl - 60, 30) * 1000,
  };
  return token;
}

function airtelHeaders(cfg: AirtelConfig, token: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Accept: "*/*",
    "X-Country": cfg.country,
    "X-Currency": cfg.currency,
    Authorization: `Bearer ${token}`,
  };
}

/**
 * Airtel's MSISDN format is the national number without the country code.
 * Our destinations are stored E.164 (+260977123456), so the +260 comes off.
 * Anything that is not a Zambian number is a programming error by the time it
 * reaches here -- set_payout_destination already refused it.
 */
export function toAirtelMsisdn(e164: string): string {
  const digits = e164.replace(/[^\d]/g, "");
  if (digits.startsWith("260")) return digits.slice(3);
  return digits;
}

/**
 * Ngwee to the decimal string Airtel expects.
 *
 * Kept explicit rather than dividing inline: every other place in this system
 * that converts between ngwee and kwacha is a single named boundary, and this
 * is the one on the way out to a bank instruction.
 */
export function ngweeToAirtelAmount(ngwee: number): string {
  return (ngwee / 100).toFixed(2);
}

/**
 * Subscriber lookup — the name check that §6.1 verification runs on.
 *
 * Returns the registered name so a human can compare it with what the merchant
 * typed. It also reports `isBarred`, which matters more than the name: a barred
 * subscriber cannot receive a disbursement at all, so verifying one would let a
 * shop trade against an account that can never be paid.
 */
export async function airtelLookupSubscriber(
  cfg: AirtelConfig,
  e164: string,
): Promise<
  | { result: "ok"; name: string | null; isBarred: boolean; raw: unknown }
  | { result: "failed"; reason: string; raw: unknown }
  | { result: "unknown"; reason: string }
> {
  let token: string;
  try {
    token = await airtelToken(cfg);
  } catch (e) {
    return { result: "unknown", reason: `token: ${(e as Error).message}` };
  }

  const msisdn = toAirtelMsisdn(e164);

  let res: Response;
  try {
    res = await fetch(`${cfg.baseUrl}/standard/v1/users/${msisdn}`, {
      method: "GET",
      headers: airtelHeaders(cfg, token),
    });
  } catch (e) {
    // The network failed. We do not know whether this number is valid, and
    // marking it failed would block a legitimate merchant from trading.
    return { result: "unknown", reason: `network: ${(e as Error).message}` };
  }

  const raw = await res.json().catch(() => ({}));

  if (!res.ok) {
    // A 404 is a real answer: there is no such subscriber.
    if (res.status === 404) {
      return { result: "failed", reason: "No Airtel Money account on that number", raw };
    }
    if (res.status >= 500) {
      return { result: "unknown", reason: `Airtel returned ${res.status}` };
    }
    return {
      result: "failed",
      reason: raw?.status?.message ?? `Airtel returned ${res.status}`,
      raw,
    };
  }

  const data = raw?.data ?? {};
  const first = data?.first_name ?? "";
  const last = data?.last_name ?? "";
  const name = [first, last].filter(Boolean).join(" ").trim() || null;

  if (data?.is_barred === true) {
    return { result: "failed", reason: "That Airtel Money account is barred", raw };
  }

  if (raw?.status?.success === false) {
    return { result: "failed", reason: raw?.status?.message ?? "Lookup rejected", raw };
  }

  return { result: "ok", name, isBarred: false, raw };
}

/**
 * Disburse to a subscriber.
 *
 * `reference` must be the instruction's idempotency key -- see the header.
 */
export async function airtelDisburse(
  cfg: AirtelConfig,
  args: { e164: string; amountNgwee: number; reference: string },
): Promise<RailOutcome> {
  let token: string;
  try {
    token = await airtelToken(cfg);
  } catch (e) {
    return { result: "unknown", reason: `token: ${(e as Error).message}` };
  }

  const payload = {
    payee: { msisdn: toAirtelMsisdn(args.e164) },
    reference: args.reference,
    pin: cfg.pin,
    transaction: {
      amount: ngweeToAirtelAmount(args.amountNgwee),
      id: args.reference,
    },
  };

  let res: Response;
  try {
    res = await fetch(`${cfg.baseUrl}/standard/v1/disbursements/`, {
      method: "POST",
      headers: airtelHeaders(cfg, token),
      body: JSON.stringify(payload),
    });
  } catch (e) {
    // THE IMPORTANT CASE. The request did not come back. The money may be in
    // flight. Neither retry nor reverse -- park it and enquire.
    return { result: "unknown", reason: `network: ${(e as Error).message}` };
  }

  const raw = await res.json().catch(() => ({}));

  // A 5xx is not a rejection; it is an absence of an answer.
  if (res.status >= 500) {
    return { result: "unknown", reason: `Airtel returned ${res.status}`, raw };
  }

  const status = raw?.status ?? {};
  const txn = raw?.data?.transaction ?? {};

  if (res.ok && status?.success === true && txn?.status !== "TF") {
    return {
      result: "ok",
      reference: args.reference,
      providerId: txn?.airtel_money_id ?? txn?.id ?? args.reference,
      raw,
    };
  }

  // Airtel's ambiguous middle: an accepted request whose transaction is still
  // pending. Treated as unknown, because it has neither succeeded nor failed.
  if (txn?.status === "TIP" || status?.code === "DP00800001000") {
    return { result: "unknown", reason: "Transfer is still in progress at Airtel", raw };
  }

  return {
    result: "failed",
    reason: status?.message ?? status?.result_code ?? `Airtel rejected the transfer (${res.status})`,
    code: status?.code ?? status?.result_code,
    raw,
  };
}

/**
 * Ask Airtel what became of a reference.
 *
 * This is how an `unknown` is resolved, and it is the only safe way to settle
 * a parked payout: it asks the rail rather than guessing.
 */
export async function airtelEnquire(
  cfg: AirtelConfig,
  reference: string,
): Promise<RailOutcome> {
  let token: string;
  try {
    token = await airtelToken(cfg);
  } catch (e) {
    return { result: "unknown", reason: `token: ${(e as Error).message}` };
  }

  let res: Response;
  try {
    res = await fetch(`${cfg.baseUrl}/standard/v1/disbursements/${reference}`, {
      method: "GET",
      headers: airtelHeaders(cfg, token),
    });
  } catch (e) {
    return { result: "unknown", reason: `network: ${(e as Error).message}` };
  }

  const raw = await res.json().catch(() => ({}));

  if (res.status >= 500) {
    return { result: "unknown", reason: `Airtel returned ${res.status}`, raw };
  }

  const txn = raw?.data?.transaction ?? {};

  // TS = success, TF = failed, TIP = in progress. Anything else is unknown
  // rather than assumed.
  if (txn?.status === "TS") {
    return {
      result: "ok",
      reference,
      providerId: txn?.airtel_money_id ?? txn?.id ?? reference,
      raw,
    };
  }
  if (txn?.status === "TF") {
    return {
      result: "failed",
      reason: raw?.status?.message ?? "Airtel reports the transfer failed",
      raw,
    };
  }

  return { result: "unknown", reason: `Airtel reports status ${txn?.status ?? "unavailable"}`, raw };
}
