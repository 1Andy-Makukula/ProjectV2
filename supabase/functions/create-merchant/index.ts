/**
 * create-merchant
 *
 * Admin-only. Creates a merchant auth user, promotes their `users.role` to
 * `merchant`, and assigns them to a shop via `merchant_shops`.
 *
 * The three writes are not transactional across auth + Postgres, so a failure
 * after user creation rolls back by deleting the auth user.
 *
 * Replaces the `create_merchant` action of the retired monolithic `server`
 * function.
 */

import { getCorsHeaders, jsonWithCors } from "../_shared/cors.ts";
import { createAdminClient, requireAdmin, type AdminClient } from "../_shared/auth.ts";

const FN = "create-merchant";

const MIN_PASSWORD_LENGTH = 8;

interface CreateMerchantPayload {
  name?: string;
  email?: string;
  password?: string;
  shopId?: string;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: getCorsHeaders(req) });
  }

  if (req.method !== "POST") {
    return jsonWithCors(req, { error: `Method '${req.method}' not allowed. Use POST.` }, 405);
  }

  try {
    let body: CreateMerchantPayload;
    try {
      body = await req.json();
    } catch {
      return jsonWithCors(req, { error: "Request body must be valid JSON." }, 400);
    }

    const name = body.name?.trim();
    const email = body.email?.trim();
    const { password, shopId } = body;

    if (!name || !email || !password || !shopId) {
      return jsonWithCors(
        req,
        { error: "Missing required fields: name, email, password, shopId." },
        400,
      );
    }

    if (password.length < MIN_PASSWORD_LENGTH) {
      return jsonWithCors(
        req,
        { error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` },
        400,
      );
    }

    let adminClient: AdminClient;
    try {
      adminClient = createAdminClient(FN);
    } catch (configError: unknown) {
      console.error(configError instanceof Error ? configError.message : configError);
      return jsonWithCors(req, { error: "Server configuration error." }, 500);
    }

    const admin = await requireAdmin(req, adminClient, FN);
    if (admin instanceof Response) return admin;

    const { data: authData, error: createUserError } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name },
    });

    if (createUserError || !authData.user) {
      console.error(`[${FN}] Auth user creation failed:`, createUserError?.message);
      return jsonWithCors(
        req,
        { error: createUserError?.message ?? "Failed to create merchant account." },
        400,
      );
    }

    const merchantUserId = authData.user.id;

    const { error: roleUpdateError } = await adminClient
      .from("users")
      .update({ name, email, role: "merchant" })
      .eq("id", merchantUserId);

    if (roleUpdateError) {
      console.error(`[${FN}] Role assignment failed, rolling back:`, roleUpdateError.message);
      await adminClient.auth.admin.deleteUser(merchantUserId);
      return jsonWithCors(req, { error: "Failed to assign merchant role." }, 500);
    }

    const { error: assignmentError } = await adminClient
      .from("merchant_shops")
      .insert({ user_id: merchantUserId, shop_id: shopId });

    if (assignmentError) {
      console.error(`[${FN}] Shop assignment failed, rolling back:`, assignmentError.message);
      await adminClient.auth.admin.deleteUser(merchantUserId);
      return jsonWithCors(req, { error: "Failed to assign merchant to shop." }, 500);
    }

    // merchant_shops (just written above) is the source of truth money
    // resolves against (see resolve_shop_merchant_user_id). This backfill is
    // not fatal if it fails -- it only keeps shops.owner_id, an identity/
    // display column, in sync with who actually holds the shop.
    const { error: ownerBackfillError } = await adminClient
      .from("shops")
      .update({ owner_id: merchantUserId })
      .eq("id", shopId);

    if (ownerBackfillError) {
      console.error(`[${FN}] owner_id backfill failed for shop ${shopId}:`, ownerBackfillError.message);
    }

    const { error: auditError } = await adminClient.rpc("log_admin_action", {
      p_action: "merchant.create",
      p_target_type: "user",
      p_target_id: merchantUserId,
      p_payload: { shop_id: shopId, email },
      p_actor_id: admin.id,
    });
    if (auditError) {
      console.error(`[${FN}] Audit log write failed (non-fatal):`, auditError.message);
    }

    console.log(`[${FN}] Admin ${admin.id} created merchant ${merchantUserId} for shop ${shopId}.`);

    return jsonWithCors(req, {
      success: true,
      merchant: { id: merchantUserId, email, name, shopId },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error";
    console.error(`[${FN}] Unhandled error:`, message);
    return jsonWithCors(req, { error: message }, 500);
  }
});
