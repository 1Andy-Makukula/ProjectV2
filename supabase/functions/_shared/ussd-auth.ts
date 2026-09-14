/**
 * Verifies inbound USSD requests using a shared gateway secret.
 * Configure USSD_GATEWAY_SECRET on the Edge Function.
 *
 * Preferred:
 *   X-USSD-HMAC: hex(HMAC-SHA256(rawBody, secret))
 *
 * Legacy, opt-in via USSD_ALLOW_PLAIN_SECRET=true:
 *   X-Kithly-USSD-Secret: <secret>
 *   X-Gateway-Secret: <secret>
 *
 * WHY THE PLAIN HEADER IS NOW OPT-IN
 * ----------------------------------
 * The HMAC path signs the request body, so a captured request cannot be
 * altered and cannot be replayed against different content. The plain header
 * proves only that the sender knows the secret — it covers nothing. Anyone who
 * observes one request (a proxy, a log aggregator, a misconfigured gateway,
 * the aggregator's own support desk) can replay it verbatim, forever, and each
 * replay is a redemption attempt against a real till.
 *
 * Both paths were accepted unconditionally, which meant the weaker one was
 * always available regardless of what the aggregator could actually do. Now
 * the default is HMAC-only and the fallback has to be turned on deliberately:
 *
 *   supabase secrets set USSD_ALLOW_PLAIN_SECRET=true
 *
 * Turn it off once the aggregator confirms it can sign. The flag exists so
 * that switching is a decision someone makes rather than a silent default, and
 * so that turning it off is a config change rather than a deploy.
 */
export async function verifyUssdGateway(
  req: Request,
  rawBody: string,
): Promise<boolean> {
  const secret = Deno.env.get("USSD_GATEWAY_SECRET");
  if (!secret) {
    console.error(
      "[ussd-gateway] USSD_GATEWAY_SECRET is not set — rejecting request.",
    );
    return false;
  }

  // HMAC first: it is the path that should be in use, and trying it first means
  // a correctly-signing gateway never depends on the fallback being enabled.
  const hmacHeader = req.headers.get("x-ussd-hmac");
  if (hmacHeader && rawBody.length > 0) {
    const expected = await hmacSha256Hex(secret, rawBody);
    if (timingSafeEqual(hmacHeader.toLowerCase(), expected)) {
      return true;
    }
    // A present-but-wrong signature is not a candidate for the weaker path.
    // Falling through to the plain header here would let an attacker downgrade
    // the check by sending a junk signature alongside a stolen secret.
    console.error("[ussd-gateway] X-USSD-HMAC present but did not verify — rejecting.");
    return false;
  }

  const plainAllowed =
    (Deno.env.get("USSD_ALLOW_PLAIN_SECRET") ?? "").trim().toLowerCase() === "true";

  const plain =
    req.headers.get("x-kithly-ussd-secret") ??
    req.headers.get("x-gateway-secret");

  if (plain) {
    if (!plainAllowed) {
      console.error(
        "[ussd-gateway] Plain shared-secret header received but USSD_ALLOW_PLAIN_SECRET is not enabled — rejecting. The gateway should send X-USSD-HMAC.",
      );
      return false;
    }
    if (timingSafeEqual(plain, secret)) {
      console.warn(
        "[ussd-gateway] Authenticated via the replayable plain secret header. Move the aggregator to X-USSD-HMAC and unset USSD_ALLOW_PLAIN_SECRET.",
      );
      return true;
    }
  }

  return false;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(message),
  );
  return [...new Uint8Array(sig)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Redact MSISDN for logs: keep last 4 digits only. */
export function redactPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length <= 4) return "****";
  return `***${digits.slice(-4)}`;
}
