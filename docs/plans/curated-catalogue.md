# The curated catalogue — implementation report

> **Status: for review. Written 21 September 2026.** Nothing below is built.
> Companion to `two-rails.md`, which covers the front door and the request
> engine. This covers what happens after an occasion tile is pressed.

---

## 0. Verification: multi-shop is already built

Andy's claim was that KithLy already generates a separate claim code per shop
and that multi-shop checkout is intact unless something removed it. **Verified.
It is intact.** Evidence, from the live definition of `checkout_init_atomic` in
`20260913050000_checkout_respects_reservations.sql` — the most recent of the
several migrations that redefine it:

```sql
FOR v_vendor IN SELECT * FROM jsonb_array_elements(p_vendors) LOOP
  v_shop_id    := (v_vendor->>'shop_id')::UUID;
  v_claim_code := public.gen_claim_code(8);

  INSERT INTO public.shop_orders (
    transaction_id, shop_id, claim_code, claim_status, subtotal, ...
  ) VALUES (v_transaction_id, v_shop_id, v_claim_code, ...);

  FOR i IN 0..jsonb_array_length(v_item_ids) - 1 LOOP
    INSERT INTO public.order_items (shop_order_id, item_id, allocated_price) ...
  END LOOP;
END LOOP;
```

So: **one transaction → N shop orders → one unique claim code each.**
Redemption is already per shop order (`WHERE so.claim_code = v_code`), expiry
and compensation already iterate per item carrying `v_item.claim_code`, and
`shop_orders.experience_id` exists with `p_context->>'experience_id'` read at
checkout — so a bundle spanning three shops already produces three shop orders
that all remember which bundle they came from.

**Nothing needs building for multi-shop. It needs surfacing.**

### The consequence that makes everything else simple

A KithLy-sourced bundle is **a single-shop order where the shop is KithLy**.

That is not a second model living beside the marketplace — it is the existing
multi-shop machinery with one vendor in the loop. One house shop row (see
`two-rails.md` §4) and KithLy bundles inherit claim codes, redemption,
fulfilment, payouts, disputes, expiry and every RLS policy already written.

So the two fulfilment styles coexist with no branching on the money path:

| | vendors in `p_vendors` | codes | who hands over |
| --- | --- | --- | --- |
| Shop bundle | N real shops | N | each shop, at its counter |
| KithLy bundle | 1 (the house shop) | 1 | KithLy, at the door |
| Mixed | N shops + KithLy | N+1 | both |

The mixed row is not a problem to be designed around. It falls out for free.

### Why multi-shop stays, stated properly

I argued against it on logistics and was wrong on the substance. Andy's
argument: the recipient making several small trips costs them no money, and the
effort makes the gift feel **reciprocated rather than received**. A gift that
demands nothing can read as charity; a gift that asks for an afternoon reads as
something you took part in. In a context where being visibly given to carries
status weight, that matters more than the walking does.

Design consequence: **the trips are part of the product, so they must be made to
feel organised rather than scattered.** See §6.

---

## 1. Architecture in one line

The occasion tile stops being a filter and becomes a destination: a **curated
catalogue page**, built from bundles, priced weekly, attributed per shop,
purchasable into the cart that already exists.

---

## 2. The catalogue page

### What it is

A page per occasion kind. "Monthly Essentials" is the page; the meat box, the
dry goods box and the household box are **bundles on it**, under headings.

### No new table

`experiences.occasion_kind` shipped on 20 Sep. A catalogue page is:

```
every active experience WHERE occasion_kind = <kind>, ordered by sort_order
```

`experiences` + `experience_items` already reference items rather than copying
them, carry quantity/note/sort order, derive a total at read time, and resolve
into the ordinary cart via `ExperienceDetail`. Route `/experience/:slug` and an
admin screen both exist.

**Deliberately NOT recursive.** Bundles do not contain bundles. The page is the
grouping. Recursion would make pricing, stock and partial availability
recursive problems for no gain.

### The tile/manifest rule

A bundle is a product and a list at the same time. The tile sells the outcome
("A month of essentials — K1,240"); one press reveals the manifest, line by
line, with the shop on each line. **Never require opening the manifest to
understand the price.**

- New: `/catalogue/:kind`
- Reuses: `useExperiences`, `ExperienceCard`, `ExperienceDetail`, `TileMosaic`
- **Blast radius 🟢** — new route, existing hooks.

---

## 3. Shop relationship tiers and the disclosure

Three states, and they need a column:

| tier | meaning | line reads |
| --- | --- | --- |
| `partner` | registered, on platform | the shop's name |
| `arranged` | not registered, we have spoken to them | "sourced from X" |
| `sourced` | not registered, no relationship | "we buy this for you at X" |

New: `shops.relationship_tier`, defaulting to `partner` so every existing shop
is unchanged.

### Disclosure rules, to avoid fatigue

Fatigue is the main risk and repeated disclosure is how you get it — people
learn to skip the badge, and then you have paid the cost and lost the benefit.

1. **Page level, once.** One quiet sentence at the top stating the default.
2. **Line level, only on exception.** A badge only where the line differs from
   the page default.
3. **Full text at the point of commitment** — bundle detail, and the cart line.
   Not on every impression.

### Wording

Frame as service, not apology:

> **KithLy Bundle** — we buy this for you at these shops, at this week's
> prices, and send you the receipt.

Never imply partnership for a `sourced` shop. Reporting a shop's public prices
is factual; "our partners" is not. This copy is load-bearing and should not be
edited casually.

- **Blast radius 🟡** — `shops` gains a column; ShopCard, the catalogue page and
  the cart line render it.

---

## 4. The price lock

The commercial promise: a bundle's price is set weekly and held for that week.
If the shop price rises, KithLy absorbs it. If it falls, the price falls.

### Schema

```
experience_items.locked_price_zmw   integer  -- ngwee, per the unit correction
experience_items.priced_at          timestamptz
experiences.price_valid_until       date
```

`locked_price_zmw` is what the buyer pays and what the basket totals from — the
live `items.price_zmw` becomes reference only for a bundle line.

⚠️ **Prices are ngwee.** `20260917020000_ngwee_unit_correction` exists because
that assumption was got wrong once already and put the ledger 100× out.

### UI

One line, at the top of every bundle:

> **Priced 21 Sep · held until 28 Sep.** If prices rise this week, we cover it.

Specific, checkable, falsifiable. That is what makes it believable.

### Commercial guard rails (decisions, not code)

- A buffer sized to **weekly volatility**, not to average price.
- A re-quote trigger if the basket moves more than X% inside a week.
- Weekly may be too slow for meat and vegetables specifically.

- **Blast radius 🔴** — this is money. `locked_price_zmw` must flow through
  `checkout_init_atomic`'s price map, which already exists precisely so "a line
  can never be billed at a different rate than the one the basket total was
  built from."

---

## 4a. Locked commercial decisions (21 Sep)

**Buffer 5%. Absorption ceiling 20%. SLA 3 days. Repeat-request tagging.**

### The buffer and the ceiling

KithLy bundle prices carry a **5% markup buffer** over the sourced cost, to
absorb ordinary weekly drift. If a supplier price moves more than **20%**, the
published lock is **voided and re-quoted** rather than absorbed.

**Worst-case exposure, stated plainly:** a 20% spike against a 5% buffer is a
**15% loss on that basket's cost**. On a K1,000 basket that is K150 out of
pocket. Survivable as an exception; not survivable as a pattern. The 5% should
be re-sized against observed volatility once there is a month of price-run
data behind it, rather than left at 5% because it was the first number chosen.

### Two rules that must not be conflated in code

1. **The published price may be voided.** It is forward-looking, it governs
   what a new buyer is offered, and the weekly run is what detects the breach.
2. **An accepted order may NEVER be re-priced.** Once money is in escrow the
   price is final, whatever the supplier does afterwards. Voiding a lock can
   only ever affect purchases not yet made.

If those two are implemented as one mechanism, the system will eventually try
to re-quote an order it has already been paid for, and the entire promise the
product is built on collapses in a single incident.

### The ceiling applies to the basket, not to a line

A 25% jump on salt must not void a grocery bundle where salt is 2% of the
total. **Evaluate the threshold on the basket's weighted total**, not on any
single item, or the most volatile cheap line in the bundle controls
everything.

### Detection has a blind spot, and it is accepted

A breach is only visible at the weekly price run, or at the moment of actually
buying. Between runs, a spike is absorbed whether it exceeds 20% or not —
because by then the order is usually already paid, and rule 2 applies. The
void therefore protects the *published shelf*, not an individual basket in
flight. Closing that gap would need a spot-check at fulfilment, which is
deferred.

### Service level

**Three days**, displayed explicitly in the request UI. Two wording rules:

- It is three days to a **quote**, not to delivery. The copy must not be
  readable as a delivery promise.
- State whether it is working days or calendar days. In Zambia, Sunday is a
  real difference.

A stated SLA with no internal consequence is decoration — an alert at day two
is the minimum that makes it real.

### Repeat-request tagging

An admin tags each bespoke request (`iphone-11`, `school-shoes`). When a tag
crosses a threshold, KithLy is prompted either to promote it into a standard
bundle or to onboard the shop that supplies it. This is the flywheel in §R5:
requests are the research pipeline for the catalogue.

**The admin interface is deferred to the end of the sequence. The data capture
is NOT.** Tagging must start the day requests go live, or the counter is built
on months of untagged history and answers nothing. Capture first, analyse
later.

`conversations` has no tag column, so this needs either one column or a small
`request_tags` join table. Decide when step 3 lands, not at the end.

---

## 5. The weekly repricing screen

**The highest-leverage build in this report, and the least glamorous.**

If bundles carry weekly-locked prices across dozens of items from several
shops, somebody does a price run every week forever. If that is a spreadsheet
and manual SQL, the model dies of tiredness inside two months — not because it
is wrong, but because nobody wants to do it on a Sunday.

Needs:

- every tracked item, its shop, its last-priced date, its current price
- a new-price field per row, defaulting to current
- **one "publish this week" action** stamping `priced_at` and
  `price_valid_until` together
- a **staleness warning** where an item is past its window, because a stale
  price is a live financial promise nobody remembers making
- the previous week's prices visible alongside, so a fat-fingered 10× is
  obvious before publishing

- New: `/admin/repricing`
- **Blast radius 🟡** admin-only, but it writes prices — so it needs a
  confirmation step and an audit row in `admin_action_log`.

---

## 6. Multi-shop collection, made to feel organised

Multi-shop is kept. The work is presentation.

The recipient gets N codes. Today nothing presents them as one errand.

- **The gift page** (`/gift/:claimCode`) is per code. It needs a sibling view:
  *"Three collections for this gift"*, each with shop name, area, opening hours
  and its own code, and each ticking off as it is scanned.
- **Order status** shows per-shop progress, not one blended bar.
- **Order of collection** should be suggested, not alphabetical — group by area
  so the trips make geographic sense.

This is also where **proximity** genuinely matters, and where the gap is real:
`shops.location` is free text and there is no lat/lng anywhere. So today the
honest version is "group and label by area name." Distance sorting needs a
schema change and is **deferred**.

- **Blast radius 🟡** — new view over existing data. No money path.

---

## 7. Wholesalers

Non-negotiable, and partly supported already: `is_wholesale`,
`wholesale_price_zmw`, `minimum_order_quantity` and `item_price_tiers` all
exist, and the cart already shows a next-tier upsell.

**The gap is unit of sale.** A wholesaler sells cases. If a tile says K85 and
that is a case of twelve, you get abandoned carts and a confused recipient.

- New: `items.unit_of_sale` (text: "each", "case of 12", "25kg bag")
- **Surface unit and minimum order ON THE TILE**, before the press, not in the
  detail after it.

- **Blast radius 🟡** — additive column, rendered on the tile and the cart line.

---

## 8. The two doors become tabs

**Copy.** The current pair both contain the word "browse", so a scanning reader
learns nothing from the difference. The real distinction is *who it is for*:

- **Send home** — "For someone in Zambia. Browse first if you like."
- **Shop for myself** — "You're here, buying for you."

**Behaviour.** Make them real tabs that re-filter the occasion mosaic beneath
them, rather than buttons that navigate. Tabs that leave the page are a small
lie. Filtering in place also answers the intent question without a page load.

**Motion.** The sideways wave already exists: `kl-pulse` in theme.css — *"the
light crossing a surface while the page is still, right to left, slowly, easing
at both ends"* — with `.kl-pulse-text` and `.kl-pulse-rim` variants, already
silenced under `prefers-reduced-motion`. Apply it; do not rebuild it.

**Colour.** Two equally loud orange tabs means neither is primary. One filled,
one outlined — or both on ink with the pulse carrying the warmth.

- **Blast radius 🟡** — Welcome.tsx and the mosaic's data source.

---

## 9. Browse, and the item modal

**Most of the modal exists.** `ItemQuickView` is 278 lines with a gallery,
thumbnails, skeletons and six conditional facts. Missing:

- **"See more in this category"** — trivial now that `?category=` exists
- **Finger-swipe** on the gallery — `useScreenSwipe` already exists and can be
  reused
- **The hint**: show once per session, kill on first interaction, arrows on
  pointer devices, nothing under reduced motion. A hint that returns every time
  becomes furniture.

**Long-press: dropped permanently.** Undiscoverable, collides with the iOS
context menu and Android text selection, has no desktop equivalent, and is slow
by design on a surface people scan fast. Click-to-modal is the better primary,
not the fallback.

**Categories: use the rail, not a sidebar.** The storefront already runs two
rails above 1280px and the left one is "the platform talking". A category
sidebar competes for the same space. The original charter already specifies the
answer and it was never built: a 42px horizontal chip rail under the mode rail,
"All N →" pinned right.

- **Blast radius 🟡** — ItemQuickView, and new chrome on the storefront.

---

## 10. PostBuySheet — diagnosed

Three complaints, two with confirmed causes.

**The bottom buttons cannot be pressed.** Not lag — layout:

```jsx
<SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto">
```

Everything is in one scroll container including the actions, with **no fixed
footer and no safe-area padding**. The buttons scroll off, and on a phone they
land under the home indicator.

**It is flat.** The shared `bottom` variant is `inset-x-0 bottom-0 h-auto
border-t` — flush, square, hairline on top.

**The fix already exists in this repo.** `CartSlider` is built correctly:
`SheetHeader` fixed, `flex-1 overflow-y-auto` as the only scrolling region, and
`SheetFooter` with `paddingBottom: calc(env(safe-area-inset-bottom) + 1rem)`.
Port that structure.

For the curved, lifted sheet: **add a variant, do not mutate `bottom`** — other
sheets use it.

Unconfirmed and needing a repro rather than a guess: the horizontal scroll (no
`overflow-x` in the file; likely a child overflowing) and the lag (nothing heavy
in 166 lines; the suspect is the live price fetch re-running per quantity
change without debounce).

- **Blast radius 🟡** — `sheet.tsx` is shared. New variant only.

---

## 11. Cart, credits, and the review step

### The credits block is a migration status light, not a stray control

It is gated on `user && walletBalance > 0`, and `storedValueRetired` forces
`walletBalance` to zero — so **credits already remove themselves once stored
value is retired.** They are still visible because `escrow_mode` is still
`'dual_write'` and the cutover has not happened.

**Do not delete the UI.** Finish the cutover, the affordance disappears by
itself, then remove the dead code. Deleting it first hides the only visible
signal that the cutover is pending.

### Space

The scroll region is already correct (`flex-1 overflow-y-auto`). Room is being
eaten by header padding (`px-5 pt-5 pb-4` plus a border) and the footer stack.
Both trim cheaply. Target: three to four items visible.

### The full-screen review belongs in checkout, not over the cart

The goal is right — reviewing fifty grocery lines in a 400px panel is hostile,
and "see everything before you pay" is the correct thing to design for.

But a modal stacked on a sheet is a focus-trap and z-index hazard. What is being
described is an **order review step**: make it the first step of checkout. Full
width for free, no nesting, no stacked dismissal, and it lands exactly at the
moment of doubt. The cart's escrow line can then promise *"You'll see every item
before you pay"* — a promise checkout actually keeps.

- **Blast radius 🔴** — Checkout is a money surface. Presentation only; no
  change to `checkout_init_atomic`.

---

## 12. Schema summary

| Change | Table | Risk |
| --- | --- | --- |
| `relationship_tier` | `shops` | 🟡 additive, defaults to `partner` |
| `locked_price_zmw`, `priced_at` | `experience_items` | 🔴 money |
| `price_valid_until` | `experiences` | 🟡 |
| `unit_of_sale` | `items` | 🟡 additive |
| catalogue page | — | ✅ none, group by `occasion_kind` |
| multi-shop, claim codes | — | ✅ none, already built |
| KithLy as merchant | `shops` | ✅ one seeded row |
| lat/lng proximity | — | ⏸ deferred |

**Three additive columns and two money-path columns.** Everything else is
composition.

---

## 13. Build order (agreed 21 Sep)

| # | Step | Risk | State |
| --- | --- | --- | --- |
| 1 | **KithLy house shop** | 🟢 | ✅ done · `5df18d5` |
| 2 | **PostBuySheet structure** | 🟡 | ✅ done · `ba4e1e9` |
| 2b | **Cart chrome trimmed for scroll room** | 🟡 | ✅ done · `2c333c2` |
| 3 | **The two doors into quotations** | 🟡 | ✅ done · `f347d3a` |
| 4 | **Admin request desk + tag capture** | 🟡 | ✅ done · `69ce751` |
| 5 | **ESCROW CUTOVER** | 🔴 | ⛔ **blocked** — see below |
| 6 | **Price lock + price book** | 🟡 | ✅ done · `3997010`, `49caa6e` |
| 7 | **Catalogue page + relationship tiers** | 🟡 | ✅ done · `1a6b31e`, `7c4934f` |
| 8 | **Locked price actually charged** | 🔴 | ✅ done · `49caa6e` (without touching checkout) |
| 9 | **Multi-shop collection view** | 🟡 | ❌ not started — `/gift/:claimCode` is still one code per page |
| 10 | **Review before paying** | 🔴 | 🟡 partial · `2c333c2` — full-screen review from the CART; the checkout-step version is not built |
| 11 | **Wholesale unit of sale** | 🟡 | ✅ done · `f4fa31d` |
| 12a | **Doors as a tab pair, with the pulse** | 🟡 | ✅ done · `4ea668b` |
| 12b | **Modal swipe + "more in category"** | 🟡 | ✅ done · `2c333c2` |
| 12c | **Category chip rail on the storefront** | 🟡 | ❌ not started |

### Step 5 is blocked, and the runbook says so itself

`docs/runbooks/escrow-cutover.md` opens with:

> **Nothing in this runbook should be run until the legal opinion on the
> segregated account structure is in hand.**

It also needs four Edge Functions deployed with Airtel disbursement
credentials, and Stage 2 posts opening balances **once**, irreversibly. None
of that is inferable, so the cutover waits for an explicit decision and
should be its own session.

Consequence: **KithLy Credits stay visible in the cart.** That is correct.
The affordance is gated on `walletBalance > 0` and `storedValueRetired`
forces it to zero, so it removes itself the moment the cutover lands.
Deleting it early would hide the only visible signal that the cutover is
still pending.

### Step 8 was solved without touching the money path

The catalogue displays a locked price; `checkout_init_atomic` prices
server-side from `items.price_zmw` and ignores the client. Left alone that
would have put one number on the shelf and another through the till.

Rather than teaching the most sensitive function in the codebase a new
pricing rule, the price run now writes `items.price_zmw` as well. These are
KithLy's own items in the house shop, so **setting the item's price IS the
lock** — chosen weekly, not moved midweek. `locked_price_zmw` remains the
audit record, and `experience_price_health` compares the two so drift is
visible.

### Why the cutover sits at 5

It is the last point where the money path is still the simple, well-understood
one. Steps 2-4 are presentation and messaging and touch no money, so they are
safe either side of it. Everything from 6 onward writes prices or moves money,
and doing that against two ledgers running in `dual_write` means verifying each
one twice and reconciling differences that are artefacts of the migration
rather than bugs.

Cutting over here means **everything financial after it is built once, against
one ledger.** The longer `escrow_mode` stays at `dual_write`, the more code
accumulates on both paths.

`docs/runbooks/escrow-cutover.md` governs it. It is read and confirmed before
execution, not improvised — and it is the one step that does not begin without
an explicit go.

**Dropped:** long-press, nested bundles, geographic proximity, cart-modal-over-
sheet.

**Dropped:** long-press, nested bundles, geographic proximity, cart-modal-over-
sheet.

**No longer blocked.** The buffer, ceiling, SLA and tagging were settled on
21 Sep — see §4a.
