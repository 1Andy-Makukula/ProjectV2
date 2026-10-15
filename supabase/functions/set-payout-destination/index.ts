/**
 * set-payout-destination
 *
 * The only way in to `set_payout_destination`, which records where a shop's
 * money is sent. `20261013000000` revoked `anon` and `authenticated` from it,
 * along with the other 27 escrow money functions.
 *
 * WHY THIS EXISTS
 * ---------------
 * `usePayoutDestination.ts` called the RPC straight from the browser and
 * passed `p_actor_user_id` with it. The function authorises by asking whether
 * THAT id is assigned to the shop in `merchant_shops` -- not whether the
 * caller is that person. So the authorisation rested on a value the caller
 * chose, and a signed-in user could name somebody who IS assigned to a shop
 * and set where that shop's payouts land. On a feature whose entire job is
 * "which account receives the money", that is the one thing it must not do.
 *
 * The id is no longer the client's to supply: it is the id of the JWT
 * authenticated below. The RPC's body is unchanged -- its `merchant_shops`
 * check now receives a verified id and means what it says.
 *
 * WHO MAY CALL IT
 * ---------------
 * Either the merchant assigned to the shop, or an admin -- matching what the
 * RPC allowed before, so no capability is lost. Both are established here from
 * the token rather than asserted by the caller.
 *
 * Verification is a separate endpoint and stays that way:
 * `verify-payout-destination` proves the account exists and belongs to the
 * named person. This one only records the intent.
 */

import { getCorsHeaders, jsonWithCors } from "../_shared/cors.ts";
import {
  authenticateCaller,
  createAdminClient,
  type AdminClient,
} from "../_shared/auth.ts";

const FN = "set-payout-destination";

interface SetPayoutDestinationPayload {
  shop_id?: string;
  rail?: string;
  account_identifier?: string;
  account_name?: string;
  bank_name?: string | null;
  bank_branch?: string | null;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: getCorsHeaders(req) });
  }

  if (req.method !== "POST") {
    return jsonWithCors(req, { error: `Method '${req.method}' not allowed. Use POST.` }, 405);
  }

  try {
    let body: SetPayoutDestinationPayload;
    try {
      body = await req.json();
    } catch {
      return jsonWithCors(req, { error: "Request body must be valid JSON." }, 400);
    }

    const shopId = body.shop_id?.trim();
    const rail = body.rail?.trim();
    const accountIdentifier = body.account_identifier?.trim();
    const accountName = body.account_name?.trim();

    if (!shopId) {
      return jsonWithCors(req, { error: "shop_id is required." }, 400);
    }
    if (!rail) {
      return jsonWithCors(req, { error: "rail is required." }, 400);
    }
    // The function normalises and validates these too -- an MSISDN has to be
    // stored in one shape or a duplicate-destination check quietly stops
    // working -- so this is only to answer an empty form without a round trip.
    if (!accountIdentifier) {
      return jsonWithCors(req, { error: "Payout account identifier is required." }, 400);
    }
    if (!accountName) {
      return jsonWithCors(req, { error: "Payout account name is required." }, 400);
    }

    let adminClient: AdminClient;
    try {
      adminClient = createAdminClient(FN);
    } catch (configError: unknown) {
      console.error(configError instanceof Error ? configError.message : configError);
      return jsonWithCors(req, { error: "Server configuration error." }, 500);
    }

    const caller = await authenticateCaller(req, adminClient, FN);
    if (caller instanceof Response) return caller;

    // Assigned to this shop, or an admin. `requireMerchantForShop` would answer
    // the first half, but it returns a 403 Response rather than a boolean, so
    // the admin fallback is clearer written out than recovered from.
    const { data: assignment, error: assignError } = await adminClient
      .from("merchant_shops")
      .select("shop_id")
      .eq("user_id", caller.id)
      .eq("shop_id", shopId)
      .maybeSingle();

    if (assignError) {
      console.error(`[${FN}] Could not read the shop assignment:`, assignError.message);
      return jsonWithCors(req, { error: "Could not verify your access to this shop." }, 500);
    }

    if (!assignment) {
      const { data: profile, error: profileError } = await adminClient
        .from("users")
        .select("role")
        .eq("id", caller.id)
        .maybeSingle();

      if (profileError || profile?.role !== "admin") {
        console.error(
          `[${FN}] ${caller.id} is neither assigned to shop ${shopId} nor an admin:`,
          profileError?.message ?? `role="${profile?.role ?? "none"}"`,
        );
        return jsonWithCors(req, { error: "Forbidden" }, 403);
      }
    }

    const { data: result, error: rpcError } = await adminClient.rpc(
      "set_payout_destination",
      {
        p_shop_id: shopId,
        // From the verified token, never from the request body.
        p_actor_user_id: caller.id,
        p_rail: rail,
        p_account_identifier: accountIdentifier,
        p_account_name: accountName,
        p_bank_name: body.bank_name ?? null,
        p_bank_branch: body.bank_branch ?? null,
      },
    );

    if (rpcError) {
      const message = rpcError.message ?? "";
      console.error(`[${FN}] Could not set the destination:`, message);

      if (message.includes("Forbidden")) {
        return jsonWithCors(req, { error: "Forbidden" }, 403);
      }
      // Everything the function validates itself: the rail, the account name,
      // and the shape of a Zambian mobile number.
      if (
        message.includes("required") ||
        message.includes("not a valid") ||
        message.includes("Unsupported") ||
        message.includes("rail")
      ) {
        return jsonWithCors(req, { error: message }, 400);
      }
      return jsonWithCors(req, { error: "Could not save the payout destination." }, 500);
    }

    return jsonWithCors(req, { success: true, result: result ?? null }, 200);
  } catch (unexpected: unknown) {
    console.error(`[${FN}] Unhandled error:`, unexpected);
    return jsonWithCors(req, { error: "An unexpected error occurred." }, 500);
  }
});
