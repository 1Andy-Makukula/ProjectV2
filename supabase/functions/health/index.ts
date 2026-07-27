/**
 * health
 *
 * Unauthenticated liveness probe for the Edge Function runtime. Used by the
 * in-app diagnostics suite to measure reachability and TTFB.
 *
 * Returns no data about the deployment beyond "ok" — keep it that way.
 *
 * Replaces the bare `GET` handler of the retired monolithic `server` function.
 */

import { getCorsHeaders, jsonWithCors } from "../_shared/cors.ts";

Deno.serve((req: Request): Response => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: getCorsHeaders(req) });
  }

  return jsonWithCors(req, { status: "ok" });
});
