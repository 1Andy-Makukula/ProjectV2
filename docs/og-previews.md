# Link previews (Open Graph)

How a KithLy link looks when it is pasted into WhatsApp, Facebook, or anywhere
else that renders a preview card.

## The problem this solves

KithLy is a Vite SPA. `vercel.json` rewrites every route to `/index.html` (and
`nginx.conf` does the same with `try_files`), and all page content is assembled
by React at runtime. **Facebook's and WhatsApp's crawlers do not execute
JavaScript.** They see only what the server returns, which was an `index.html`
carrying no Open Graph tags at all.

So every link the product shares — gift claims, lists, shops, items, everything
from `WhatsAppShareButton` — arrived as a bare blue URL. In a market that runs
on WhatsApp, that was the share loop failing silently.

There are two layers of fix.

## Layer 1 — the fallback card (done, no configuration)

`index.html` now carries static Open Graph and Twitter tags. Every route gets a
correct, generic KithLy card with no infrastructure at all, on both front ends.

This layer is not a stopgap; it stays. It is what routes that *should not* be
described individually fall back to, and what any crawler sees if layer 2 is
unreachable.

The card's image is the brand mark — the same lucide Gift glyph the header logo
uses, white on the brand gradient at 1200×630. It lives at `public/og.png` and
is served from the public `storefront-assets` bucket, because `og:image` must be
an absolute URL and a Storage URL is one we know at build time whichever front
end is serving the page. Replacing the artwork means replacing it in three
places: `public/og.png`, the tag in `index.html`, and `BRAND_IMAGE` in
`supabase/functions/og/index.ts`.

## Layer 2 — per-route cards (`supabase/functions/og`)

An Edge Function that looks the subject up and describes it. It lives in
Supabase rather than in a Vercel function because the repo ships two front ends
and this works identically behind either.

| Route | Card |
|---|---|
| `/shop/:id` | Shop name, description, cover/logo image |
| `/item/:id` | Item name, description, image — **no price** |
| `/post/:id` | The post's own hero image, caption, and the shop that posted it |
| `/list/:slug` | List title and description |
| `/experience/:slug` | Name and tagline |
| `/gift/:claimCode` | Generic "someone has sent you a gift" — **never looked up** |
| anything else | The fallback card |

Three properties worth knowing before changing it:

- **It reads with the anon key, never the service role.** RLS is the visibility
  rule and the function holds none of its own. A private list, an inactive shop
  or an unavailable item returns no row and falls through to the generic card.
- **Gift links are never looked up.** A claim code is a bearer instrument (see
  the decision block in `src/utils/whatsapp.ts`). A per-gift image would hand
  the code to Meta's image fetcher; a lookup would make the endpoint an
  enumeration oracle against 8-character codes. So `/gift/*` never touches the
  database.
- **No price on item cards.** Preview cards are cached by the consumer and
  outlive the price they were built from. Same reasoning that keeps prices off
  post cards in P3.

### Deploying it

```bash
supabase functions deploy og
```

It needs `APP_URL` set on the project (already used by `_shared/cors.ts`) —
this is what canonical URLs and the human redirect are built from.
`SUPABASE_URL` and `SUPABASE_ANON_KEY` are injected by the platform.

### Routing crawlers to it

Only crawler user agents should reach the function, so a person clicking a
shared link goes straight to the SPA with no redirect and no flash. The
function also checks the user agent itself and forwards anyone else on, but
that is the safety net, not the mechanism.

Replace `<project-ref>` with the real Supabase project ref in both snippets.

**Vercel** — these must come *before* the existing catch-all rewrite, which is
matched in order:

```json
{
  "rewrites": [
    {
      "source": "/:kind(shop|item|post|list|experience|gift)/:id",
      "has": [
        {
          "type": "header",
          "key": "user-agent",
          "value": ".*(facebookexternalhit|WhatsApp|Twitterbot|LinkedInBot|Slackbot|TelegramBot|Discordbot|Pinterest|redditbot|Googlebot|bingbot|Applebot|SkypeUriPreview|embedly|Iframely).*"
        }
      ],
      "destination": "https://<project-ref>.supabase.co/functions/v1/og?path=/:kind/:id"
    },
    { "source": "/(.*)", "destination": "/index.html" }
  ]
}
```

**nginx** — `map` belongs at `http` level, so it goes in the main config rather
than inside the `server` block in `nginx.conf`:

```nginx
map $http_user_agent $kithly_crawler {
    default 0;
    "~*facebookexternalhit|WhatsApp|Twitterbot|LinkedInBot|Slackbot|TelegramBot|Discordbot|Pinterest|redditbot|Googlebot|bingbot|Applebot|SkypeUriPreview|embedly|Iframely" 1;
}

location ~ ^/(shop|item|post|list|experience|gift)/ {
    if ($kithly_crawler) {
        proxy_pass https://<project-ref>.supabase.co/functions/v1/og?path=$request_uri;
    }
    try_files $uri $uri/ /index.html;
}
```

### Verifying

1. **Facebook Sharing Debugger** — <https://developers.facebook.com/tools/debug/>.
   Paste a shop URL, confirm the card. Facebook caches hard; use *Scrape Again*
   after any change.
2. **A real WhatsApp send** — to yourself, on a handset. WhatsApp's crawler is
   not Facebook's and it is the one that actually matters here.
3. **Confirm a human is unaffected** — open the same URL in a browser. You
   should land in the app with no redirect and no flash.
4. **Confirm a private list stays private** — a list with `visibility` that
   `can_view_list` rejects must produce the generic card, not its title.

## Known gaps

- **Android share-target is not shipped.** A merchant cannot yet hit Share in
  the Facebook app and send images straight into the KithLy composer, which was
  the anti-friction half of the plan. Reading an `ACTION_SEND_MULTIPLE` payload
  needs a native plugin (`send-intent` or equivalent) — Capacitor's core plugins
  do not expose it. The manifest filter is deliberately NOT added until the
  handler exists: appearing in the share sheet and then doing nothing is worse
  than not appearing at all.
- **App Links are unverified.** The deep-link intent filter is in the manifest
  with `android:autoVerify="true"`, but the host does not serve
  `/.well-known/assetlinks.json`. Links still open the app; Android may show a
  chooser first until that file exists.
- **The Vercel deploy has none of `nginx.conf`'s security headers.** CSP,
  `X-Frame-Options`, `Permissions-Policy` and `Referrer-Policy` are configured
  for the Docker/nginx path only; `vercel.json` carries just the catch-all
  rewrite. If Vercel is production, the app runs with no CSP and without the
  referrer policy that the claim-code decision in `src/utils/whatsapp.ts`
  depends on. Tracked separately from link previews, but it is the more serious
  of the two.
