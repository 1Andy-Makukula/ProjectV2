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
async function parseAndValidateBody(
  req: Request,
): Promise<{ rawBody: string; event: FlutterwaveWebhookEvent }> {
  let rawBody: string;
  try {
    rawBody = await req.text();
  } catch (e) {
    throw new Error(`Failed to read request body: ${(e as Error).message}`);
  }

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
      voucher_id: voucherId,
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
// Step 4 — Voucher payout_status promotion
// ---------------------------------------------------------------------------

/**
 * Promotes the `payout_status` of the matched `claim_vouchers` row from
 * `'UNFUNDED'` to `'PENDING_BATCH'` to indicate that funds have arrived
 * and the voucher is now eligible for the next settlement batch.
 *
 * Critical invariants enforced here:
 *
 *  1. We filter on `payout_status = 'UNFUNDED'` in the WHERE clause.
 *     This makes the update idempotent — if Flutterwave retries the
 *     webhook and the row has already been promoted, the UPDATE matches
 *     zero rows rather than regressing the status back.
 *
 *  2. We deliberately do NOT touch `claim_status`. That column tracks the
 *     in-store redemption lifecycle and is owned exclusively by the
 *     merchant fulfillment flow. Its value remains `'PENDING'`.
 *
 *  3. We record `funded_at` so the batch settlement job has a precise
 *     timestamp for cut-off window calculations.
 *
 * @returns `true` when a row was updated; `false` when no matching row was
 *          found (which may indicate a duplicate/late webhook or a lookup error).
 */
async function promoteVoucherPayoutStatus(
  supabase: ReturnType<typeof getAdminClient>,
  voucherId: string,
  flutterwaveTransactionId: number,
  flwRef: string,
): Promise<boolean> {
  const { data: updatedRows, error: updateError } = await supabase
    .from("claim_vouchers")
    .update({
      payout_status: "PENDING_BATCH",
      flutterwave_transaction_id: flutterwaveTransactionId.toString(),
      flw_ref: flwRef,
      funded_at: new Date().toISOString(),
    })
    .eq("voucher_id", voucherId)
    // Idempotency guard: only update rows that are still in the UNFUNDED state.
    // If this webhook fires twice, the second UPDATE matches 0 rows — safe.
    .eq("payout_status", "UNFUNDED")
    .select("voucher_id");

  if (updateError) {
    console.error(
      `[flutterwave-webhook] Voucher payout_status update FAILED for voucher_id='${voucherId}':`,
      updateError.code,
      updateError.message,
      updateError.details ?? "",
    );
    // Return false to signal that the caller should log a warning, but we
    // still respond 200 to Flutterwave because the ledger row was already written.
    return false;
  }

  const rowsAffected = updatedRows?.length ?? 0;

  if (rowsAffected === 0) {
    // Either the voucher doesn't exist, it was already promoted (idempotent
    // retry), or it was in an unexpected state. All cases are non-fatal.
    console.warn(
      `[flutterwave-webhook] No rows updated for voucher_id='${voucherId}'. ` +
        "The voucher may not exist, may have already been funded, or may be in an unexpected state.",
    );
    return false;
  }

  console.log(
    `[flutterwave-webhook] Voucher promoted | voucher_id=${voucherId} | payout_status: UNFUNDED → PENDING_BATCH | flw_txn_id=${flutterwaveTransactionId}`,
  );
  return true;
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

  // --- 2. Parse and structurally validate the body ---
  let rawBody: string;
  let webhookEvent: FlutterwaveWebhookEvent;
  try {
    ({ rawBody, event: webhookEvent } = await parseAndValidateBody(req));
  } catch (parseError: unknown) {
    const message = parseError instanceof Error ? parseError.message : "Payload parse error.";
    console.error("[flutterwave-webhook] Body validation failed:", message);
    // 400 here: the request is authenticated but malformed. Flutterwave will
    // not retry 4xx responses, which is correct — retrying a malformed body
    // will never succeed.
    return json({ error: message }, 400);
  }

  const { event: eventType, data } = webhookEvent;
  const voucherId = data.tx_ref.trim();

  console.log(
    `[flutterwave-webhook] Event received | event=${eventType} | tx_ref=${voucherId} | status=${data.status}`,
  );

  // --- 3. Obtain the admin client (throws if env vars are missing) ---
  let supabase: ReturnType<typeof getAdminClient>;
  try {
    supabase = getAdminClient();
  } catch (configError: unknown) {
    const message = configError instanceof Error ? configError.message : "Configuration error.";
    console.error(message);
    // Return 500 so Flutterwave retries — this is a transient server-side fault.
    return new Response("Server configuration error", { status: 500 });
  }

  // --- 4. Immutable ledger write (always, regardless of event type or status) ---
  //
  // We write the audit event FIRST so that even if subsequent logic fails,
  // we have a permanent record that this webhook was received and authenticated.
  await writeTransactionEvent(supabase, voucherId, rawBody);

  // --- 5. Conditional business logic — only for successful charge completions ---
  if (eventType === CHARGE_COMPLETED_EVENT && data.status === SUCCESSFUL_STATUS) {
    console.log(
      `[flutterwave-webhook] Successful charge detected | voucher_id=${voucherId} | flw_txn_id=${data.id}`,
    );

    const promoted = await promoteVoucherPayoutStatus(
      supabase,
      voucherId,
      data.id,
      data.flw_ref,
    );

    if (!promoted) {
      // Log at WARN level. The ledger row is already committed. We still
      // respond 200 so Flutterwave does not retry — retrying would only
      // write a duplicate ledger row (which would reveal the issue) and
      // attempt the same no-op UPDATE again. This is the correct trade-off.
      console.warn(
        `[flutterwave-webhook] Voucher '${voucherId}' payout_status was NOT updated (see above). ` +
          "Ledger row is committed. Returning 200 to suppress retries.",
      );
    }
  } else {
    // Non-successful or non-charge events: ledger row is already written above.
    // Log for observability but take no further action.
    console.log(
      `[flutterwave-webhook] Non-actionable event | event=${eventType} | status=${data.status} | voucher_id=${voucherId}. ` +
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
