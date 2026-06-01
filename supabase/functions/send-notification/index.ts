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

interface NotificationPayload {
  recipient_name: string;
  recipient_phone: string;
  sender_name: string;
  shop_name: string;
  claim_code: string;
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

  try {
    if (!Deno.env.get('TWILIO_ACCOUNT_SID')) throw new Error('Missing TWILIO_ACCOUNT_SID');
    if (!Deno.env.get('TWILIO_AUTH_TOKEN')) throw new Error('Missing TWILIO_AUTH_TOKEN');

    console.log(`[NOTIFY] Received payload:`, await req.clone().json());

    let payload: NotificationPayload;
    try {
      payload = await req.json();
    } catch {
      return jsonWithCors(req, { error: "Request body must be valid JSON." }, 400);
    }

    const { recipient_name, recipient_phone, sender_name, shop_name, claim_code } = payload;

    if (!recipient_name || !recipient_phone || !sender_name || !shop_name || !claim_code) {
      return jsonWithCors(
        req,
        { error: "Missing required fields: recipient_name, recipient_phone, sender_name, shop_name, claim_code are all required." },
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
    const bodyMessage = `Hi ${recipient_name}! 🎉 ${sender_name} has bought you a gift bundle waiting at ${shop_name}. \n\nYour Master Claim Code is: *${claim_code}*\n\nClick here to unwrap your gift and see your QR code: ${appUrl}/gift/${claim_code} \n\n- Powered by KithLy`;

    console.log(`[send-notification] Dispatching WhatsApp notification to: ${formattedPhone}`);

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
