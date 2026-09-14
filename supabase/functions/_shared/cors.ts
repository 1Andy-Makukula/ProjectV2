/**
 * Restricts browser CORS to configured origins (APP_URL / ALLOWED_ORIGINS).
 * Server-to-server webhooks should not use these headers.
 *
 * LOCALHOST IS OPT-IN, AND THAT IS THE POINT
 * ------------------------------------------
 * This helper used to echo back any `http://localhost:*` or `http://127.0.0.1:*`
 * Origin unconditionally, in every environment. On the deployed project that is
 * a real hole rather than a theoretical one: `Access-Control-Allow-Origin` is
 * the browser's only reason to refuse a cross-origin read, so any page a user
 * happened to have running locally -- a dev server for another project, a
 * downloaded tool, anything on any port -- could call these functions from
 * their browser and read the response with their session attached.
 *
 * Deny by default, enable explicitly. Local development sets
 * ALLOW_LOCAL_ORIGINS=true in supabase/functions/.env (gitignored, never a
 * project secret). Production simply never sets it.
 *
 * Note that when neither APP_URL nor ALLOWED_ORIGINS is configured, the
 * fallback origin is already `http://localhost:5173`, so a plain local setup
 * keeps working without the flag. The flag is for the case that was actually
 * dangerous: a production APP_URL configured, and localhost echoed anyway.
 */

/** Opt-in, and only ever true when explicitly set. */
function localOriginsAllowed(): boolean {
  return (Deno.env.get("ALLOW_LOCAL_ORIGINS") ?? "").trim().toLowerCase() === "true";
}

function isLocalOrigin(origin: string): boolean {
  return (
    origin.startsWith("http://localhost:") ||
    origin.startsWith("http://127.0.0.1:") ||
    origin === "http://localhost" ||
    origin === "http://127.0.0.1"
  );
}

export function getCorsHeaders(req: Request): Record<string, string> {
  const configured = Deno.env.get("ALLOWED_ORIGINS");
  const allowed = configured
    ? configured.split(",").map((s) => s.trim()).filter(Boolean)
    : [Deno.env.get("APP_URL") ?? "http://localhost:5173"];

  const origin = req.headers.get("Origin");

  // An unrecognised Origin falls back to allowed[0], which is a real configured
  // origin and therefore will not match the requesting page -- the browser
  // blocks the read. That is the intended failure mode; do not widen it to "*".
  const permitted = origin !== null &&
    (allowed.includes(origin) || (localOriginsAllowed() && isLocalOrigin(origin)));

  const allowOrigin = permitted ? origin : allowed[0];

  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Vary": "Origin",
  };
}

export function jsonWithCors(
  req: Request,
  data: unknown,
  status = 200,
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
  });
}
