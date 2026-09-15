/**
 * verify-payout-destination
 *
 * Proves that a merchant's payout destination exists before they are allowed
 * to accept collections (§6.1).
 *
 * WHY THIS RUNS BEFORE TRADING, NOT BEFORE PAYING
 * -----------------------------------------------
 * A redemption is the moment goods leave the counter. Discovering a bad number
 * afterwards is unrecoverable: the merchant has handed over stock against a
 * promise KithLy cannot keep, and there is no mechanism to get it back. So the
 * gate is at the scan, and this is what opens it.
 *
 * The cost is real — a merchant who has not verified cannot trade — and it is
 * the correct trade. `shop_payout_readiness` gives the panel a specific reason
 * and a specific fix rather than a disabled button.
 *
 * WHAT "VERIFIED" MEANS PER RAIL
 * ------------------------------
 *   airtel_money  A live KYC lookup. Returns the registered name and, more
 *                 importantly, whether the account is barred — a barred
 *                 subscriber cannot receive a disbursement at all, so
 *                 verifying one would be worse than not verifying.
 *   bank          A micro-deposit. Not automatable here: this function stages
 *                 it and an admin confirms the amount the merchant reports.
 *
 * A NAME MISMATCH IS SURFACED, NOT ENFORCED
 * -----------------------------------------
 * "Mary Banda" against "M BANDA" is routine. "Mary Banda" against someone else
 * entirely is fraud. Code cannot reliably tell those apart, so both strings are
 * returned and shown, and a human decides. Auto-rejecting on a string compare
 * would lock out a large fraction of legitimate merchants.
 */

import {
  createAdminClient,
  requireMerchantForShop,
  isServiceRoleCaller,
} from "../_shared/auth.ts";
import { jsonWithCors } from "../_shared/cors.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { airtelConfig, airtelLookupSubscriber } from "../_shared/airtel.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: getCorsHeaders(req) });
  }
  if (req.method !== "POST") {
    return jsonWithCors(req, { error: "Method not allowed" }, 405);
  }

  let body: { shop_id?: string; destination_id?: string };
  try {
    body = await req.json();
  } catch {
    return jsonWithCors(req, { error: "Invalid JSON body" }, 400);
  }

  const shopId = body.shop_id;
  if (!shopId) {
    return jsonWithCors(req, { error: "shop_id is required" }, 400);
  }

  const admin = createAdminClient("verify-payout-destination");

  // A merchant verifies their own shop; a scheduled re-verification runs as
  // the service role.
  const serviceCaller = await isServiceRoleCaller(req, "PAYOUT_DISPATCHER_SECRET");
  if (serviceCaller instanceof Response) {
    const merchant = await requireMerchantForShop(
      req,
      admin,
      shopId,
      "verify-payout-destination",
    );
    if (merchant instanceof Response) return merchant;
  }

  const { data: dest, error: destError } = await admin
    .from("merchant_payout_destinations")
    .select("id, rail, account_identifier, account_name, verification_status, attempt_count")
    .eq("shop_id", shopId)
    .eq("is_active", true)
    .maybeSingle();

  if (destError || !dest) {
    return jsonWithCors(
      req,
      { error: "This shop has no payout destination to verify." },
      404,
    );
  }

  if (body.destination_id && body.destination_id !== dest.id) {
    // The merchant changed their details between opening the form and pressing
    // verify. Verifying the wrong row would mark a destination proven that
    // nobody checked.
    return jsonWithCors(
      req,
      { error: "Those payout details have changed. Reload and try again." },
      409,
    );
  }

  if (dest.verification_status === "verified") {
    return jsonWithCors(req, {
      destination_id: dest.id,
      verification_status: "verified",
      unchanged: true,
    });
  }

  // Rate limit, cheaply. Airtel's KYC endpoint is not free and a verify button
  // is exactly the sort of thing that gets pressed forty times.
  if ((dest.attempt_count ?? 0) >= 10) {
    return jsonWithCors(
      req,
      {
        error:
          "Too many verification attempts on these details. Please contact support so we can check them by hand.",
      },
      429,
    );
  }

  // ---------------------------------------------------------------------
  // Bank: staged for a human. There is no automatable proof available here.
  // ---------------------------------------------------------------------
  if (dest.rail === "bank") {
    await admin.rpc("mark_destination_verifying", { p_destination_id: dest.id });
    return jsonWithCors(req, {
      destination_id: dest.id,
      verification_status: "pending",
      method: "micro_deposit",
      message:
        "We will send a small deposit to that account within one working day. " +
        "Tell us the exact amount that arrives and we will switch collections on.",
    });
  }

  // ---------------------------------------------------------------------
  // Airtel Money: a live lookup.
  // ---------------------------------------------------------------------
  let cfg;
  try {
    cfg = airtelConfig();
  } catch (e) {
    console.error("[verify-payout-destination] Airtel not configured:", e);
    // Deliberately NOT marked failed. The merchant's number may be perfect;
    // our configuration is the problem, and failing their destination would
    // block a shop for our mistake.
    return jsonWithCors(
      req,
      { error: "Verification is temporarily unavailable. Please try again shortly." },
      503,
    );
  }

  await admin.rpc("mark_destination_verifying", { p_destination_id: dest.id });

  const lookup = await airtelLookupSubscriber(cfg, dest.account_identifier);

  if (lookup.result === "unknown") {
    // Same reasoning as above: an unreachable rail is not a bad number. Put it
    // back to unverified so the merchant can simply try again.
    await admin
      .from("merchant_payout_destinations")
      .update({ verification_status: "unverified" })
      .eq("id", dest.id);

    return jsonWithCors(
      req,
      {
        destination_id: dest.id,
        verification_status: "unverified",
        error: "We could not reach Airtel just now. Please try again in a minute.",
      },
      503,
    );
  }

  if (lookup.result === "failed") {
    await admin.rpc("mark_destination_failed", {
      p_destination_id: dest.id,
      p_error: lookup.reason,
    });
    return jsonWithCors(req, {
      destination_id: dest.id,
      verification_status: "failed",
      error: lookup.reason,
    });
  }

  const { data: verified, error: verifyError } = await admin.rpc(
    "mark_destination_verified",
    {
      p_destination_id: dest.id,
      p_method: "airtel_name_lookup",
      p_verified_name: lookup.name,
      p_reference: null,
    },
  );

  if (verifyError) {
    return jsonWithCors(
      req,
      { error: "Verification succeeded but could not be recorded.", detail: verifyError.message },
      500,
    );
  }

  return jsonWithCors(req, {
    destination_id: dest.id,
    verification_status: "verified",
    verified_account_name: lookup.name,
    claimed_account_name: dest.account_name,
    name_matches_claim: (verified as Record<string, unknown>)?.name_matches_claim ?? null,
    message:
      "Your payout details are verified. You can now accept gift collections.",
  });
});
