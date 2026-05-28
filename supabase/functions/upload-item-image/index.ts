import { createClient } from "jsr:@supabase/supabase-js@2.49.8";
import { getCorsHeaders } from "../_shared/cors.ts";

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const BUCKET = "storefront-assets";

function json(req: Request, data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
  });
}

function getAdminClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("Missing Supabase configuration.");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function extensionForMime(mime: string): string {
  switch (mime) {
    case "image/jpeg": return "jpg";
    case "image/png": return "png";
    case "image/webp": return "webp";
    case "image/gif": return "gif";
    default: return "bin";
  }
}

async function verifyUploader(
  req: Request,
  shopId: string,
  db: ReturnType<typeof getAdminClient>,
): Promise<{ userId: string } | Response> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return json(req, { error: "Unauthorized" }, 401);
  }

  const { data: { user }, error } = await db.auth.getUser(authHeader.split(" ")[1]);
  if (error || !user) {
    return json(req, { error: "Unauthorized" }, 401);
  }

  const { data: profile } = await db.from("users").select("role").eq("id", user.id).single();
  if (profile?.role === "admin") {
    return { userId: user.id };
  }

  if (profile?.role === "merchant") {
    const { data: assignment } = await db
      .from("merchant_shops")
      .select("shop_id")
      .eq("user_id", user.id)
      .eq("shop_id", shopId)
      .maybeSingle();
    if (assignment) return { userId: user.id };
  }

  return json(req, { error: "Forbidden" }, 403);
}

async function handleUpload(req: Request): Promise<Response> {
  const form = await req.formData();
  const file = form.get("file");
  const shopId = String(form.get("shop_id") ?? "").trim();

  if (!(file instanceof File)) {
    return json(req, { error: "file is required" }, 400);
  }
  if (!shopId) {
    return json(req, { error: "shop_id is required" }, 400);
  }
  if (file.size > MAX_BYTES) {
    return json(req, { error: "Image must be 5 MB or smaller" }, 400);
  }
  if (!ALLOWED_MIME.has(file.type)) {
    return json(req, { error: "Invalid image type" }, 400);
  }

  const db = getAdminClient();
  const authResult = await verifyUploader(req, shopId, db);
  if (authResult instanceof Response) return authResult;

  const bytes = new Uint8Array(await file.arrayBuffer());
  const ext = extensionForMime(file.type);
  const path = `products/${crypto.randomUUID()}.${ext}`;

  const { error: uploadError } = await db.storage.from(BUCKET).upload(path, bytes, {
    contentType: file.type,
    upsert: false,
  });

  if (uploadError) {
    console.error("[upload-item-image] Storage error:", uploadError.message);
    return json(req, { error: "Upload failed" }, 500);
  }

  const { data: { publicUrl } } = db.storage.from(BUCKET).getPublicUrl(path);
  return json(req, { success: true, publicUrl, path });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: getCorsHeaders(req) });
  }
  if (req.method !== "POST") {
    return json(req, { error: "Method not allowed" }, 405);
  }
  try {
    return await handleUpload(req);
  } catch (e) {
    console.error("[upload-item-image]", e);
    return json(req, { error: "Internal server error" }, 500);
  }
});
