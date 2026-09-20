# Two rails and the request engine

> **Status: plan. Written 19 September 2026.** Stage 0 is built and sits on
> `feat/occasion-intent-layer`; everything from Stage 1 down is not started.
>
> This supersedes nothing. It is the first written form of the occasion-led
> pivot of 16 September and the concierge thinking of 19 September, put in one
> place so they stop being eleven separate open loops.

---

## 1. The shape, in one paragraph

A person opens the app and **declares an intent**. That intent selects one of
**two rails**. Rail 1 is the diaspora care path: curated, emotional,
occasion-led, loud about trust. Rail 2 is the local marketplace — categories,
search, granular selection, the thing already built. **Both rails end at the
same cart, the same Flutterwave collection, the same double-entry ledger, the
same claim code and the same merchant fulfilment screen.** Behind both sits a
**request engine**: when the catalogue cannot answer, a human does, and the
answer becomes an ordinary order on those same rails.

That is the whole architecture. Two doors, one building.

---

## 1a. Before anything: the migration backlog

**This is the real blocker, and it sits in front of every stage below.**

`src/types/database.types.ts` is stale relative to migrations that are already
committed. Verified absent from the generated types, while their migration files
exist on disk:

| Object | Migration | In types? |
| --- | --- | --- |
| `occasion_lead_times` table | `20260913020000_occasion_lead_times.sql` | **missing** |
| slate weights / kappa | `20260914070000_slate_weights_and_kappa.sql` | **missing** |
| `start_kithly_conversation(p_subject)` RPC | `20260916000000_buyer_concierge_conversation.sql` | **missing** |
| `experiences.occasion_kind` | `20260916010000_experience_occasion_kind.sql` | **missing** |

Plus four migrations that are not even committed yet — the three from 17 Sep and
`20260919000000_category_tile_art.sql` from today.

What can be verified from the repository is that **the types were never
regenerated**. Whether the migrations are applied in the database cannot be
checked from here. Do that first, then regenerate types, before starting Stage 1.
Per CLAUDE.md, `database.types.ts` is canonical and schema changes generate types
first — right now that contract is broken and every stage below inherits it.

**One live hazard to know about.** `EXPERIENCE_SELECT` in `useExperiences.ts` does
**not** currently request `occasion_kind`, so nothing breaks today. The moment the
occasion work restores that column to the select, the migration must already be
applied or **every experience silently disappears from the storefront** — an empty
list, not an error. Order matters: migration first, select second.

---

## 2. What already exists

This section is the point of the document. The eleven items are not eleven
features, and most of what they need is already in the repository.

| What was described | What it already is | Where |
| --- | --- | --- |
| "Smart bundles — an occasion tile routes to a predefined bundle of item_ids" | `experiences` + `experience_items`, with quantity, note and sort order per line | `src/app/hooks/useExperiences.ts` |
| Occasion tiles have art, order and a landing page | `experiences.image_url`, `.tagline`, `.sort_order`, `.is_featured`, `.slug`, route `/experience/:slug` | `src/app/routes.tsx:153` |
| "The universal cart — structurally identical data" | **Already true.** `ExperienceDetail` loops `experience_items` and calls the same `addToCart(toProduct(...), quantity)` a single product tile calls | `src/app/pages/sender/ExperienceDetail.tsx:103` |
| Admin can create the occasions | Admin experiences screen | `src/app/routes.tsx:438` |
| "A community space where they can text us" | `conversations` with `kind = 'admin_buyer'`, `messages`, `conversation_reads`, unread counts | `src/app/pages/Messages.tsx` |
| "Us as admin send a custom quotation after we look up the price in town" | **Already built end to end.** `quotations` + `quotation_line_items`, a builder, a card in the thread, accept → checkout → escrow | `QuotationBuilder.tsx`, `QuotationCard.tsx`, `useCheckout.ts:153` |
| "Put a face to it, without looking like a personal operation" | Already decided in code: an admin in a thread is **always** rendered as "KithLy", never as the person typing | `messaging.ts` → `displayNameForSender` |
| Post progress to the community, with pictures | `posts`, `post_images`, `post_items`, `post_likes`, `post_saves` | `usePosts.ts`, `PostCard.tsx` |
| Notify the community that what they asked for landed | `notifications` | existing |
| "I wish this existed" | `post_wishes`, `post_wish_audience` | `useWishes.ts` |
| Birthdays, school terms, recurring dates | `contact_occasions`, with recurrence, month, day, year | `useContacts.ts` |
| Money follows the same rails | `ledger_entries`, `kithly_wallets`, `transactions`, `payout_*`, claim codes | untouched by any of this |

**Nothing in items 6, 7, 9 or 10 needs a new payment path, a new cart, or a new
merchant screen.** They need a reason to open a thread, and an inbox to answer
it in.

### One correction to carry forward

`bundles` (name, description, image_url, total_price_zmw, `bundle_metadata`
JSON) is a **dead second primitive for the same idea** as `experiences`. It is
referenced in exactly one place, `MerchantDashboard.tsx`, and has no join table
— its line items would have to live in untyped JSON. **Build occasions on
`experiences`.** Do not extend `bundles`; retiring it is a later cleanup, not a
blocker.

---

## 3. Locked decisions

1. **Intent is declared at the door, and it is binary.** `send` | `browse`. The
   Welcome page's two doors already set this (`gifting` | `shopping`).
2. **"Send home" is the default.** An unanswered intent resolves to Rail 1, not
   to `discover`. The primary view assumes you are solving a problem for
   someone else across a distance.
3. **The six storefront modes survive, demoted.** They stop being the top-level
   fork — six equal options is what not choosing looks like — and become lenses
   *within* a rail. `gifting`, `experiences` and `lists` lean Rail 1;
   `shopping`, `services` and `discover` lean Rail 2. No mode is deleted, no
   palette changes.
4. **The toggle is persistent and visible.** Not a setting. A switch in the
   header, present on every storefront screen, that drops you into the other
   rail immediately and without losing the cart.
5. **Occasions are `experiences` rows.** No new table, no new cart path, no new
   checkout. "Monthly Essentials", "School Prep", "Birthday" are seeded rows
   with art, a tagline and lines.
6. **Requests are one feature with four faces.** Ask-for-a-product, errand,
   concierge and custom-quote are the same object in different states, not four
   builds. One thread, one quote, one order.
7. **Concierge money never leaves the escrow rails.** This is the decision that
   separates "there are real people behind this" from "some guys running it out
   of a WhatsApp group". Your face in the thread, the ledger between you and
   their kwacha. A concierge order is collected, held, claim-coded and released
   on exactly the path a shop order is.
8. **The mosaic is one component, fed two ways.** `CategoryTiles` renders
   whatever rows it is given. Rail 1 feeds it occasions; Rail 2 feeds it
   categories. This is already how it is written — it takes a list, art and a
   slug, and nothing in it knows what a category is.
9. **Nothing on the money path changes for any of this.** No edits to
   `checkout_init_atomic`, the ledger, the sweeper or the webhook idempotency
   keys. If a stage below appears to require one, the stage is wrong.

---

## 4. The one real gap

`quotations.shop_id` is **NOT NULL**. A concierge quote — where the platform
personally sources something from a shop that is not registered — has no shop to
point at.

**Do not make the column nullable.** Create a single house merchant row, a
"KithLy Concierge" shop. It costs one seeded row, and it means:

- quotations, orders, fulfilment and the merchant dashboard all keep working
  unchanged, because from their point of view this is an ordinary shop;
- the payout ledger has a real counterparty and the double entry stays balanced;
- concierge margin becomes visible as that shop's revenue instead of hiding
  inside a special case;
- every RLS policy already written continues to apply.

The alternative — a nullable `shop_id` — puts a branch in every consumer of a
quotation, including ones on the money path. That is the expensive direction.

---

## 5. Build order

Typecheck and test between stages, per CLAUDE.md. Each stage ships alone.

### Stage 0 — The front door ✅ *done, 19 Sep 2026*

Everything is a tile, including the header. Intent asked once, in words. Nine
category tiles with real art, ordered and pictured from the database. Trust copy
and a human phone number placed above the fold rather than in a footer.

- `src/app/pages/public/Welcome.tsx`, `src/app/components/shared/CategoryTiles.tsx`,
  `src/app/hooks/useCategories.ts`,
  `supabase/migrations/20260919000000_category_tile_art.sql`
- **Done when:** the migration is applied and `/welcome` shows photographs.
  *(Written, not yet applied.)*

### Stage 1 — The rail toggle

Introduce `rail: 'send' | 'browse'` as the top-level intent, **derived from** the
existing persisted `storefrontMode` so nobody's stored preference is lost. Put
the switch in the header, persistent. Default `send`.

- `useStorefrontMode.ts` (derive, do not replace), `Header.tsx`, `ModeSwitcher.tsx`
- **Done when:** the toggle survives reload, changes which rail's sections
  render, and never empties the cart.
- **Risk: 🔴 shared chrome.** Blast-radius grep `useStorefrontMode` first — it is
  read by the storefront, the perch, the switcher and the Welcome doors.

### Stage 2 — Occasions on Rail 1

Seed the first occasions as `experiences` with art and lines. Point the Welcome
mosaic and the Rail 1 storefront at `useExperiences({ featuredOnly: true })`
instead of at categories. Rail 2 keeps the category mosaic.

- new seed migration, `Welcome.tsx`, `ConsumerStorefront.tsx`
- **Done when:** Rail 1's front door shows occasions, Rail 2's shows categories,
  and both press through to the same cart.
- **Note:** this is mostly seeding. The component, the route, the detail page and
  the add-to-cart already exist, and `experiences.occasion_kind` is already
  written as a migration (`20260916010000`) — it needs applying, not authoring.
  **Blocked on content, not on code** — see §7.

### Stage 3 — Trust, stated inline

FX lock, escrow guarantee and collection alert stated *at the point of doubt* —
on the occasion detail, in the cart, above the pay button — not only on Welcome.
Reuse `CompensationDisclosure` and the `FxTemporalLock` copy. No new components.

- **Done when:** a Rail 1 user meets the escrow promise at least twice before
  paying.

### Stage 4 — Requests: the ask

An "Ask us for anything" entry on both rails that opens an `admin_buyer`
conversation with a `subject`. This is the shared front end for items 6, 7 and 9,
and it is a button plus a pre-filled thread.

- `Messages.tsx`, `useConversation.ts`
- **The SQL is already written and not wired.**
  `20260916000000_buyer_concierge_conversation.sql` defines
  `start_kithly_conversation(p_subject text)` — exactly the missing piece, since
  `start_conversation` requires a shop and `admin_start_conversation` is
  admin-only, which is why **a buyer cannot currently open a thread with KithLy
  at all**. It has no frontend caller and is absent from the generated types.
  This stage is: apply, regenerate types, add the button.
- **Done when:** a buyer can start a thread with KithLy from the storefront and
  it appears in an admin inbox.

### Stage 5 — The admin inbox

Admin-side triage for `admin_buyer` threads: unanswered first, using the existing
unread counts. The quotation builder is already there.

- `src/app/pages/admin/`
- **Done when:** a thread can be answered and quoted from one screen, without SQL.

### Stage 6 — Concierge as a shop

Seed the "KithLy Concierge" merchant per §4. Quote against it, accept, pay,
collect.

- **Done when:** a concierge order appears in the merchant dashboard, generates a
  claim code, and settles through the ordinary ledger with no special case.

### Stage 7 — Proof of errand

An errand done on the house still needs evidence. Reuse `messages` with
`message_type = 'image'`: proof is a photograph in the thread, timestamped, not a
new subsystem. An SLA in days, hours where it is simple.

- **Done when:** an errand can be closed with a photograph the buyer can see.

### Stage 8 — Community publication

The second half of item 6. Turn a resolved request into a `post`, with the
requester's identity withheld by default, and notify. The ask is private; the
delivery is public.

- **Done when:** "you asked, here it is" reaches the feed and the notifications.

---

## 6. Explicitly not in scope yet

Recorded so they stop taking up room, not because they are bad.

- **Three separate videos** (welcome / what KithLy is / the personal service).
  The page holds one film today. Splitting it is a content decision, not a build
  — the tile takes whatever it is given.
- **Video calling.** Real cost, real complexity, and a support burden that does
  not pay for itself until there is demand to answer. WhatsApp already does this
  and the number is on the front door.
- **Retiring `bundles`.** A cleanup for when nothing references it.
- **Group purchasing.** Already deferred — see `docs/adr/0002`.

### The risk, written down as a rule

"Real people behind it" and "shady guys running a scam" are the same signal.
What separates them is whether the money is visibly *not* in a person's hands.
So:

> A human may appear anywhere in the conversation. A human may never appear
> anywhere in the custody of the money.

Concretely: admins render as "KithLy" and never as a named individual (already
enforced in `displayNameForSender`); personal contact details stay on Welcome and
in threads, never on checkout, escrow, dispute, payout or receipt surfaces; and
every concierge order settles through the same ledger as every shop order. The
charter's rule that money screens are the quietest in the app is doing double
duty here — it is a trust control, not only a style.

---

## 7. Open questions

1. **Does the rail toggle survive a session, or reset to `send` each open?**
   Persisting is friendlier; resetting keeps the diaspora default meaningful on a
   shared device. Leaning persist, with `send` as the first-run default.
2. ~~What are the first five occasions?~~ **Answered — see §9.** The taxonomy
   already existed and had been forgotten. What remains is art for five tiles.
3. **What is the errand SLA in writing?** "Days, hours if simple" needs a number
   before it is a promise on a page.
4. **Concierge pricing.** Item 10 capitalises on the margin between the town
   price and the quote. Is that margin disclosed as a service fee, or carried in
   the quoted line price? Worth deciding before Stage 6 — it changes what the
   buyer sees, not only what the platform earns.

---

## 8. Image provenance

Two sources, two different licence positions. This matters at launch.

**Scaffolding art — NOT cleared for production.** The nine category
photographs and two of the occasion ones came from `scoffolding/`. Of the set
supplied there, several were rejected outright: one carried a visible iStock
watermark, and others were adverts for other companies (Indo Zambia Bank,
Hungry Lion, Infinix, Kellogg's, Jam Solar). That tells you the whole set is
scraped stock of unknown licence. Fine for development. **Replace before
launch.**

**Unsplash art — cleared.** Seven occasion photographs were sourced from
Unsplash on 20 September 2026. The Unsplash Licence permits commercial use
with no attribution and no share-alike. CC BY-SA images on Wikimedia Commons
were considered and passed over — including a genuinely apt Zambian one,
`ZCAS-U Graduation.jpg` — because share-alike is an obligation not worth
taking on for page furniture.

**The rule that governs all of it**, which cost four rejections in one
afternoon: *never put a photograph under a name it does not show.* A wrong
picture is worse than no picture, because an empty block is honest and a wrong
one is a small lie about what we carry. Rejected on inspection: a "gift
hamper" full of branded Canadian groceries, a tropical beach resort standing in
for a wedding, two European children for School Prep, and West African
ceremonial dress for a Zambian wedding.

**Every tile image is ≤ 98KB**, inside the charter's 100KB budget. There is no
`sharp`, PIL or ImageMagick on this machine; resizing and re-encoding is done
with .NET `System.Drawing` via PowerShell. Note that `/c/Windows/system32/convert`
is the Windows disk-conversion tool, **not** ImageMagick — never call it.

---

## 9. The occasion set

Two different things are called "occasion" in this codebase and conflating them
will cause trouble:

- **`contact_occasions`** — a *date attached to a person* in your address book.
  Auntie's birthday, 4 March. Private, dated, drives reminders.
- **An occasion tile** — a *shopping entry point*. "Monthly Essentials". Attached
  to nobody, not dated, buyable right now.

They share a vocabulary and are not the same object. The link between them is a
reminder that fires and lands on the matching tile.

### The thirteen kinds, as they already exist

`OCCASION_KINDS` in `src/app/types/contacts.ts` — shipped, with labels, default
recurrence and hints. Lead days from `occasion_lead_times`. **What each one buys
is not a guess: it is `kithly_reco.kind_category`, seeded by hand.**

| Kind | Recurs | Lead days | What it buys (top affinities) | Tile? |
| --- | --- | --- | --- | --- |
| `groceries` | monthly | 2, 0 | groceries ·95, fresh produce ·85, meat ·75, dairy ·75, cleaning ·60 | **yes — flagship** |
| `birthday` | annual | 14, 3, 0 | bakery & cakes ·95, snacks ·70, fragrances ·65, toys ·60 | **yes** |
| `school_fees` | once | 30, 7, 0 | school supplies ·90, childrenswear ·75, shoes ·65, bags ·60 | **yes, renamed** |
| `medical` | once | 7, 1 | pharmacy ·95, medical supplies ·85, vitamins ·70, mobility aids ·60 | **yes** |
| `new_baby` | once | 14, 3, 0 | baby clothing ·95, nappies ·85, prams ·70, toys ·60 | **yes** |
| `memorial` | annual | 7, 0 | catering ·80, fresh produce ·55, beverages ·50 | yes, quietly |
| `holiday` | annual | 21, 7, 0 | meat ·75, beverages ·75, bakery ·70, attire ·55 | yes, seasonal |
| `wedding` | once | 42, 14, 3 | kitchenware ·85, bedding ·80, appliances ·75, attire ·70 | yes |
| `graduation` | once | 21, 7, 0 | phones ·80, laptops ·75, bags ·65, watches ·60 | yes |
| `anniversary` | annual | 14, 3, 0 | jewellery ·85, catering ·70, fragrances ·70, spa ·65 | yes |
| `upkeep` | monthly | 7, 0 | cleaning ·75, tools ·70, paint ·60, repair ·55 | yes |
| `rent` → **Home** | monthly | 7, 3, 0 | appliances ·90, furniture ·88, kitchen appliances ·80, bedding ·78 *(reseeded 20 Sep)* | **yes** |
| `other` | annual | 7, 0 | — | **yes — the ask** |

### Three tiles that needed renaming

**`rent` is now "Home".** Rent is money and KithLy sends things, which is why
its original kappa had the only two entries below ·50 in the whole seed. Andy's
reframing fixes it: the tile is the appliances, furniture, bedding and
kitchenware that make a rented place liveable — what a sender actually buys when
a relative moves into an empty flat. Reseeded in
`20260920000000_home_occasion_affinity.sql` with ten categories topping out at
·90. **The reminder keeps the kind name `rent`**, because a monthly date on a
contact really is about rent and existing `contact_occasions` rows point at it.
Only the tile is renamed.

**`school_fees` is "School Prep".** Fees are money; the kappa already maps it to
school supplies, childrenswear, shoes and bags. The tile must not say "fees".

**`memorial` is "Funeral Support"**, and carries a `quiet` flag that suppresses
every loud treatment — no lift, no promo block, no countdown, no vector, no
discount. Its own lead-time rationale in SQL reads *"an early reminder of a
death is not a kindness"*; the tile inherits that.

`upkeep` survives the money test unchanged, because its kappa is goods —
cleaning supplies, tools, paint, repairs.

### All thirteen ship

Decided 20 September: the taxonomy is closed, bounded and already written, so
there is no reason to hold nine back. Thirteen tiles is more than the nine the
category mosaic is capped at, and that is fine — a closed taxonomy is an
arrangement, an open directory is a list. The span pattern closes all eight rows
at thirteen.

`other` becomes **"Something else"**, the request engine's front door in waiting:
it routes to `/support` today and to `start_kithly_conversation` at Stage 4. It
sits last, where the pattern gives a thirteenth tile the full-width band.

**Seasonal note:** `holiday` has a 21-day lead, so it needs art and a bundle by
**late November** to be any use for Christmas.


