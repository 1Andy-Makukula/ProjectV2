import { createClient } from "jsr:@supabase/supabase-js@2.49.8";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * The shape of Flutterwave's `charge.completed` event data object.
 * Only the fields this function consumes are declared — the rest flow into
 * the raw `payload` column untouched.
 */
interface FlutterwaveChargeData {
  id: number;         // Flutterwave transaction ID (integer)
  tx_ref: string;     // Our voucher_id, echoed back by Flutterwave
  status: string;     // e.g. "successful" | "failed" | "cancelled"
  amount: number;
  currency: string;
  flw_ref: string;    // Flutterwave's own internal reference
}

/**
 * Top-level shape of any Flutterwave webhook event.
 */
interface FlutterwaveWebhookEvent {
  event: string;      // e.g. "charge.completed"
  data: FlutterwaveChargeData;
  [key: string]: unknown;
}

/**
 * Result of writing a row to `transaction_events`.
 * We only select back the generated PK to confirm the insert succeeded.
 */
interface TransactionEventInsertResult {
  id: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** The only Flutterwave event type this function handles. */
const CHARGE_COMPLETED_EVENT = "charge.completed" as const;

/** A settled payout the provider has since returned to our balance. */
const TRANSFER_REVERSAL_EVENT = "transfer.reversal" as const;

/**
 * Events acknowledged but deliberately not acted on.
 *
 * `transfer.disburse` reports a dispatch the sweeper performed and already
 * recorded. `refund.completed` moves money the opposite way to everything here
 * -- a clawback against a merchant who may already be settled -- and needs its
 * own accounting design rather than a branch in a webhook.
 */
const PAYOUT_EVENTS_RECORDED_ONLY: ReadonlySet<string> = new Set([
  "transfer.disburse",
  "refund.completed",
]);

/** The reference batch-payout-sweeper builds, and what it decodes back to. */
const WITHDRAWAL_REFERENCE_PREFIX = "kithly-withdrawal-";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The status value Flutterwave uses for a successful payment. */
const SUCCESSFUL_STATUS = "successful" as const;

// ---------------------------------------------------------------------------
// CORS / response headers
// ---------------------------------------------------------------------------

/**
 * Flutterwave calls this endpoint directly (server-to-server), so no
 * browser CORS headers are strictly required. We include minimal headers
 * for completeness and to satisfy any reverse-proxy health checks.
 */
const responseHeaders: HeadersInit = {
  "Content-Type": "application/json",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Serialise a value to JSON and wrap it in a Response. */
function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: responseHeaders });
}

/**
 * Returns the Supabase admin (service-role) client.
 * This client bypasses Row Level Security, which is intentional here because
 * webhook processing is a server-side privileged operation — no user JWT is
 * present in inbound Flutterwave requests.
 */
function getAdminClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!url || !serviceRoleKey) {
    throw new Error(
      "[flutterwave-webhook] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not configured.",
    );
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      // Edge Function context is always stateless — never attempt to
      // persist or refresh a session.
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

// ---------------------------------------------------------------------------
// Step 1 — Signature verification
// ---------------------------------------------------------------------------

/**
 * Verifies the `verif-hash` header against the secret stored in the
 * `FLUTTERWAVE_WEBHOOK_SECRET` environment variable.
 *
 * Flutterwave requires a **200 OK** response within a short timeout window.
 * Any non-200 response causes them to retry up to 5 times with exponential
 * back-off. We therefore perform this check synchronously before any async DB
 * work so that we can fast-fail unauthenticated requests cheaply.
 *
 * @returns `null` when the signature is valid; a `Response` to return
 *          immediately when it is not.
 */
function verifySignature(req: Request): Response | null {
  const incomingHash = req.headers.get("verif-hash");

  if (!incomingHash) {
    console.error("[flutterwave-webhook] Missing 'verif-hash' header — rejecting request.");
    // Return 401 to make replay-attack probing obvious in logs.
    return new Response("Unauthorized", { status: 401 });
  }

  const expectedSecret = Deno.env.get("FLUTTERWAVE_WEBHOOK_SECRET");

  if (!expectedSecret) {
    // Misconfiguration — we cannot authenticate the request.
    // Return 500 so Flutterwave knows to retry later (not to give up).
    console.error(
      "[flutterwave-webhook] FLUTTERWAVE_WEBHOOK_SECRET is not set. Cannot verify webhook.",
    );
    return new Response("Server configuration error", { status: 500 });
  }

  // Constant-time string comparison would be ideal, but Deno's Web Crypto
  // API's `crypto.subtle.timingSafeEqual` only accepts `ArrayBuffer | TypedArray`.
  // We implement it here to prevent timing-oracle attacks on the secret.
  const encoder = new TextEncoder();
  const incomingBytes = encoder.encode(incomingHash);
  const expectedBytes = encoder.encode(expectedSecret);

  if (incomingBytes.length !== expectedBytes.length) {
    console.error("[flutterwave-webhook] Signature length mismatch — rejecting request.");
    return new Response("Unauthorized", { status: 401 });
  }

  // XOR each byte pair; accumulate into `diff`. If all bytes match, diff === 0.
  let diff = 0;
  for (let i = 0; i < expectedBytes.length; i++) {
    diff |= incomingBytes[i] ^ expectedBytes[i];
  }

  if (diff !== 0) {
    console.error("[flutterwave-webhook] Signature mismatch — rejecting request.");
    return new Response("Unauthorized", { status: 401 });
  }

  return null; // Signature is valid
}

// ---------------------------------------------------------------------------
// Step 2 — Body parsing & structural validation
// ---------------------------------------------------------------------------

/**
 * Reads the raw request body as text (for exact ledger preservation) and
 * parses it into a typed `FlutterwaveWebhookEvent`.
 *
 * We intentionally do **not** trust only `event` + `data.status` — we also
 * verify that `data.tx_ref` is a non-empty string before proceeding, because
 * a missing `tx_ref` would make it impossible to look up the voucher.
 *
 * @returns `{ rawBody, event }` on success.
 * @throws `Error` with a descriptive message on parse or shape failure.
 */
/**
 * A settled payout came back. Return it to the merchant's balance.
 *
 * Direction matters and is easy to invert: a withdrawal debits the merchant's
 * KithLy wallet up front, and the transfer fulfils that debit. If the provider
 * reverses it, the money returns to KithLy's balance -- so the merchant is
 * CREDITED, restored to where they were before requesting it, and can withdraw
 * again once their payout details are fixed. This never drives a balance
 * negative; only a buyer-side refund does that, and it is not handled here.
 *
 * Always answers 200 for anything it has definitively dealt with, including
 * payloads it cannot act on. Flutterwave retries non-2xx, and retrying a
 * reversal whose reference does not resolve will never start working. Genuine
 * server faults return 500 so a retry can succeed.
 */
async function handleTransferReversal(
  supabase: ReturnType<typeof getAdminClient>,
  data: Record<string, unknown>,
): Promise<Response> {
  const reference = typeof data.reference === "string" ? data.reference.trim() : "";
  const providerId = data.id === undefined ? "" : String(data.id);

  if (!reference.startsWith(WITHDRAWAL_REFERENCE_PREFIX)) {
    console.error(
      `[flutterwave-webhook] transfer.reversal for an unrecognised reference '${reference}'. ` +
        `Not a KithLy payout — acknowledged, no action.`,
    );
    return json({ received: true, acted: false, reason: "unrecognised reference" });
  }

  const withdrawalId = reference.slice(WITHDRAWAL_REFERENCE_PREFIX.length);
  if (!UUID_PATTERN.test(withdrawalId)) {
    console.error(
      `[flutterwave-webhook] transfer.reversal reference '${reference}' does not carry a valid ` +
        `withdrawal id. Acknowledged, no action.`,
    );
    return json({ received: true, acted: false, reason: "unparseable reference" });
  }

  // Keyed on the reference AND the provider's own id: the reference alone would
  // suppress a second, genuine reversal of a re-attempted payout.
  const eventKey = `transfer.reversal:${reference}:${providerId}`;

  const { data: result, error } = await supabase.rpc("reverse_completed_withdrawal", {
    p_withdrawal_id: withdrawalId,
    p_reason: `Provider reversed the payout (transfer ${providerId || "unknown"})`,
    p_event_key: eventKey,
  });

  if (error) {
    // A withdrawal that is not `paid` means this reversal was matched to
    // something it does not describe -- refusing is correct and retrying will
    // not change it, so acknowledge rather than let Flutterwave hammer it.
    const isStateConflict =
      error.message?.includes("not paid") || error.message?.includes("not found");

    console.error(
      `[flutterwave-webhook] reverse_completed_withdrawal failed for '${reference}': ${error.message}`,
    );

    return isStateConflict
      ? json({ received: true, acted: false, reason: error.message })
      : json({ error: "Could not process reversal." }, 500);
  }

  console.log(
    `[flutterwave-webhook] Payout reversal applied | withdrawal=${withdrawalId} | ` +
      `result=${JSON.stringify(result)}`,
  );
  return json({ received: true, acted: true, withdrawal_id: withdrawalId });
}

function parseAndValidateBody(
  rawBody: string,
): { rawBody: string; event: FlutterwaveWebhookEvent } {
  // Takes the body as a string rather than the Request: a Request body can only
  // be read once, and the handler now has to look at `event` before deciding
  // whether these charge-shaped rules apply at all. A transfer reversal has a
  // `reference` and no `tx_ref`, so validating it here would reject it.
  if (!rawBody || rawBody.trim().length === 0) {
    throw new Error("Request body is empty.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    throw new Error("Request body is not valid JSON.");
  }

  // Structural guard: parsed must be a plain object, not an array or primitive.
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Parsed body must be a JSON object.");
  }

  const obj = parsed as Record<string, unknown>;

  // `event` field
  if (typeof obj.event !== "string" || obj.event.trim().length === 0) {
    throw new Error("Payload is missing a valid 'event' string field.");
  }

  // `data` object
  if (typeof obj.data !== "object" || obj.data === null || Array.isArray(obj.data)) {
    throw new Error("Payload is missing a valid 'data' object field.");
  }

  const data = obj.data as Record<string, unknown>;

  // `data.status` — required for routing logic
  if (typeof data.status !== "string" || data.status.trim().length === 0) {
    throw new Error("Payload data is missing a valid 'status' string field.");
  }

  // `data.tx_ref` — required for voucher lookup; must be a non-empty string
  if (typeof data.tx_ref !== "string" || data.tx_ref.trim().length === 0) {
    throw new Error("Payload data is missing a valid 'tx_ref' string field.");
  }

  // `data.id` — Flutterwave's own transaction ID; must be a finite number
  if (typeof data.id !== "number" || !Number.isFinite(data.id)) {
    throw new Error("Payload data is missing a valid numeric 'id' field.");
  }

  return {
    rawBody,
    event: obj as unknown as FlutterwaveWebhookEvent,
  };
}

// ---------------------------------------------------------------------------
// Step 3 — Immutable ledger write
// ---------------------------------------------------------------------------

/**
 * Appends a row to the `transaction_events` table regardless of whether the
 * charge was successful or not. This provides a complete, append-only audit
 * trail of every event Flutterwave sends us.
 *
 * **This write must never block the 200 OK response to Flutterwave.**
 * Errors here are logged but do not cause the handler to return a non-200
 * status, because the event has already been received and the payment state
 * is authoritative in the `claim_vouchers` table.
 *
 * Column mapping:
 *   voucher_id  → extracted tx_ref (our ID echoed back by Flutterwave)
 *   event_type  → 'WEBHOOK_RECEIVED' (constant sentinel value)
 *   payload     → full raw JSON string of the Flutterwave event
 */
async function writeTransactionEvent(
  supabase: ReturnType<typeof getAdminClient>,
  voucherId: string,
  rawBody: string,
): Promise<void> {
  const { data: ledgerRow, error: ledgerError } = await supabase
    .from("transaction_events")
    .insert({
      transaction_id: voucherId,
      event_type: "WEBHOOK_RECEIVED",
      payload: rawBody,
      created_at: new Date().toISOString(),
    })
    .select("id")
    .single<TransactionEventInsertResult>();

  if (ledgerError) {
    // Log the full PostgREST error for ops visibility, but do NOT propagate.
    console.error(
      `[flutterwave-webhook] LEDGER WRITE FAILED for voucher_id='${voucherId}':`,
      ledgerError.code,
      ledgerError.message,
      ledgerError.details ?? "",
    );
    return;
  }

  console.log(
    `[flutterwave-webhook] Ledger row created | transaction_event.id=${ledgerRow.id} | voucher_id=${voucherId}`,
  );
}


// ---------------------------------------------------------------------------
// Core handler
// ---------------------------------------------------------------------------

async function handleFlutterwaveWebhook(req: Request): Promise<Response> {
  console.log("[flutterwave-webhook] --- INCOMING WEBHOOK ---");

  // --- 1. Signature verification (fast-fail, before any async work) ---
  const signatureError = verifySignature(req);
  if (signatureError !== null) {
    return signatureError;
  }
  console.log("[flutterwave-webhook] Signature verified.");

  // --- 2. Read the body once ---
  let rawBody: string;
  try {
    rawBody = await req.text();
  } catch (e) {
    console.error("[flutterwave-webhook] Failed to read request body:", (e as Error).message);
    return json({ error: "Failed to read request body." }, 400);
  }

  // --- 3. Obtain the admin client (throws if env vars are missing) ---
  //
  // Moved ahead of parsing: payout-side events are routed before the
  // charge-shaped validation and need the client to do their work.
  let supabase: ReturnType<typeof getAdminClient>;
  try {
    supabase = getAdminClient();
  } catch (configError: unknown) {
    const message = configError instanceof Error ? configError.message : "Configuration error.";
    console.error(message);
    // Return 500 so Flutterwave retries — this is a transient server-side fault.
    return new Response("Server configuration error", { status: 500 });
  }

  // --- 4. Route on event type before applying charge-specific rules ---
  //
  // Charges and payouts are different shapes moving in opposite directions. A
  // charge carries tx_ref and belongs to a transaction; a payout reversal
  // carries a `reference` and belongs to a withdrawal. Validating every event
  // against the charge shape is why every non-charge event was previously
  // rejected with a 400 before any handler saw it.
  let peekedEvent = "";
  let peekedData: Record<string, unknown> = {};
  try {
    const peeked = JSON.parse(rawBody) as Record<string, unknown>;
    if (typeof peeked.event === "string") peekedEvent = peeked.event.trim();
    if (typeof peeked.data === "object" && peeked.data !== null && !Array.isArray(peeked.data)) {
      peekedData = peeked.data as Record<string, unknown>;
    }
  } catch {
    console.error("[flutterwave-webhook] Body is not valid JSON.");
    return json({ error: "Request body is not valid JSON." }, 400);
  }

  if (peekedEvent === TRANSFER_REVERSAL_EVENT) {
    return await handleTransferReversal(supabase, peekedData);
  }

  if (PAYOUT_EVENTS_RECORDED_ONLY.has(peekedEvent)) {
    // Acknowledged and logged, not acted on. `transfer.disburse` tells us
    // nothing the sweeper does not already know from its own dispatch, and
    // refund.completed moves money the other way -- a clawback against a
    // merchant who may already have been settled and may already have spent it.
    // That is an accounting design, not a webhook branch, so it is recorded
    // rather than guessed at. See the note in
    // 20260809030000_handle_transfer_reversal.sql.
    console.warn(
      `[flutterwave-webhook] '${peekedEvent}' received and acknowledged, no action taken. ` +
        `reference=${String(peekedData.reference ?? "unknown")}`,
    );
    return json({ received: true, acted: false, event: peekedEvent });
  }

  // --- 5. Charge path: validate against the charge shape ---
  let webhookEvent: FlutterwaveWebhookEvent;
  try {
    ({ event: webhookEvent } = parseAndValidateBody(rawBody));
  } catch (parseError: unknown) {
    const message = parseError instanceof Error ? parseError.message : "Payload parse error.";
    console.error("[flutterwave-webhook] Body validation failed:", message);
    // 400 here: the request is authenticated but malformed. Flutterwave will
    // not retry 4xx responses, which is correct — retrying a malformed body
    // will never succeed.
    return json({ error: message }, 400);
  }

  const { event: eventType, data } = webhookEvent;
  const txRefStr = data.tx_ref.trim();

  // Extract actual transaction ID (stripping any timestamp suffix)
  const actualTransactionId = txRefStr.split('_')[0];

  // Check if actualTransactionId is a valid UUID
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(actualTransactionId);
  let resolvedTransactionId = actualTransactionId;

  if (!isUuid) {
    console.log(`[flutterwave-webhook] Non-UUID actualTransactionId detected: '${actualTransactionId}' (tx_ref: '${txRefStr}'). Resolving via gateway_tx_ref...`);
    const { data: txnRow, error: txnErr } = await supabase
      .from("transactions")
      .select("transaction_id")
      .eq("gateway_tx_ref", txRefStr)
      .single();

    if (txnErr || !txnRow) {
      console.error(`[flutterwave-webhook] Could not resolve transaction UUID for reference '${txRefStr}':`, txnErr?.message);
      return json({ error: `Unresolvable transaction reference: ${txRefStr}` }, 400);
    }
    
    resolvedTransactionId = txnRow.transaction_id;
    console.log(`[flutterwave-webhook] Successfully resolved reference '${txRefStr}' to transaction ID '${resolvedTransactionId}'`);
  }

  console.log(
    `[flutterwave-webhook] Event received | event=${eventType} | tx_ref=${txRefStr} | resolved_tx_id=${resolvedTransactionId} | status=${data.status}`,
  );

  // --- 4. Immutable ledger write (always, regardless of event type or status) ---
  //
  // We write the audit event FIRST so that even if subsequent logic fails,
  // we have a permanent record that this webhook was received and authenticated.
  await writeTransactionEvent(supabase, resolvedTransactionId, rawBody);

  // --- 5. Conditional business logic — only for successful charge completions ---
  if (eventType === CHARGE_COMPLETED_EVENT && data.status === SUCCESSFUL_STATUS) {
    console.log(
      `[flutterwave-webhook] Successful charge detected | transaction_id=${resolvedTransactionId} | flw_txn_id=${data.id}`,
    );

    const idempotencyKey = `${resolvedTransactionId}:${data.id}`;
    const { data: confirmResult, error: confirmError } = await supabase.rpc(
      "confirm_payment_atomic",
      {
        p_transaction_id: resolvedTransactionId,
        p_paid_amount: Math.round(data.amount * 100), // Convert ZMW from Flutterwave to ngwee for DB validation
        p_paid_currency: data.currency,
        p_payload: rawBody,
        p_idempotency_key: idempotencyKey,
      },
    );

    if (confirmError) {
      console.warn(
        `[flutterwave-webhook] confirm_payment_atomic failed for '${resolvedTransactionId}':`,
        confirmError.message,
      );
    } else {
      console.log(
        `[flutterwave-webhook] Payment confirmed | transaction_id=${resolvedTransactionId} | result=${JSON.stringify(confirmResult)}`,
      );

      // Trigger recipient WhatsApp notifications via an IIFE in the background so webhook doesn't block
      (async () => {
        try {
          console.log(`[flutterwave-webhook] Fetching details for notifications | transaction_id=${resolvedTransactionId}`);
          
          // 1. Fetch the sender's (buyer) name from the transactions relationship
          const { data: txnData, error: txnErr } = await supabase
            .from("transactions")
            .select("buyer:buyer_id (name)")
            .eq("transaction_id", resolvedTransactionId)
            .single();

          if (txnErr) {
            console.error(`[flutterwave-webhook] Failed to fetch sender name for transaction:`, txnErr.message);
          }

          const senderName = (txnData as any)?.buyer?.name || "A friend";

          // 2. Fetch all shop orders associated with this transaction
          const { data: bundles, error: bundlesErr } = await supabase
            .from("shop_orders")
            .select("shop_order_id, claim_code, recipient_name, recipient_phone, shop:shop_id (name)")
            .eq("transaction_id", resolvedTransactionId);

          if (bundlesErr) {
            console.error(`[flutterwave-webhook] Failed to fetch bundles for transaction:`, bundlesErr.message);
            return;
          }

          if (bundles && bundles.length > 0) {
            console.log(`[flutterwave-webhook] Found ${bundles.length} bundle(s) to notify.`);
            for (const bundle of bundles) {
              const shopObj = Array.isArray(bundle.shop) ? bundle.shop[0] : bundle.shop;
              const shopName = (shopObj as any)?.name || "KithLy Partner Shop";
              console.log(
                `[flutterwave-webhook] Dispatching notification invocation | claim_code=${bundle.claim_code} | recipient=${bundle.recipient_name}`
              );

              console.log(`[WEBHOOK] Attempting to invoke send-notification for bundle: ${bundle.shop_order_id}`);

              // Invoke send-notification internally via Supabase functions client
              supabase.functions.invoke("send-notification", {
                body: {
                  recipient_name: bundle.recipient_name,
                  recipient_phone: bundle.recipient_phone,
                  sender_name: senderName,
                  shop_name: shopName,
                  claim_code: bundle.claim_code,
                },
              }).then(({ data, error: invokeErr }) => {
                if (invokeErr) {
                  console.error(
                    `[WEBHOOK] Failed to invoke send-notification:`,
                    invokeErr
                  );
                } else {
                  console.log(
                    `[WEBHOOK] Successfully invoked send-notification for bundle: ${bundle.shop_order_id}`
                  );
                  console.log(
                    `[flutterwave-webhook] Notification Edge Function successfully executed for claim_code=${bundle.claim_code}:`,
                    data
                  );
                }
              }).catch((error) => {
                console.error(`[WEBHOOK] Failed to invoke send-notification:`, error);
              });
            }
          } else {
            console.log(`[flutterwave-webhook] No bundles found for transaction.`);
          }
        } catch (notifErr: unknown) {
          const errMsg = notifErr instanceof Error ? notifErr.message : String(notifErr);
          console.error(`[flutterwave-webhook] Notification background processing exception:`, errMsg);
        }
      })();
    }
  } else {
    // Non-successful or non-charge events: ledger row is already written above.
    // Log for observability but take no further action.
    console.log(
      `[flutterwave-webhook] Non-actionable event | event=${eventType} | status=${data.status} | voucher_id=${resolvedTransactionId}. ` +
        "Ledger written. No state change applied.",
    );
  }

  // --- 6. Respond 200 OK immediately ---
  //
  // Flutterwave marks a webhook delivery as "failed" if it does not receive
  // a 2xx response within their timeout window and will retry up to 5 times.
  // We must always return 200 after the DB writes are committed, regardless
  // of whether the voucher update succeeded, to prevent duplicate ledger rows
  // from accumulating on retries.
  console.log("[flutterwave-webhook] Processing complete. Returning 200 OK.");
  return json({ received: true }, 200);
}

// ---------------------------------------------------------------------------
// Deno.serve entry-point
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request): Promise<Response> => {
  // Flutterwave sends POST requests only. We reject everything else.
  // Note: no CORS preflight handling needed — this is a server-to-server endpoint.
  if (req.method !== "POST") {
    console.warn(`[flutterwave-webhook] Unexpected method: ${req.method}`);
    return new Response(`Method '${req.method}' not allowed.`, { status: 405 });
  }

  try {
    return await handleFlutterwaveWebhook(req);
  } catch (unhandled: unknown) {
    // This catch block should be unreachable under normal conditions.
    // All expected error paths are handled inside `handleFlutterwaveWebhook`.
    // If we land here it indicates a genuine programming error or an OOM/timeout
    // condition — log everything and return 500 so Flutterwave retries.
    const message = unhandled instanceof Error ? unhandled.message : String(unhandled);
    console.error("[flutterwave-webhook] UNHANDLED EXCEPTION:", message);
    return new Response("Internal server error", { status: 500 });
  }
});
