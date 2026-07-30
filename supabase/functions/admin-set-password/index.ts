/**
 * admin-set-password
 *
 * Admin-only. Directly sets another user's password — used when an operator is
 * onboarding a merchant in person and email delivery is not practical.
 *
 * This is a privileged account-takeover primitive, so it is restricted to
 * callers with the `admin` role, refuses to target other admins, and logs every
 * use with both the acting and target user ids.
 *
 * Replaces the never-routed `/admin-reset-password` path the admin screens used
 * to call on the retired monolithic `server` function.
 */

import { getCorsHeaders, jsonWithCors } from "../_shared/cors.ts";
import { createAdminClient, requireAdmin, type AdminClient } from "../_shared/auth.ts";

const FN = "admin-set-password";

const MIN_PASSWORD_LENGTH = 8;

interface AdminSetPasswordPayload {
  userId?: string;
  newPassword?: string;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: getCorsHeaders(req) });
  }

  if (req.method !== "POST") {
    return jsonWithCors(req, { error: `Method '${req.method}' not allowed. Use POST.` }, 405);
  }

  try {
    let body: AdminSetPasswordPayload;
    try {
      body = await req.json();
    } catch {
      return jsonWithCors(req, { error: "Request body must be valid JSON." }, 400);
    }

    const { userId, newPassword } = body;

    if (!userId || !newPassword) {
      return jsonWithCors(req, { error: "userId and newPassword are required." }, 400);
    }

    if (newPassword.length < MIN_PASSWORD_LENGTH) {
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

    const { data: target, error: targetError } = await adminClient
      .from("users")
      .select("id, role")
      .eq("id", userId)
      .single();

    if (targetError || !target) {
      return jsonWithCors(req, { error: "User not found." }, 404);
    }

    // Resetting a peer admin's password is an escalation path between operators;
    // those accounts must go through the email reset flow instead.
    if (target.role === "admin") {
      return jsonWithCors(
        req,
        { error: "Admin passwords cannot be set this way. Use the email reset flow." },
        403,
      );
    }

    const { error: updateError } = await adminClient.auth.admin.updateUserById(userId, {
      password: newPassword,
    });

    if (updateError) {
      console.error(`[${FN}] Password update failed:`, updateError.message);
      return jsonWithCors(req, { error: updateError.message ?? "Failed to update password." }, 400);
    }

    const { error: auditError } = await adminClient.rpc("log_admin_action", {
      p_action: "merchant.password_set",
      p_target_type: "user",
      p_target_id: userId,
      p_actor_id: admin.id,
    });
    if (auditError) {
      console.error(`[${FN}] Audit log write failed (non-fatal):`, auditError.message);
    }

    console.log(`[${FN}] Admin ${admin.id} set the password for user ${userId}.`);

    return jsonWithCors(req, { success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error";
    console.error(`[${FN}] Unhandled error:`, message);
    return jsonWithCors(req, { error: message }, 500);
  }
});
