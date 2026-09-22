# ADR 0004 — The storefront is two columns, not three

**Status:** accepted
**Date:** 2026-09-22
**Commit:** `b6e4cab`
**Supersedes:** the cockpit layout in the Chitenge Cockpit build spec

## Context

The Chitenge Cockpit charter specified a three-column storefront:

```
grid-template-columns: 264px minmax(0,1fr) 336px
```

with a documented division of labour — the **left** rail was the platform
talking (Market Pulse, trending shops, most bought, special deals) and the
**right** rail was what is waiting on you (status, bag, occasions, wishes,
your lists). The right one was deliberately wider, because it was yours.

It was built that way and shipped that way. This records why it is now two.

## The layout being designed for was not the layout being seen

Both rails were `xl:block`. **Below 1280px neither existed.** On a phone, and
on any laptop narrower than 1280, the modules were already ribbons in the feed
and a drawer off the left edge — two columns at most, usually one.

So the three-column cockpit was the exception, and the two-column case was
what nearly every visitor actually got. The rarest rendering was the one the
charter described and the one design attention went to.

It also asked the eye to watch both edges of the feed at once, on a page whose
middle column is the merchandise. A rail is meant to sit beside the feed rather
than compete with it, and two of them compete with each other as well.

## The split was already decoration, and the code said so

`modeRail(mode)` has always returned **one ordered list**. `modeRailSide` did
nothing but filter that list by side:

```ts
export function modeRailSide(mode, side) {
  return modeRail(mode).filter((k) => RIGHT_RAIL_MODULES.has(k) === (side === 'right'));
}
```

Two further things in the codebase were already written as though the split
were incidental:

- `StorefrontRailModules` renders `modeRail(mode)` — the whole set — and
  `RailDrawer` uses it. Their comment says the drawer takes the whole set and
  "knows nothing about sides". **The phone experience needed no change at all.**
- The ordering comment in `storefrontModes.ts` explains that `status` is "first
  thing on the LEFT rail — which is what *second in this list* means, because
  `status` is a right-rail module and `modeRailSide` splits the one list by
  side while preserving order." That comment exists to explain an artefact of
  the split. With the split gone it describes the code directly.

Dropping the filter restores the order the list was written in: **status first,
because a mode leads with what is already in flight, then the market, then
yours.**

## Decision

One rail, at `304px`, beside the feed. Container ceiling `85rem`.

`304` sits between the old `264` and `336`: wider than the left rail because it
now carries the right one's modules too, narrower than the right because it is
no longer a bag panel competing with the feed beside it.

The right rail's "only render when there is a feed worth flanking" gate is
removed. `empty:!hidden` already hides a rail whose every module has opted out,
and that is the general case the gate was a special case of.

## What did not change

- **The module set and its order.** Nothing was dropped or reordered; one
  filter was removed.
- **The phone.** Ribbons and the drawer are untouched.
- **The status ribbon stays in the feed on a phone**, not in the drawer. The
  existing rule holds: what is waiting on you should never need a gesture to be
  discovered. Your gift being on its way is not something to go looking for.

## What this costs

The charter's left/right semantics are gone as a *spatial* distinction. "The
platform talking" and "what is waiting on you" are now expressed by order
within one column rather than by which edge they sit on. If that distinction
later needs to be visible again, the honest way back is a divider or a heading
inside the one rail — not a second column that most people never see.
