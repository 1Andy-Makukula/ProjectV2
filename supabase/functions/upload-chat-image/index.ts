/**
 * upload-chat-image
 *
 * Uploads an image attachment for a chat message. `send_message` has
 * accepted `p_message_type = 'image'` with a `p_image_url` since messaging
 * shipped, and MessageBubble already renders image messages — nothing has
 * ever produced the URL to send it with.
 *
 * Files land in the PRIVATE `chat-attachments` bucket and the message stores
 * the storage path; viewers mint a short-lived signed URL. This used to write
 * to the public `storefront-assets` bucket and hand back a permanent public
 * URL -- see migration 20260903020000.
 *
 * Authorisation is conversation participancy, not shop ownership, so this is
 * a separate function from `upload-item-image` rather than a branch inside
 * it: a buyer with no shop of their own is a legitimate uploader here.
 * Reuses `conversation_role_for`, the same participancy check `send_message`
 * itself already relies on, instead of re-deriving the rule.
 */

import { getCorsHeaders, jsonWithCors } from "../_shared/cors.ts";
import { createAdminClient, authenticateCaller, type AdminClient } from "../_shared/auth.ts";

const FN = "upload-chat-image";
const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
// Private. Chat attachments are receipts, addresses and identity documents
// that buyers and merchants photograph at each other; storefront-assets is a
// PUBLIC bucket and gave every one of them a permanent unauthenticated URL.
// See migration 20260903020000.
const BUCKET = "chat-attachments";

/** How long a minted view URL stays valid. Long enough to load a thread and
 *  scroll it; short enough that a leaked URL is not a permanent handle. */
const SIGNED_URL_TTL_SECONDS = 60 * 60;

function extensionForMime(mime: string): string {
  switch (mime) {
    case "image/jpeg": return "jpg";
    case "image/png": return "png";
    case "image/webp": return "webp";
    case "image/gif": return "gif";
    default: return "bin";
  }
}

async function verifyParticipant(
  req: Request,
  conversationId: string,
  db: AdminClient,
): Promise<{ userId: string } | Response> {
  const caller = await authenticateCaller(req, db, FN);
  if (caller instanceof Response) return caller;

  const { data: role, error } = await db.rpc("conversation_role_for", {
    p_conversation_id: conversationId,
    p_user_id: caller.id,
  });

  if (error || !role) {
    return jsonWithCors(req, { error: "You are not part of this conversation." }, 403);
  }

  return { userId: caller.id };
}

async function handleUpload(req: Request): Promise<Response> {
  const form = await req.formData();
  const file = form.get("file");
  const conversationId = String(form.get("conversation_id") ?? "").trim();

  if (!(file instanceof File)) {
    return jsonWithCors(req, { error: "file is required" }, 400);
  }
  if (!conversationId) {
    return jsonWithCors(req, { error: "conversation_id is required" }, 400);
  }
  if (file.size > MAX_BYTES) {
    return jsonWithCors(req, { error: "Image must be 5 MB or smaller" }, 400);
  }
  if (!ALLOWED_MIME.has(file.type)) {
    return jsonWithCors(req, { error: "Invalid image type" }, 400);
  }

  let db: AdminClient;
  try {
    db = createAdminClient(FN);
  } catch (configError: unknown) {
    console.error(configError instanceof Error ? configError.message : configError);
    return jsonWithCors(req, { error: "Server configuration error." }, 500);
  }

  const authResult = await verifyParticipant(req, conversationId, db);
  if (authResult instanceof Response) return authResult;

  const bytes = new Uint8Array(await file.arrayBuffer());
  const ext = extensionForMime(file.type);
  // <conversation_id>/<uuid>.<ext>, not chat/<conversation_id>/...
  //
  // The storage policy authorises on the FIRST folder segment (the convention
  // shop-documents established). A constant "chat/" prefix put a literal in
  // that position and left the conversation id where no path-based policy could
  // reach it.
  const path = `${conversationId}/${crypto.randomUUID()}.${ext}`;

  const { error: uploadError } = await db.storage.from(BUCKET).upload(path, bytes, {
    contentType: file.type,
    upsert: false,
  });

  if (uploadError) {
    console.error(`[${FN}] Storage error:`, uploadError.message);
    return jsonWithCors(req, { error: "Upload failed" }, 500);
  }

  // The PATH is what gets persisted on the message; the signed URL is a view
  // grant that expires. Persisting a signed URL would be meaningless (it dies)
  // and persisting a public one is the defect being fixed.
  const { data: signed, error: signError } = await db.storage
    .from(BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);

  if (signError || !signed?.signedUrl) {
    console.error(`[${FN}] Could not sign uploaded object:`, signError?.message);
    return jsonWithCors(req, { error: "Upload succeeded but the image could not be prepared for viewing." }, 500);
  }

  return jsonWithCors(req, { success: true, signedUrl: signed.signedUrl, path });
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: getCorsHeaders(req) });
  }
  if (req.method !== "POST") {
    return jsonWithCors(req, { error: "Method not allowed" }, 405);
  }
  try {
    return await handleUpload(req);
  } catch (e) {
    console.error(`[${FN}]`, e);
    return jsonWithCors(req, { error: "Internal server error" }, 500);
  }
});
