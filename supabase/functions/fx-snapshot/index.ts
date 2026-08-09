/**
 * fx-snapshot — pulls exchange rates on a schedule so checkout never has to.
 *
 * Invoked hourly by pg_cron via trigger_fx_snapshot(). Fetches the current
 * rates from OpenExchangeRates and appends one row to fx_rate_snapshots.
 * Nothing on the checkout path calls a rate provider; it reads the newest row.
 *
 * WHY THIS EXISTS SEPARATELY FROM fx-rate-lock
 * --------------------------------------------
 * fx-rate-lock fetches a rate while a buyer is waiting at the payment step,
 * and falls back to rates hardcoded in its own source when the call fails. That
 * puts a third party's latency in the checkout path and hides staleness behind
 * a constant that nobody will notice ageing. Pulling on a schedule separates
 * "get the rate" from "use the rate", which is the same split the payout and
 * redemption sweepers already use.
 *
 * WHY NOT FETCH FROM POSTGRES DIRECTLY
 * ------------------------------------
 * The app id is a Supabase Edge Function secret, readable through Deno.env but
 * not from Postgres, which has its own separate Vault. pg_net could make the
 * request but could not authenticate it without duplicating the key into Vault
 * -- two copies of one secret, which is one too many.
 *
 * QUOTA
 * -----
 * The free plan allows ~1,000 calls/month. Hourly is 720. Deliberately
 * independent of traffic: a per-checkout fetch scales with orders and would
 * exhaust the month during the first busy week, then silently degrade.
 */
import { createClient } from "jsr:@supabase/supabase-js@2.49.8";

const OER_LATEST = "https://openexchangerates.org/api/latest.json";

const corsHeaders: HeadersInit = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/** The shape of a successful OpenExchangeRates /latest.json response. */
interface OerLatestResponse {
  timestamp?: number;
  base?: string;
  rates?: Record<string, number>;
  /** Present only on errors. */
  error?: boolean;
  message?: string;
  description?: string;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/**
 * Only the scheduler should be able to spend the month's API quota.
 *
 * This function runs with verify_jwt = true (the deploy default; see
 * config.toml, which exempts only flutterwave-webhook, ussd-gateway and
 * health). So Supabase has already verified the token's signature before this
 * handler is reached -- what is left to decide is which KIND of caller it is,
 * because a valid anon key is also a valid token and anyone holding the browser
 * bundle has one.
 *
 * Three ways to be the scheduler, in order of specificity. Matching a single
 * key by string equality -- the original approach, copied from
 * batch-payout-sweeper -- is brittle in two ways that both bit during testing:
 * it breaks the moment a key is rotated, and it does not recognise Supabase's
 * newer sb_secret_ keys, which are opaque rather than JWTs.
 *
 * Decoding the payload without verifying the signature is safe HERE and only
 * here, because the platform already verified it. If verify_jwt is ever turned
 * off for this function, this check becomes worthless and must be replaced.
 */
function authoriseCaller(req: Request): { ok: true } | { ok: false; reason: string } {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return { ok: false, reason: "no bearer token" };

  // 1. An explicit shared secret, if one is configured, wins outright.
  const explicit = Deno.env.get("FX_SNAPSHOT_SECRET");
  if (explicit && token === explicit) return { ok: true };

  // 2. The service role key exactly as this function sees it.
  if (token === Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) return { ok: true };

  // 3. Any platform-verified JWT carrying the service_role claim. This is what
  //    survives key rotation, and what makes the check independent of which
  //    copy of the key the caller happens to hold.
  const parts = token.split(".");
  if (parts.length === 3) {
    try {
      const padded = parts[1].replace(/-/g, "+").replace(/_/g, "/");
      const claims = JSON.parse(atob(padded + "=".repeat((4 - (padded.length % 4)) % 4)));
      if (claims?.role === "service_role") return { ok: true };
      return { ok: false, reason: `token role is '${claims?.role ?? "unknown"}', not service_role` };
    } catch {
      return { ok: false, reason: "bearer token is not a decodable JWT" };
    }
  }

  return { ok: false, reason: "opaque token did not match any configured secret" };
}

function getAdminClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) {
    throw new Error("[fx-snapshot] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not configured.");
  }
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method === "GET") {
    return json({ status: "ok", service: "fx-snapshot" });
  }
  if (req.method !== "POST") {
    return json({ error: `Method '${req.method}' is not allowed. Use POST.` }, 405);
  }

  const authorised = authoriseCaller(req);
  if (!authorised.ok) {
    console.error(`[fx-snapshot] Rejected: ${authorised.reason}`);
    return json({ error: "Unauthorized." }, 401);
  }

  const appId = Deno.env.get("OPEN_EXCHANGE_RATES_APP_ID");
  if (!appId) {
    console.error("[fx-snapshot] OPEN_EXCHANGE_RATES_APP_ID is not configured.");
    return json({ error: "FX provider is not configured." }, 500);
  }

  let supabase: ReturnType<typeof getAdminClient>;
  try {
    supabase = getAdminClient();
  } catch (err: unknown) {
    console.error(err instanceof Error ? err.message : String(err));
    return json({ error: "Server configuration error." }, 500);
  }

  // No `base` parameter: switching it is a paid feature and the account returns
  // 403 not_allowed. Rates come back USD-based and everything this platform
  // needs is a cross-rate through USD, handled once in fx_zmw_rate().
  let payload: OerLatestResponse;
  try {
    const res = await fetch(`${OER_LATEST}?app_id=${encodeURIComponent(appId)}`);
    payload = await res.json();
    if (!res.ok || payload.error) {
      throw new Error(payload.description ?? payload.message ?? `HTTP ${res.status}`);
    }
  } catch (err: unknown) {
    // Not fatal to the platform: checkout keeps using the previous snapshot
    // until it ages past fx_max_snapshot_age_minutes, at which point quoting
    // stops rather than pricing against something stale.
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[fx-snapshot] Provider fetch failed: ${message}`);
    return json({ error: "Could not fetch rates.", detail: message }, 502);
  }

  const rates = payload.rates;
  const base = (payload.base ?? "USD").toUpperCase();

  // Validated before storing, not after reading. A snapshot missing ZMW is
  // useless here -- every rate this platform computes is relative to it -- and
  // storing it would leave a row that only fails later, inside a checkout.
  if (!rates || typeof rates !== "object") {
    return json({ error: "Provider returned no rates object." }, 502);
  }
  if (typeof rates.ZMW !== "number" || !Number.isFinite(rates.ZMW) || rates.ZMW <= 0) {
    console.error(`[fx-snapshot] Provider returned no usable ZMW rate: ${rates.ZMW}`);
    return json({ error: "Provider returned no usable ZMW rate." }, 502);
  }
  if (typeof payload.timestamp !== "number" || !Number.isFinite(payload.timestamp)) {
    return json({ error: "Provider returned no publication timestamp." }, 502);
  }

  // The provider's publication time, not our fetch time. A successful fetch of
  // an hours-old publication is still an hours-old rate, and the staleness gate
  // must judge the rate rather than the request.
  const oerTimestamp = new Date(payload.timestamp * 1000).toISOString();

  const { error: insertError } = await supabase.from("fx_rate_snapshots").insert({
    base_currency: base,
    rates,
    oer_timestamp: oerTimestamp,
    rate_source: "openexchangerates",
  });

  if (insertError) {
    console.error(`[fx-snapshot] Could not store snapshot: ${insertError.message}`);
    return json({ error: "Could not store snapshot." }, 500);
  }

  const zmwPerUsd = rates.ZMW;
  console.log(
    `[fx-snapshot] Stored | base=${base} | published=${oerTimestamp} | ` +
      `ZMW/USD=${zmwPerUsd} | currencies=${Object.keys(rates).length}`,
  );

  return json({
    success: true,
    base_currency: base,
    oer_timestamp: oerTimestamp,
    currencies: Object.keys(rates).length,
  });
});
