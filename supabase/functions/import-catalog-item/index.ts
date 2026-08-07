import { createClient } from "jsr:@supabase/supabase-js@2.49.8";
import { getCorsHeaders } from "../_shared/cors.ts";

/**
 * Imports an admin-curated catalogue item into a shop's own catalogue.
 *
 * This exists as an Edge Function rather than a plain RPC because of the image
 * files. `import_catalog_item_to_shop` runs inside Postgres and cannot reach
 * Storage, so if the copy were done in SQL the shop's new item would end up
 * pointing at the *catalogue's* objects. Retiring a catalogue entry and purging
 * its files would then blank the picture on every shop that had imported it.
 *
 * So each object is duplicated here first, and the RPC is handed the new URLs.
 * The shop's copy is independent from that moment on.
 */

const BUCKET = "storefront-assets";
const MAX_IMAGES = 5;

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

/** Storage path from a public URL, or null when the URL is external. */
function storagePathFromUrl(url: string): string | null {
  const marker = `/public/${BUCKET}/`;
  const index = url.indexOf(marker);
  return index === -1 ? null : url.slice(index + marker.length);
}

function extensionOf(path: string): string {
  const dot = path.lastIndexOf(".");
  return dot === -1 ? "webp" : path.slice(dot + 1);
}

async function verifyCaller(
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

async function handleImport(req: Request): Promise<Response> {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return json(req, { error: "Invalid request body" }, 400);
  }

  const catalogItemId = String(body.catalog_item_id ?? "").trim();
  const shopId = String(body.shop_id ?? "").trim();
  const priceZmw = Number(body.price_zmw);

  if (!catalogItemId) return json(req, { error: "catalog_item_id is required" }, 400);
  if (!shopId) return json(req, { error: "shop_id is required" }, 400);
  if (!Number.isInteger(priceZmw) || priceZmw <= 0) {
    return json(req, { error: "price_zmw must be a positive whole number of ngwee" }, 400);
  }

  const db = getAdminClient();
  const caller = await verifyCaller(req, shopId, db);
  if (caller instanceof Response) return caller;

  const { data: sourceImages, error: imagesError } = await db
    .from("catalog_item_images")
    .select("image_url, sort_order")
    .eq("catalog_item_id", catalogItemId)
    .order("sort_order")
    .limit(MAX_IMAGES);

  if (imagesError) {
    console.error("[import-catalog-item] Image lookup failed:", imagesError.message);
    return json(req, { error: "Could not read the catalogue item's images" }, 500);
  }

  // Duplicate each file so the shop's copy is independent of the catalogue's.
  const copiedUrls: string[] = [];
  const copiedPaths: string[] = [];

  for (const image of sourceImages ?? []) {
    const sourcePath = storagePathFromUrl(image.image_url);
    if (!sourcePath) {
      // Externally hosted, so there is nothing to duplicate — reference it and
      // accept that its lifetime is not ours to manage.
      copiedUrls.push(image.image_url);
      continue;
    }

    const destination = `products/${crypto.randomUUID()}.${extensionOf(sourcePath)}`;
    const { error: copyError } = await db.storage.from(BUCKET).copy(sourcePath, destination);

    if (copyError) {
      console.error("[import-catalog-item] Storage copy failed:", copyError.message);
      // Roll back the files already duplicated so a failed import does not
      // leave paid-for storage behind.
      if (copiedPaths.length > 0) {
        await db.storage.from(BUCKET).remove(copiedPaths).catch(() => {});
      }
      return json(req, { error: "Could not copy the item's images" }, 500);
    }

    copiedPaths.push(destination);
    copiedUrls.push(db.storage.from(BUCKET).getPublicUrl(destination).data.publicUrl);
  }

  const { data: result, error: rpcError } = await db.rpc("import_catalog_item_to_shop", {
    p_catalog_item_id: catalogItemId,
    p_shop_id: shopId,
    p_actor_id: caller.userId,
    p_price_zmw: priceZmw,
    p_image_urls: copiedUrls,
  });

  if (rpcError) {
    console.error("[import-catalog-item] RPC failed:", rpcError.message);
    // The database rejected the import, so the copies are orphans.
    if (copiedPaths.length > 0) {
      await db.storage.from(BUCKET).remove(copiedPaths).catch(() => {});
    }
    return json(req, { error: rpcError.message }, 400);
  }

  console.log(
    `[import-catalog-item] Imported ${catalogItemId} into shop=${shopId} by ${caller.userId}`,
  );
  return json(req, result);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: getCorsHeaders(req) });
  }
  if (req.method !== "POST") {
    return json(req, { error: "Method not allowed" }, 405);
  }
  try {
    return await handleImport(req);
  } catch (e) {
    console.error("[import-catalog-item]", e);
    return json(req, { error: "Internal server error" }, 500);
  }
});
