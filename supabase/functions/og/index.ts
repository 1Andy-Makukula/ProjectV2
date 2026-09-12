/**
 * og
 *
 * Link previews for everything KithLy shares.
 *
 * The app is a Vite SPA: one `index.html`, every route rewritten to it, and all
 * page content assembled by React at runtime. Facebook's and WhatsApp's
 * crawlers do not execute JavaScript, so they see only what the server hands
 * over — which is why gift, list and shop links have been arriving in WhatsApp
 * as bare blue URLs. `index.html` now carries a generic fallback card. This
 * function is the per-route layer above it: it looks the subject up and
 * describes it.
 *
 * It lives here rather than in a Vercel function because the repo ships two
 * front ends — `vercel.json` and `Dockerfile`/`nginx.conf` — and an Edge
 * Function works identically behind either one. See `docs/og-previews.md` for
 * the proxy rule each needs.
 *
 * ── Three decisions worth not re-litigating ──────────────────────────────────
 *
 * 1. IT READS WITH THE ANON KEY, NEVER THE SERVICE ROLE.
 *    `_shared/auth.ts` exists and exports `createAdminClient`; this function
 *    deliberately does not use it. Reading as `anon` means RLS is the visibility
 *    rule and this function holds none of its own: `shops_public_read` hides
 *    inactive shops, `items_public_read` hides unavailable items, and
 *    `can_view_list` hides private lists. A private subject simply returns no
 *    row and falls through to the generic card. A service-role client here
 *    would be a permanent, unauthenticated read hole in front of every table.
 *
 * 2. GIFT LINKS GET A GENERIC CARD, AND ARE NEVER LOOKED UP.
 *    The decision block at the top of `src/utils/whatsapp.ts` (2026-08-09)
 *    establishes the claim code as a BEARER INSTRUMENT — whoever holds the link
 *    collects the gift — and warns that anything fetched by that page receives
 *    the URL, and therefore the code. Two consequences here:
 *
 *      - A per-gift GENERATED `og:image` would hand the claim code to Meta's
 *        image fetcher inside a URL. The static brand mark is fine and is what
 *        the gift card uses — it carries no code and is the same file every
 *        other card falls back to.
 *      - A lookup would make this endpoint an ENUMERATION ORACLE: a valid code
 *        returns a rich card and an invalid one returns the generic card, which
 *        is a free validity check against 8-character codes that the same block
 *        flags as "thin against a machine enumerating". So there is no lookup
 *        at all — `/gift/*` never touches the database.
 *
 *    The card says a gift is waiting and nothing else. That is also the better
 *    product card, because gift links get forwarded into group chats.
 *
 * 3. HUMANS SHOULD NEVER REACH THIS FUNCTION.
 *    The proxy rules in the doc route only crawler user agents here, so a
 *    person clicking a shared link goes straight to the SPA with no redirect
 *    and no flash. The user-agent check below is the belt-and-braces half: if a
 *    person does land here, they are sent on to the real page rather than shown
 *    a scraper's stub.
 */

import { createClient } from "jsr:@supabase/supabase-js@2.49.8";

const SITE_NAME = "KithLy";

/**
 * The fallback card, kept identical to the static tags in `index.html`.
 *
 * The words are the product's own, lifted from the Discover and Gifting modes
 * in `storefrontModes.ts`, so the preview card and the storefront say the same
 * thing. If these change, change them in both places.
 */
const DEFAULT_TITLE = "KithLy — send something that means something";
const DEFAULT_DESCRIPTION =
  "Gifts, experiences and services from shops across Zambia. Chosen by you, collected by them, held safely in between.";

/**
 * The brand mark, and the image behind any card whose subject has none.
 *
 * Served from the public `storefront-assets` bucket rather than the app's own
 * domain because og:image must be absolute, and this URL is the same whichever
 * front end is serving the page. Kept byte-identical to `public/og.png` and to
 * the tag in `index.html`; replacing the artwork means replacing all three.
 */
const BRAND_IMAGE =
  "https://mbjbrdhpjgfhhycijodz.supabase.co/storage/v1/object/public/storefront-assets/brand/og.png";

/**
 * User agents that render link previews.
 *
 * Matching is deliberately generous: a crawler wrongly treated as a person gets
 * redirected and the preview silently fails, which is the failure we are here
 * to fix. A person wrongly treated as a crawler sees a stub page with a working
 * link — recoverable, and vanishingly rare behind the proxy rules.
 */
const CRAWLER_PATTERN =
  /facebookexternalhit|facebookcatalog|WhatsApp|Twitterbot|LinkedInBot|Slackbot|TelegramBot|Discordbot|Pinterest|redditbot|Googlebot|bingbot|Applebot|SkypeUriPreview|vkShare|embedly|Iframely|Bluesky|Mastodon|Google-InspectionTool/i;

/** Meta descriptions are truncated by every consumer; do it deliberately. */
const MAX_DESCRIPTION = 200;

interface Card {
  title: string;
  description: string;
  image: string | null;
}

const DEFAULT_CARD: Card = {
  title: DEFAULT_TITLE,
  description: DEFAULT_DESCRIPTION,
  image: null,
};

/**
 * Deliberate twin of `escapeHtml` in `src/lib/html.ts` — keep them identical.
 *
 * Not an oversight and not worth de-duplicating: `supabase/functions` is Deno,
 * bundled and deployed separately from the Vite app, and cannot import from
 * `src/`. The runtime boundary forces the copy. `tests/html.test.ts` covers the
 * app-side one; this side is covered by CI's `deno check` and by the fact that
 * every interpolation in `renderHtml` goes through it.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Collapse whitespace and trim to something a preview card can show.
 *
 * Shop and item descriptions are merchant-authored free text and run long.
 */
function summarise(value: string | null | undefined, fallback: string): string {
  const text = (value ?? "").replace(/\s+/g, " ").trim();
  if (!text) return fallback;
  if (text.length <= MAX_DESCRIPTION) return text;
  return `${text.slice(0, MAX_DESCRIPTION - 1).trimEnd()}…`;
}

/**
 * Validate the path this preview is for.
 *
 * This value is attacker-controlled and is used to build the redirect target
 * for non-crawlers, so it has to be checked before it is trusted: without this,
 * `?path=//evil.example` redirects off-site and turns the function into an open
 * redirect wearing a kithly.com URL — exactly the shape a phishing link wants.
 * Absolute URLs, protocol-relative paths and backslashes are all rejected.
 */
function safePath(raw: string | null): string | null {
  if (!raw) return null;
  if (!raw.startsWith("/")) return null;
  if (raw.startsWith("//")) return null;
  if (raw.includes("\\")) return null;
  if (!/^\/[A-Za-z0-9\-._~%/]*$/.test(raw)) return null;
  return raw;
}

function isHttpUrl(value: string | null | undefined): value is string {
  if (!value) return false;
  return value.startsWith("https://") || value.startsWith("http://");
}

function anonClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !anonKey) {
    throw new Error("[og] SUPABASE_URL or SUPABASE_ANON_KEY is not configured.");
  }
  return createClient(url, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

/**
 * Describe the subject of a path.
 *
 * Every branch is allowed to find nothing. A missing, private or inactive
 * subject returns the generic card rather than an error, because a preview is
 * decoration on someone else's message: the link must still work.
 */
async function buildCard(path: string): Promise<Card> {
  const [kind, identifier] = path.split("/").filter(Boolean);
  if (!kind) return DEFAULT_CARD;

  // Decision 2 above. No lookup, no generated image, no oracle.
  if (kind === "gift") {
    return {
      title: "Someone has sent you a gift",
      description:
        "Tap to see what you have received and collect it in person. Held safely by KithLy until you do.",
      image: null,
    };
  }

  if (!identifier) return DEFAULT_CARD;

  const supabase = anonClient();

  try {
    if (kind === "shop") {
      const { data } = await supabase
        .from("shops")
        .select("name, description, logo_url, cover_image_url, image_url, location")
        .eq("id", identifier)
        .maybeSingle();
      if (!data) return DEFAULT_CARD;

      const where = data.location ? ` · ${data.location}` : "";
      return {
        title: `${data.name} on ${SITE_NAME}`,
        description: summarise(
          data.description,
          `Browse what ${data.name} has on${where}.`,
        ),
        image: [data.cover_image_url, data.image_url, data.logo_url].find(isHttpUrl) ?? null,
      };
    }

    if (kind === "item") {
      const { data } = await supabase
        .from("items")
        .select("name, description, image_url")
        .eq("id", identifier)
        .maybeSingle();
      if (!data) return DEFAULT_CARD;

      // No price. A preview card is cached by the consumer and outlives the
      // price it was built from — the same reason P3 keeps prices off post
      // cards. A stale price on a shared link is a dispute waiting to happen.
      return {
        title: `${data.name} on ${SITE_NAME}`,
        description: summarise(
          data.description,
          "Send it to someone, or collect it yourself.",
        ),
        image: isHttpUrl(data.image_url) ? data.image_url : null,
      };
    }

    if (kind === "post") {
      // The hero image is the post's own, which is the whole point of sharing
      // one. Only published posts of active shops come back — RLS again, not a
      // filter written here.
      const { data } = await supabase
        .from("posts")
        .select("caption, shop:shop_id(name), post_images(image_url, sort_order)")
        .eq("id", identifier)
        .maybeSingle();
      if (!data) return DEFAULT_CARD;

      const shop = (data.shop as { name?: string } | null)?.name ?? SITE_NAME;
      const images = (data.post_images ?? []) as { image_url: string; sort_order: number }[];
      const hero = images.slice().sort((a, b) => a.sort_order - b.sort_order)[0];

      return {
        title: `${shop} on ${SITE_NAME}`,
        description: summarise(data.caption, `See what ${shop} has on.`),
        image: isHttpUrl(hero?.image_url) ? hero.image_url : null,
      };
    }

    if (kind === "list") {
      const { data } = await supabase
        .from("lists")
        .select("title, description")
        .eq("slug", identifier)
        .maybeSingle();
      if (!data) return DEFAULT_CARD;

      return {
        title: `${data.title} — a list on ${SITE_NAME}`,
        description: summarise(
          data.description,
          "One link, many shops. Pick something from the list.",
        ),
        image: null,
      };
    }

    if (kind === "experience") {
      const { data } = await supabase
        .from("experiences")
        .select("name, tagline, description, image_url")
        .eq("slug", identifier)
        .maybeSingle();
      if (!data) return DEFAULT_CARD;

      return {
        title: `${data.name} on ${SITE_NAME}`,
        description: summarise(
          data.tagline ?? data.description,
          "Several shops, one gift, one deadline.",
        ),
        image: isHttpUrl(data.image_url) ? data.image_url : null,
      };
    }
  } catch (err) {
    // A preview is never worth failing a share over.
    console.error("[og] lookup failed", { kind, err: String(err) });
    return DEFAULT_CARD;
  }

  return DEFAULT_CARD;
}

function renderHtml(card: Card, canonical: string | null): string {
  const title = escapeHtml(card.title);
  const description = escapeHtml(card.description);
  // Every card gets an image: the subject's own, or the brand mark. A card with
  // no image at all is a noticeably weaker one, and there is always something
  // true to show.
  const imageUrl = escapeHtml(card.image ?? BRAND_IMAGE);
  const image =
    `\n  <meta property="og:image" content="${imageUrl}" />` +
    `\n  <meta name="twitter:image" content="${imageUrl}" />`;
  const url = canonical
    ? `\n  <meta property="og:url" content="${escapeHtml(canonical)}" />\n  <link rel="canonical" href="${escapeHtml(canonical)}" />`
    : "";
  // Always large: there is always an image now, per the fallback above.
  const twitterCard = "summary_large_image";
  const href = canonical ? escapeHtml(canonical) : "/";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
  <meta name="description" content="${description}" />
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="${SITE_NAME}" />
  <meta property="og:title" content="${title}" />
  <meta property="og:description" content="${description}" />
  <meta property="og:locale" content="en_ZM" />${image}${url}
  <meta name="twitter:card" content="${twitterCard}" />
  <meta name="twitter:title" content="${title}" />
  <meta name="twitter:description" content="${description}" />
</head>
<body>
  <h1>${title}</h1>
  <p>${description}</p>
  <p><a href="${href}">Continue to ${SITE_NAME}</a></p>
</body>
</html>`;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405 });
  }

  const path = safePath(new URL(req.url).searchParams.get("path"));
  const appUrl = Deno.env.get("APP_URL")?.replace(/\/+$/, "") ?? null;
  const canonical = appUrl && path ? `${appUrl}${path}` : null;

  // Decision 3 above: a person who reaches this is sent to the real page.
  const userAgent = req.headers.get("user-agent") ?? "";
  if (!CRAWLER_PATTERN.test(userAgent) && canonical) {
    return new Response(null, { status: 302, headers: { Location: canonical } });
  }

  const card = path ? await buildCard(path) : DEFAULT_CARD;

  return new Response(renderHtml(card, canonical), {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // Crawlers re-fetch on their own schedule and cache hard either way.
      // Five minutes keeps an edited shop name from being wrong for a day
      // without making every share a database read.
      "Cache-Control": "public, max-age=300, s-maxage=300",
      // The path may carry an identifier; keep it out of third-party referers.
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
