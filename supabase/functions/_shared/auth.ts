/**
 * Shared authentication/authorisation helpers for Edge Functions.
 *
 * These mirror the guards that previously lived inside the monolithic `server`
 * function so that each single-purpose function enforces the same rules
 * without duplicating the logic.
 *
 * Every helper returns either the resolved caller or a ready-to-send `Response`
 * — callers should use `instanceof Response` to short-circuit.
 */

import { createClient } from "jsr:@supabase/supabase-js@2.49.8";
import { jsonWithCors } from "./cors.ts";

export type AdminClient = ReturnType<typeof createAdminClient>;

/**
 * Service-role Supabase client. Never expose this key to the browser.
 * Throws when the function is missing its configuration.
 */
export function createAdminClient(fnName: string) {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!url || !serviceRoleKey) {
    throw new Error(
      `[${fnName}] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not configured.`,
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

/**
 * A Supabase client that acts AS THE CALLER rather than as service_role.
 *
 * Needed wherever an edge function invokes a SECURITY DEFINER RPC that
 * authorises through `auth.uid()` / `current_user_role()` -- the pattern every
 * admin RPC in this codebase uses, because they are otherwise called straight
 * from the browser (see admin_force_fulfill_order, admin_expire_order).
 *
 * The service-role client is the wrong tool for that call: it has no session,
 * so `auth.uid()` is NULL inside the function and the guard raises
 * "Authentication required" for a legitimate admin. Escalating instead -- by
 * having the function accept a caller-supplied admin id -- would put the
 * identity back under the caller's control, which is the shape of VULN-01.
 *
 * Authorisation is therefore checked twice, in both directions: requireAdmin
 * here verifies the token before the call is made, and the function re-derives
 * the role from the session it actually runs under.
 */
export function createCallerClient(req: Request, fnName: string) {
  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const authorization = req.headers.get("Authorization") ?? "";

  if (!url || !anonKey) {
    throw new Error(`[${fnName}] SUPABASE_URL or SUPABASE_ANON_KEY is not configured.`);
  }

  return createClient(url, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

/** Validates the Bearer token and returns the authenticated auth user. */
export async function authenticateCaller(
  req: Request,
  adminClient: AdminClient,
  fnName: string,
): Promise<{ id: string; email?: string } | Response> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return jsonWithCors(
      req,
      { error: "A valid Authorization Bearer token is required." },
      401,
    );
  }

  const jwt = authHeader.slice("Bearer ".length);
  const {
    data: { user },
    error: authError,
  } = await adminClient.auth.getUser(jwt);

  if (authError || !user) {
    console.error(
      `[${fnName}] JWT validation failed:`,
      authError?.message ?? "No user returned.",
    );
    return jsonWithCors(
      req,
      { error: "Unauthorized. Your session may have expired — please log in again." },
      401,
    );
  }

  return user;
}

/**
 * Validates the Bearer token and confirms the caller has the `admin` role in
 * `public.users`. Returns 401 for both "not signed in" and "not an admin" so
 * the endpoint does not leak whether a given account exists.
 */
export async function requireAdmin(
  req: Request,
  adminClient: AdminClient,
  fnName: string,
): Promise<{ id: string; email?: string } | Response> {
  const caller = await authenticateCaller(req, adminClient, fnName);
  if (caller instanceof Response) return caller;

  const { data: profile, error: profileError } = await adminClient
    .from("users")
    .select("id, role")
    .eq("id", caller.id)
    .single();

  if (profileError || profile?.role !== "admin") {
    console.error(
      `[${fnName}] Admin check failed for user ${caller.id}:`,
      profileError?.message ?? `role="${profile?.role ?? "none"}"`,
    );
    return jsonWithCors(req, { error: "Unauthorized" }, 401);
  }

  return caller;
}

/**
 * Validates the Bearer token and confirms the caller is assigned to `shopId`
 * via `merchant_shops`.
 */
export async function requireMerchantForShop(
  req: Request,
  adminClient: AdminClient,
  shopId: string,
  fnName: string,
): Promise<{ id: string; email?: string } | Response> {
  const caller = await authenticateCaller(req, adminClient, fnName);
  if (caller instanceof Response) return caller;

  const { data: assignment, error: assignError } = await adminClient
    .from("merchant_shops")
    .select("shop_id")
    .eq("user_id", caller.id)
    .eq("shop_id", shopId)
    .maybeSingle();

  if (assignError || !assignment) {
    console.error(
      `[${fnName}] Merchant ${caller.id} is not assigned to shop ${shopId}:`,
      assignError?.message ?? "no assignment row",
    );
    return jsonWithCors(req, { error: "Forbidden" }, 403);
  }

  return caller;
}

/**
 * Resolves a transaction by Flutterwave `tx_ref`. The reference is either the
 * `transaction_id` UUID (optionally suffixed with `_<retry>`) or a legacy
 * `gateway_tx_ref` string.
 */
export async function findTransactionByTxRef(
  adminClient: AdminClient,
  txRef: string,
  columns = "transaction_id, total_amount, status, gateway_tx_ref, buyer_id",
) {
  const cleanTxRef = txRef.split("_")[0];
  const isUuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(cleanTxRef);

  if (isUuid) {
    return adminClient
      .from("transactions")
      .select(columns)
      .eq("transaction_id", cleanTxRef)
      .single();
  }

  return adminClient
    .from("transactions")
    .select(columns)
    .eq("gateway_tx_ref", txRef)
    .single();
}

/** Constant-time string comparison, so a shared secret cannot be recovered
 *  byte-by-byte from response timing. */
function secretEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function base64UrlToBytes(input: string): Uint8Array {
  const b64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Verifies an HS256 Supabase JWT against SUPABASE_JWT_SECRET and returns its
 * claims, or null if the token is not authentic.
 *
 * Rejects a token whose header names any algorithm other than HS256. Without
 * that check, `{"alg":"none"}` -- a token with an empty signature -- is the
 * classic bypass, and accepting an arbitrary `alg` reintroduces exactly the
 * trust-the-payload behaviour this function exists to remove.
 */
async function verifyHs256(token: string, secret: string): Promise<Record<string, unknown> | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const [headerB64, payloadB64, signatureB64] = parts;

  let header: Record<string, unknown>;
  try {
    header = JSON.parse(new TextDecoder().decode(base64UrlToBytes(headerB64)));
  } catch {
    return null;
  }
  if (header?.alg !== "HS256") return null;

  let key: CryptoKey;
  try {
    key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );
  } catch {
    return null;
  }

  let valid: boolean;
  try {
    valid = await crypto.subtle.verify(
      "HMAC",
      key,
      base64UrlToBytes(signatureB64),
      new TextEncoder().encode(`${headerB64}.${payloadB64}`),
    );
  } catch {
    return null;
  }
  if (!valid) return null;

  let claims: Record<string, unknown>;
  try {
    claims = JSON.parse(new TextDecoder().decode(base64UrlToBytes(payloadB64)));
  } catch {
    return null;
  }

  // An authentic but expired token is not a valid one.
  const exp = claims?.exp;
  if (typeof exp === "number" && exp * 1000 <= Date.now()) return null;

  return claims;
}

/**
 * Is this caller the scheduler (or something else holding service-role rights)?
 *
 * For functions invoked by pg_cron rather than by a person.
 *
 * WHAT CHANGED, AND WHY
 * ---------------------
 * This used to split the bearer token on dots, base64-decode the middle
 * segment, and believe whatever `role` it found there. It never verified the
 * signature. The justification -- correct as far as it went -- was that these
 * functions run with verify_jwt = true, so Supabase's gateway had already
 * checked the signature before the request arrived.
 *
 * That is an argument that the platform is currently compensating for the
 * defect, not that there is no defect. It holds only while every consumer stays
 * verify_jwt = true, and config.toml already carries three exemptions
 * (flutterwave-webhook, ussd-gateway, health). Nothing in the type system, the
 * tests, or the deploy stops a fourth from being added and then calling this:
 * the failure would be silent, and the payload is `{"role":"service_role"}`
 * base64-encoded, which anyone can produce. An auth primitive that is safe only
 * because of a setting in a different file is a trap laid for a future edit.
 *
 * It now verifies the HMAC itself, so it is correct standalone. The two opaque
 * paths below are unchanged in effect and now compare in constant time.
 *
 * @param overrideSecretEnv name of a function-specific shared secret which,
 *   when set and matched, authorises outright.
 */
export async function isServiceRoleCaller(
  req: Request,
  overrideSecretEnv?: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const header = req.headers.get("Authorization") ?? "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (!token) return { ok: false, reason: "no bearer token" };

  if (overrideSecretEnv) {
    const explicit = Deno.env.get(overrideSecretEnv);
    if (explicit && secretEquals(token, explicit)) return { ok: true };
  }

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (serviceKey && secretEquals(token, serviceKey)) return { ok: true };

  if (token.split(".").length !== 3) {
    return { ok: false, reason: "opaque token matched no configured secret" };
  }

  // Fails closed rather than falling back to the old unverified decode.
  // The two paths above cover the scheduler's normal call (pg_cron sends the
  // service-role key from Vault, matched exactly), so a missing secret does not
  // silently disable the caller it is most likely to be -- it disables only the
  // branch that cannot be checked.
  const jwtSecret = Deno.env.get("SUPABASE_JWT_SECRET");
  if (!jwtSecret) {
    console.error(
      "[auth] SUPABASE_JWT_SECRET is not configured; cannot verify a JWT bearer token. Set it with `supabase secrets set SUPABASE_JWT_SECRET=...`.",
    );
    return { ok: false, reason: "JWT verification is not configured" };
  }

  const claims = await verifyHs256(token, jwtSecret);
  if (!claims) return { ok: false, reason: "bearer token signature is invalid or expired" };

  if (claims.role === "service_role") return { ok: true };
  return { ok: false, reason: `token role is '${String(claims.role ?? "unknown")}', not service_role` };
}
