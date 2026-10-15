/**
 * admin-fee-sweep
 *
 * The only way in to `propose_fee_sweep`, `confirm_fee_sweep` and
 * `cancel_fee_sweep`. A fee sweep moves KithLy's accrued platform fees out of
 * the segregated escrow account, so all three are money functions and
 * `20261013000000` revoked `anon` and `authenticated` from them.
 *
 * WHY THIS EXISTS
 * ---------------
 * `useEscrowAdmin.ts` used to call all three straight from the browser, and
 * two of them took the acting admin's id AS A PARAMETER from that browser.
 * They checked that the id named an admin and never that the caller was that
 * admin -- so anyone who knew an admin's user id could confirm a sweep and
 * have `admin_action_log` record that admin as having done it. The grants made
 * that reachable with the public anon key; the missing caller check made it
 * useful.
 *
 * Here `p_admin_id` is not accepted from the client at all. It is the id of
 * the JWT `requireAdmin` just verified, which is the whole point of the hop.
 *
 * WHY service_role AND NOT THE CALLER'S OWN JWT
 * ---------------------------------------------
 * `admin-confirm-payment` deliberately forwards the caller's JWT, because its
 * RPC authorises through `auth.uid()` and a service-role client has no session
 * to satisfy that. These three are different: they are named in
 * `supabase/tests/ci_smoke_checks.sql` check 4, which requires that no money
 * function be reachable by `anon` or `authenticated` at all. Forwarding the
 * caller's JWT would mean keeping that grant, so the call is made with the
 * service role and the RPCs carry a matching exemption -- their caller checks
 * apply to a direct caller and step aside for `service_role`, which has
 * already been through `requireAdmin` here.
 */

import { getCorsHeaders, jsonWithCors } from "../_shared/cors.ts";
import { createAdminClient, requireAdmin, type AdminClient } from "../_shared/auth.ts";

const FN = "admin-fee-sweep";

type Action = "propose" | "confirm" | "cancel";

interface AdminFeeSweepPayload {
  action?: string;
  /** Optional for `propose`; the function defaults it to today in Lusaka. */
  sweep_date?: string | null;
  /** Required for `confirm` and `cancel`. */
  sweep_id?: string;
  /** Required for `confirm`: evidence that the transfer actually happened. */
  bank_reference?: string;
  /** Required for `cancel`. */
  reason?: string;
}

const ACTIONS: readonly Action[] = ["propose", "confirm", "cancel"] as const;

function isAction(value: unknown): value is Action {
  return typeof value === "string" && (ACTIONS as readonly string[]).includes(value);
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: getCorsHeaders(req) });
  }

  if (req.method !== "POST") {
    return jsonWithCors(req, { error: `Method '${req.method}' not allowed. Use POST.` }, 405);
  }

  try {
    let body: AdminFeeSweepPayload;
    try {
      body = await req.json();
    } catch {
      return jsonWithCors(req, { error: "Request body must be valid JSON." }, 400);
    }

    if (!isAction(body.action)) {
      return jsonWithCors(
        req,
        { error: `action must be one of: ${ACTIONS.join(", ")}.` },
        400,
      );
    }
    const action: Action = body.action;

    const sweepId = body.sweep_id?.trim();
    if ((action === "confirm" || action === "cancel") && !sweepId) {
      return jsonWithCors(req, { error: "sweep_id is required." }, 400);
    }

    // Checked here as well as in the function. The database raises for an empty
    // reference because the ledger is recording money that moved, and saying so
    // before the round trip gives the screen a better error than a raw SQLSTATE.
    const bankReference = body.bank_reference?.trim();
    if (action === "confirm" && !bankReference) {
      return jsonWithCors(
        req,
        { error: "A bank reference is required: the ledger records money that moved." },
        400,
      );
    }

    const reason = body.reason?.trim();
    if (action === "cancel" && !reason) {
      return jsonWithCors(req, { error: "A reason is required to cancel a sweep." }, 400);
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

    // `admin.id` comes from the verified JWT, never from the request body --
    // that substitution is the entire reason this function exists.
    //
    // One RPC name and one argument object, chosen before the call, rather than
    // a switch that returns three different query builders: that shape leaves
    // the compiler deciding whether every branch returns, and this file is not
    // covered by `pnpm typecheck` (tsconfig excludes supabase/).
    let rpcName: string;
    let rpcArgs: Record<string, unknown>;

    if (action === "propose") {
      rpcName = "propose_fee_sweep";
      rpcArgs = { p_sweep_date: body.sweep_date ?? null };
    } else if (action === "confirm") {
      rpcName = "confirm_fee_sweep";
      rpcArgs = {
        p_sweep_id: sweepId,
        p_bank_reference: bankReference,
        p_admin_id: admin.id,
      };
    } else {
      rpcName = "cancel_fee_sweep";
      rpcArgs = {
        p_sweep_id: sweepId,
        p_reason: reason,
        p_admin_id: admin.id,
      };
    }

    const { data: result, error: rpcError } = await adminClient.rpc(rpcName, rpcArgs);

    if (rpcError) {
      const message = rpcError.message ?? "";
      console.error(`[${FN}] ${action} failed:`, message);

      // Map the function's own refusals to codes the admin screen can act on,
      // rather than reporting a deliberate refusal as a server fault.
      if (message.includes("No such sweep")) {
        return jsonWithCors(req, { error: "That sweep no longer exists." }, 404);
      }
      if (
        message.includes("awaiting confirmation") ||
        message.includes("bank reference is required") ||
        message.includes("Nothing accrued")
      ) {
        return jsonWithCors(req, { error: message }, 400);
      }
      if (
        message.includes("admin only") ||
        message.includes("must be the caller") ||
        message.includes("Not authenticated")
      ) {
        return jsonWithCors(req, { error: "Administrator privileges are required." }, 403);
      }
      return jsonWithCors(req, { error: `Failed to ${action} the fee sweep.` }, 500);
    }

    return jsonWithCors(req, { success: true, action, result: result ?? null }, 200);
  } catch (unexpected: unknown) {
    console.error(`[${FN}] Unhandled error:`, unexpected);
    return jsonWithCors(req, { error: "An unexpected error occurred." }, 500);
  }
});
