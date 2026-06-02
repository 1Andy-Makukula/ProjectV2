/**
 * Restricts browser CORS to configured origins (APP_URL / ALLOWED_ORIGINS).
 * Server-to-server webhooks should not use these headers.
 */
export function getCorsHeaders(req: Request): Record<string, string> {
  const configured = Deno.env.get("ALLOWED_ORIGINS");
  const allowed = configured
    ? configured.split(",").map((s) => s.trim()).filter(Boolean)
    : [Deno.env.get("APP_URL") ?? "http://localhost:5173"];

  const origin = req.headers.get("Origin");
  const isLocalhost = origin && (
    origin.startsWith("http://localhost:") || 
    origin.startsWith("http://127.0.0.1:") || 
    origin === "http://localhost" || 
    origin === "http://127.0.0.1"
  );
  
  const allowOrigin =
    origin && (isLocalhost || allowed.some((a) => a === origin)) ? origin : allowed[0];

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
