/**
 * Verifies inbound USSD requests using a shared gateway secret.
 * Configure USSD_GATEWAY_SECRET on the Edge Function.
 *
 * Supported headers (any one):
 *   X-Kithly-USSD-Secret: <secret>
 *   X-Gateway-Secret: <secret>
 *   X-USSD-HMAC: hex(HMAC-SHA256(rawBody, secret))
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

  const plain =
    req.headers.get("x-kithly-ussd-secret") ??
    req.headers.get("x-gateway-secret");
  if (plain && timingSafeEqual(plain, secret)) {
    return true;
  }

  const hmacHeader = req.headers.get("x-ussd-hmac");
  if (hmacHeader && rawBody.length > 0) {
    const expected = await hmacSha256Hex(secret, rawBody);
    if (timingSafeEqual(hmacHeader.toLowerCase(), expected)) {
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
