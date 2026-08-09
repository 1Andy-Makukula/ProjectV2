/**
 * ============================================================================
 * Phase 8: Notification Ecosystem (The Last Mile)
 * ============================================================================
 * 
 * Local Environment Setup Instructions:
 * 1. Add Twilio credentials to your local `.env.local` file:
 *    TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
 *    TWILIO_AUTH_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
 *    APP_URL=http://localhost:5173
 * 
 * 2. Deploy these secrets to production using the Supabase CLI:
 *    supabase secrets set TWILIO_ACCOUNT_SID=AC... TWILIO_AUTH_TOKEN=...
 * 
 * ============================================================================
 */

import { getCorsHeaders, jsonWithCors } from "../_shared/cors.ts";
import { isServiceRoleCaller } from "../_shared/auth.ts";

interface NotificationPayload {
  recipient_name: string;
  recipient_phone: string;
  // Gift-claim template fields — required unless `message` is provided instead.
  sender_name?: string;
  shop_name?: string;
  claim_code?: string;
  // Generic override — when set, this is sent verbatim instead of composing
  // the gift-claim template, so other flows (e.g. expiry reminders) can reuse
  // this function's Twilio/WhatsApp plumbing without pretending to be a gift.
  message?: string;
}

Deno.serve(async (req: Request): Promise<Response> => {
  // CORS Preflight handling
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: getCorsHeaders(req) });
  }

  if (req.method !== "POST") {
    return jsonWithCors(
      req,
      { error: `Method '${req.method}' not allowed. Use POST.` },
      405,
    );
  }

  // This function used to accept any caller with no check at all — anyone who
  // found the URL could send arbitrary WhatsApp messages through KithLy's
  // Twilio account. Every real caller (verify-payment, flutterwave-webhook,
  // and now the expiry-reminder dispatch) already invokes it with the service
  // role key, so this costs those callers nothing.
  const headerSecret = req.headers.get("x-notify-secret");
  const notifySecret = Deno.env.get("SEND_NOTIFICATION_SECRET");
  const viaHeader = Boolean(headerSecret && notifySecret && headerSecret === notifySecret);

  if (!viaHeader) {
    // Service-role rights, established by claim rather than by string-matching
    // one key. The old comparison broke on key rotation and did not recognise
    // Supabase's opaque sb_secret_ keys.
    //
    // This one guards real money and real messages: until Twilio credentials
    // were set and Vault was populated, neither the credentials nor the
    // scheduler existed, so this guard had never been exercised by an actual
    // expiry-reminder run. It is now, every fifteen minutes.
    const authorised = isServiceRoleCaller(req, "SEND_NOTIFICATION_SECRET");
    if (!authorised.ok) {
      console.error(`[send-notification] Unauthorized notification request: ${authorised.reason}`);
      return jsonWithCors(req, { error: "Unauthorized." }, 401);
    }
  }

  try {
    if (!Deno.env.get('TWILIO_ACCOUNT_SID')) throw new Error('Missing TWILIO_ACCOUNT_SID');
    if (!Deno.env.get('TWILIO_AUTH_TOKEN')) throw new Error('Missing TWILIO_AUTH_TOKEN');

    // The whole payload used to be logged here. It carries claim_code and
    // recipient_phone.
    //
    // A claim code is a bearer instrument -- whoever holds it can collect the
    // gift (see src/utils/whatsapp.ts for that decision and what follows from
    // it). Logging one puts a credential into function logs, where it is
    // retained, searchable, and readable by anyone with dashboard access. The
    // recipient's phone number is personal data with no reason to be there
    // either.
    //
    // Nothing here needed the payload logged; it was debugging that outlived
    // its purpose. What is useful is that a request arrived and what shape it
    // was, which is what the success and failure paths already record.

    let payload: NotificationPayload;
    try {
      payload = await req.json();
    } catch {
      return jsonWithCors(req, { error: "Request body must be valid JSON." }, 400);
    }

    const { recipient_name, recipient_phone, sender_name, shop_name, claim_code, message } = payload;

    if (!recipient_name || !recipient_phone) {
      return jsonWithCors(
        req,
        { error: "recipient_name and recipient_phone are required." },
        400,
      );
    }

    const hasClaimTemplate = Boolean(sender_name && shop_name && claim_code);
    const hasGenericMessage = Boolean(message && message.trim());

    if (!hasClaimTemplate && !hasGenericMessage) {
      return jsonWithCors(
        req,
        {
          error:
            "Either sender_name, shop_name and claim_code (gift-claim notification), or message (generic notification), is required.",
        },
        400,
      );
    }

    // 1. Fetch & Verify environment variables
    const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID");
    const authToken = Deno.env.get("TWILIO_AUTH_TOKEN");

    if (!accountSid || !authToken) {
      console.error("[send-notification] TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN is not configured.");
      return jsonWithCors(
        req,
        { error: "Twilio service configuration error. Environment variables are missing." },
        500,
      );
    }

    // 2. Format the phone number (Escaping and prefixing whatsapp:)
    let formattedPhone = recipient_phone.trim();
    if (!formattedPhone.startsWith("whatsapp:")) {
      if (!formattedPhone.startsWith("+")) {
        if (formattedPhone.startsWith("0")) {
          // Zambia default prefix +260
          formattedPhone = "+260" + formattedPhone.slice(1);
        } else {
          formattedPhone = "+" + formattedPhone;
        }
      }
      formattedPhone = "whatsapp:" + formattedPhone;
    }

    // 3. Resolve app/production URL and construct message body
    const appUrl = (Deno.env.get("APP_URL") ?? "https://project-h48n1.vercel.app").replace(/\/$/, "");
    const bodyMessage = hasGenericMessage
      ? message!.trim()
      : `Hi ${recipient_name}! ${sender_name} has bought you a gift bundle waiting at ${shop_name}. \n\nYour Master Claim Code is: *${claim_code}*\n\nClick here to unwrap your gift and see your QR code: ${appUrl}/gift/${claim_code} \n\n- Powered by KithLy`;

    // Masked. Enough to tell one recipient from another when reading logs, not
    // enough to be a list of customer phone numbers sitting in a log store.
    const maskedPhone = formattedPhone.replace(/\d(?=\d{3})/g, "•");
    console.log(`[send-notification] Dispatching WhatsApp notification to: ${maskedPhone}`);

    // 4. Construct form URL-encoded body parameters for Twilio REST API
    const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
    const params = new URLSearchParams();
    params.set("To", formattedPhone);
    params.set("From", "whatsapp:+14155238886"); // Twilio WhatsApp Sandbox Sender Number
    params.set("Body", bodyMessage);

    // 5. Send POST request using Basic Authentication
    const twilioResponse = await fetch(twilioUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Authorization": "Basic " + btoa(`${accountSid}:${authToken}`),
      },
      body: params.toString(),
    });

    const responseText = await twilioResponse.text();
    console.log(`[TWILIO] Response Status: ${twilioResponse.status}`);
    console.log(`[TWILIO] Response Body:`, responseText);

    if (!twilioResponse.ok) {
      console.error(
        `[send-notification] Twilio API call failed with status ${twilioResponse.status}:`,
        responseText,
      );
      return jsonWithCors(
        req,
        { error: `Twilio gateway rejected notification: ${responseText}` },
        502,
      );
    }

    console.log(`[send-notification] Notification successfully accepted by Twilio API!`);
    return jsonWithCors(req, { success: true, message: "Notification sent." });

  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error("[send-notification] Unhandled Exception:", errorMsg);
    return jsonWithCors(req, { error: `Internal server error: ${errorMsg}` }, 500);
  }
});
