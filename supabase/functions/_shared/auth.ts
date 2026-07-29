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
