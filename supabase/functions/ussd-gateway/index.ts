import { createClient } from "jsr:@supabase/supabase-js@2.49.8";
import { redactPhone, verifyUssdGateway } from "../_shared/ussd-auth.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface UssdPayload {
  phoneNumber: string;
  text: string;
}

interface AtomicFulfillResult {
  voucher_id: string;
  item_name: string;
  recipient_name: string;
  claim_code: string;
  shop_id: string;
}

interface LedgerInsertResult {
  id: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FRAUD_REJECTION_PREFIX = "FRAUD_REJECTION:" as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Telecom USSD gateways require `text/plain` responses starting with
 * CON (continue) or END (terminate session).
 */
function ussdResponse(message: string, status = 200): Response {
  return new Response(message, {
    status,
    headers: { "Content-Type": "text/plain" },
  });
}

/**
 * Extracts the claim code from a USSD string.
 *
 * Telecom gateways pass the dialled string in various formats depending on
 * the gateway and session state.
 * Examples:
 *   - "*130*758*BNDL-7QK2M4XR9WZP#"
 *   - "130*758*BNDL-A1B2C3"        (legacy 6-char body, still live)
 *   - "A1B2C3D4"                   (bare 8-char code)
 *
 * The code is read from the END of the string, optionally past a trailing hash.
 *
 * The prefixed alternative is deliberately listed FIRST. Alternation is tried
 * left to right at each position, and a bare `[A-Z0-9]{8}` anchored to `$`
 * happily matches the last eight characters of "BNDL-7QK2M4XR9WZP" -- so with
 * the old ordering a 12-char code would be silently truncated to a fragment
 * that matches no voucher, and the merchant would be told the gift code was
 * invalid.
 *
 * The 6..16 body range accepts both the 6-char codes already in circulation and
 * the 12-char ones checkout-init issues now (see CLAIM_CODE_LENGTH there).
 */
function extractClaimCode(text: string): string | null {
  const normalisedText = text.trim().toUpperCase();
  const match = normalisedText.match(/([A-Z0-9]{4}-[A-Z0-9]{6,16}|[A-Z0-9]{8})#?$/);
  return match ? match[1] : null;
}

/**
 * Initialises the Supabase service-role client.
 * Required because USSD gateways do not possess merchant JWTs.
 */
function getAdminClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!url || !serviceRoleKey) {
    throw new Error("SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing.");
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

// ---------------------------------------------------------------------------
// Core Handler
// ---------------------------------------------------------------------------

function parseUssdPayload(
  rawBody: string,
  contentType: string,
): { phoneNumber: string | null; text: string | null } {
  try {
    if (contentType.includes("application/json")) {
      const body = JSON.parse(rawBody) as Record<string, unknown>;
      return {
        phoneNumber: String(body.phoneNumber ?? body.msisdn ?? body.sender ?? ""),
        text: String(body.text ?? body.ussdString ?? body.message ?? ""),
      };
    }
    const params = new URLSearchParams(rawBody);
    return {
      phoneNumber: params.get("phoneNumber") ?? params.get("msisdn") ?? "",
      text: params.get("text") ?? params.get("ussdString") ?? "",
    };
  } catch {
    return { phoneNumber: null, text: null };
  }
}

async function handleUssdRequest(req: Request): Promise<Response> {
  const rawBody = await req.text();

  if (!await verifyUssdGateway(req, rawBody)) {
    console.error("[ussd-gateway] Gateway authentication failed.");
    return ussdResponse("END DECLINED: Unauthorized", 401);
  }

  const contentType = req.headers.get("content-type") || "";
  const { phoneNumber, text } = parseUssdPayload(rawBody, contentType);

  if (!phoneNumber || text === null || text === undefined || text === "") {
    console.error("[ussd-gateway] Missing required fields in payload.");
    return ussdResponse("END DECLINED: Missing parameters", 400);
  }

  const normalisedPhone = phoneNumber.trim();

  console.log(
    `[ussd-gateway] USSD request | phone=${redactPhone(normalisedPhone)} | text_len=${text.length}`,
  );

  // --- 2. Extract claim code ---
  const claimCode = extractClaimCode(text);
  if (!claimCode) {
    console.error("[ussd-gateway] Could not extract a claim code from USSD text.");
    return ussdResponse("END DECLINED: Invalid gift code format", 400);
  }

  // --- 3. Build admin client ---
  let adminClient: ReturnType<typeof getAdminClient>;
  try {
    adminClient = getAdminClient();
  } catch (err: unknown) {
    console.error("[ussd-gateway] Server config error:", err);
    return ussdResponse("END DECLINED: Internal server error", 500);
  }

  // --- 4. Resolve shop_id via Merchant Phone Number ---
  //
  // Because the USSD gateway does not send a JWT, we use the MSISDN (phone number)
  // as a hard-bound hardware identifier to look up the merchant's user_id,
  // and subsequently their assigned shop_id.
  
  // 4a. Find User by phone
  const { data: userRow, error: userError } = await adminClient
    .from("users")
    .select("id")
    .eq("phone", normalisedPhone)
    .maybeSingle<{ id: string }>();

  // maybeSingle() used to be able to see two rows here and fail with PGRST116,
  // because users.phone had no UNIQUE constraint: any app user could set their
  // number to a merchant's and knock that till offline from their profile
  // screen. Migration 20260903010000 makes the number unique, so a second row
  // can no longer exist and this branch means genuinely unregistered.
  //
  // The number is redacted in this log line. It was printed in full, which put
  // merchant MSISDNs into the log store on every failed dial -- the rest of
  // this function already uses redactPhone.
  if (userError || !userRow) {
    console.error(
      `[ussd-gateway] Phone lookup failed or unregistered | phone=${redactPhone(normalisedPhone)}`,
    );
    return ussdResponse("END Unregistered Merchant Device");
  }

  // 4b. Find Shop Assignment
  //
  // Was `.limit(1).maybeSingle()`, which silently picked whichever row the
  // planner returned first for a merchant assigned to more than one shop. That
  // shop_id is then handed to atomic_fulfill_voucher, which validates the
  // voucher against it -- so a multi-store merchant either had a valid gift
  // rejected, or redeemed it against the wrong store's books, with the
  // settlement following the wrong shop.
  //
  // Two rows is now an explicit refusal. There is no signal in a USSD session
  // that says which till is dialling, so guessing is the one thing this must
  // not do with a redemption. Multi-store merchants need a per-device binding
  // (a merchant_devices table keyed by MSISDN) before USSD can serve them;
  // until then they fulfil through the app, where the shop is chosen
  // explicitly.
  const { data: shopRows, error: shopError } = await adminClient
    .from("merchant_shops")
    .select("shop_id")
    .eq("user_id", userRow.id)
    .limit(2)
    .returns<{ shop_id: string }[]>();

  if (shopError || !shopRows || shopRows.length === 0) {
    console.error(`[ussd-gateway] Shop assignment lookup failed | user=${userRow.id}`);
    return ussdResponse("END Unregistered Merchant Device");
  }

  if (shopRows.length > 1) {
    console.error(
      `[ussd-gateway] Refusing to guess a shop: user=${userRow.id} is assigned to multiple shops. USSD cannot disambiguate.`,
    );
    return ussdResponse("END DECLINED: This number serves multiple shops. Please redeem in the KithLy app.");
  }

  const shopId = shopRows[0].shop_id;
  const merchantUserId = userRow.id;

  console.log(`[ussd-gateway] Device registered | phone=${redactPhone(normalisedPhone)} | shop=${shopId}`);

  // --- 5. Execute Atomic Fulfillment RPC ---
  const { data: rpcResult, error: rpcError } = await adminClient.rpc(
    "atomic_fulfill_voucher",
    {
      p_claim_code: claimCode,
      p_shop_id: shopId,
    },
  );

  // --- 6. Handle RPC Result & Audit Ledger ---

  if (rpcError) {
    const errorMessage: string = rpcError.message ?? "";

    if (errorMessage.startsWith(FRAUD_REJECTION_PREFIX)) {
      const rejectionReason = errorMessage.slice(FRAUD_REJECTION_PREFIX.length).trim();
      console.error(`[ussd-gateway] FRAUD_REJECTION | code=${claimCode} | reason=${rejectionReason}`);

      // Log the rejected attempt
      await adminClient.from("transaction_events").insert({
        transaction_id: null,
        event_type: "FRAUD_REJECTION",
        payload: JSON.stringify({
          claim_code: claimCode,
          shop_id: shopId,
          merchant_user_id: merchantUserId,
          rejection_reason: rejectionReason,
          terminal_type: "ussd",
        }),
      });

      // Format plain-text rejection for the handset
      return ussdResponse(`END DECLINED: ${rejectionReason}`);
    }

    console.error(`[ussd-gateway] RPC infrastructure error:`, rpcError);
    return ussdResponse("END DECLINED: System error. Try again.");
  }

  // --- 7. Success Path ---
  const resultRow = Array.isArray(rpcResult) ? rpcResult[0] : rpcResult;

  if (!resultRow || !resultRow.voucher_id || !resultRow.item_name || !resultRow.recipient_name) {
    console.error("[ussd-gateway] RPC returned malformed success payload:", resultRow);
    return ussdResponse("END DECLINED: Verification error. Contact support.");
  }

  const fulfillResult = resultRow as AtomicFulfillResult;

  // Claim code masked. It is a bearer instrument -- whoever holds it can
  // collect the gift (see src/utils/whatsapp.ts) -- so a log line containing
  // one is a credential sitting in a retained, searchable store. The last two
  // characters are enough to correlate with a support enquiry; the whole code
  // is enough to redeem someone else's order.
  //
  // The full code remains on the transaction_events row written just below,
  // which is the audit trail and is access-controlled. Logs are not.
  const maskedCode = `${"•".repeat(Math.max(0, claimCode.length - 2))}${claimCode.slice(-2)}`;
  console.log(`[ussd-gateway] SUCCESS | code=${maskedCode} | item=${fulfillResult.item_name}`);

  // Log the successful fulfillment
  await adminClient.from("transaction_events").insert({
    transaction_id: fulfillResult.voucher_id,
    event_type: "CLAIM_VERIFIED",
    payload: JSON.stringify({
      terminal_type: "ussd",
      action: "ussd_scan",
      merchant_user_id: merchantUserId,
      shop_id: shopId,
      claim_code: claimCode,
    }),
  });

  // Render the plain-text approval for the handset
  return ussdResponse(`END FULFILLED: ${fulfillResult.item_name} for ${fulfillResult.recipient_name}`);
}

// ---------------------------------------------------------------------------
// Deno.serve entry-point
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request): Promise<Response> => {
  // Telecom gateways usually don't use CORS/OPTIONS, but included for completeness
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
      },
    });
  }

  if (req.method !== "POST") {
    return ussdResponse("END DECLINED: Method not allowed", 405);
  }

  try {
    return await handleUssdRequest(req);
  } catch (unhandled: unknown) {
    console.error("[ussd-gateway] UNHANDLED EXCEPTION:", unhandled);
    return ussdResponse("END DECLINED: Critical system error", 500);
  }
});
