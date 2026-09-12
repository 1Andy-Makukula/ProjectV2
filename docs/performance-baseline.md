# Performance baseline

Measured 2026-09-12 on `main` at `6754d70`, immediately after the purchasable-posts
track landed. This is V3 Stage 0's deliverable: the number every later stage is
compared against.

Re-measure with:

```
pnpm build && pnpm perf
```

`scripts/perf-baseline.mjs` reads `dist/index.html` and measures exactly what the
browser is told to fetch before anything is interactive.

## The number

| Asset | Raw | Gzip |
|---|---:|---:|
| `index.js` | 699.0 KB | 181.5 KB |
| `vendor-ui.js` | 505.1 KB | 153.2 KB |
| `vendor-supabase.js` | 202.7 KB | 52.4 KB |
| `vendor-react.js` | 119.9 KB | 40.8 KB |
| `index.css` | 202.5 KB | 30.2 KB |
| `vendor-radix.js` | 78.3 KB | 26.7 KB |
| **Critical path** | **1807.5 KB** | **484.8 KB** |

## Why this is measured and not "the main bundle"

`index.js` alone is 181.5 KB gzip, which would pass the 200 KB figure the plan
originally proposed. That figure is misleading. Vite emits a
`<link rel="modulepreload">` for every vendor chunk the entry depends on, so all
six files above are fetched immediately. The honest number is their sum:
**484.8 KB gzip, 1.76 MB raw**.

Raw size matters separately from transfer size. Gzip is what costs seconds on a
metered 3G connection; raw is what the device must then parse, which is the half
that hurts on a cheap Android CPU.

## The budget

| | Gzip | Enforced |
|---|---:|---|
| **Ceiling** | 500 KB | Yes — `pnpm perf` exits non-zero above it |
| **Target** | 250 KB | No — printed every run, not a build failure |

Two thresholds, deliberately. The ceiling is a ratchet sitting just above today's
measurement: a stage that makes the app slower has to say so before it lands.
The target is where this should end up. Failing the build against a goal nobody
has done the work for yet would only teach people to skip the check.

Current state: **1.94× over target, inside the ceiling.**

## Where the weight is

Three observations, none of them yet acted on — Stage 0 measures, it does not
optimise.

**`vendor-ui` at 153.2 KB gzip** is `lucide-react`, `motion/react` and `sonner`
(see `manualChunks` in `vite.config.ts`). `motion` is the largest of the three
and is imported by 50 files. This is the first place to look.

**`index.js` at 181.5 KB gzip** carries the app shell plus five pages that
`routes.tsx` imports eagerly rather than through `lazyPage`: `ConsumerStorefront`,
`SignUp`, `Login`, `GiftPage`, `NotFound`. `ConsumerStorefront` pulls the whole
storefront tree — the feed, the rail, post cards — into the entry chunk.

**Icons are not the problem.** 126 distinct `lucide-react` icons are imported by
name across 101 files, which tree-shakes correctly. Worth recording so nobody
spends a day there.

## What this constrains

Stage 4a adds motion to the storefront. Two things follow from the measurement:

1. `motion/react` is already on the critical path, so the Conductor itself costs
   almost nothing to add — it is a `requestAnimationFrame` loop, not a library.
2. The page is heavy *before* any animation starts. Frame timing at Stage 4a must
   be measured on the real critical path, not on a stripped test page, or it will
   look fine and ship slow.

## Not covered here

Field timings — LCP, INP — need a deployed URL and a real handset. The plan's
proposed *LCP < 2.5s on 3G / mid Android* is not yet measured, and the Lighthouse
half of the harness is not built. This document covers payload only, which is the
part that can be measured deterministically in CI.
