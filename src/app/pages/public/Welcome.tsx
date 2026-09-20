// The front door: the first thing you see after logging in.
//
// Not a marketing page — pages/public/Landing.tsx is that, and it is a signup
// funnel with a different job. This is orientation: who we are, what happens
// to your money, and which of the two doors you want.
//
// It asks the two-market question once, out loud, instead of guessing. A
// diaspora sender and a Lusaka shopper want almost nothing in common from a
// front page, and the six mode chips on the storefront were never a fork —
// six equal options is what not choosing looks like. Both doors lead to the
// same storefront with the mode already set, so neither answer is a trap.
//
// EVERYTHING HERE IS A TILE, including the header.
//
// One six-column grid, one gap, repeated down the page. That is not a visual
// preference — it is what lets the page be read at a glance by someone who has
// never seen it and is deciding whether to trust it with money. A tile is a
// bounded claim: it holds one thing, says what that thing is, and says what
// happens if you press it. A page of tiles can therefore be scanned in any
// order, which is how a nervous person actually reads.
//
// The order is the argument, and it is deliberate:
//   1. the welcome, in brand colour, saying where you are
//   2. a face and a phone number, before a single ask
//   3. what we promise about your money, in the order people worry
//   4. the two doors — the one question this page exists to ask
//   5. what we carry, as photographs you can press
//
// Every tile that can be pressed says so in words as well as in shape. The
// charter's grammar holds throughout: round presses, square informs.

import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { motion } from 'motion/react';
import { ArrowRight, Shield, ScanLine, Coins, MessageCircle, Mail } from 'lucide-react';
import { useStorefrontMode } from '../../hooks/useStorefrontMode';
import { useFeaturedCategories } from '../../hooks/useCategories';
import { categoryFrames } from '../../types/categoryArt';
import { TileMosaic, type MosaicTile } from '../../components/shared/TileMosaic';
import { OCCASION_TILES, OCCASION_ART } from '../../types/occasions';
import { markWelcomeSeen } from './welcomeSeen';
import { WELCOME_VIDEO, WELCOME_POSTER } from './welcomeMedia';

/**
 * How many category tiles the second mosaic carries.
 *
 * The seed features twenty-five, which is a directory rather than a front
 * door — past about nine the mosaic stops being an arrangement somebody made
 * and becomes a list you have to read. The cap takes them in the admin's own
 * ui_order_index order, so choosing which nine is already a thing Admin >
 * Merchandising can do without touching this file.
 *
 * The OCCASION mosaic above it is deliberately uncapped. Thirteen is more than
 * nine and that is fine, because it is a closed taxonomy rather than an open
 * directory: the list cannot grow behind your back, every entry means
 * something different, and the span pattern closes all eight of its rows.
 */
const CATEGORY_TILES = 9;

/**
 * The occasions, as tiles.
 *
 * Built once at module scope because it is a constant: the taxonomy is a
 * TypeScript union, not a query. `image_url` is null for most of them today,
 * which the mosaic draws as an ink block carrying the name.
 */
const OCCASION_MOSAIC: MosaicTile[] = OCCASION_TILES.map((occasion) => ({
  id: occasion.kind,
  name: occasion.label,
  blurb: occasion.blurb,
  quiet: occasion.quiet,
  images: OCCASION_ART[occasion.kind] ?? [],
}));

const PROMISES = [
  {
    icon: Coins,
    title: 'The rate you see is the rate you pay',
    body: 'Your kwacha total is locked before you pay, and held for fifteen minutes. No spread hidden in the conversion.',
  },
  {
    icon: Shield,
    title: 'Your money waits in escrow',
    body: 'The shop is not paid when you are. It is paid once your person has collected what you sent.',
  },
  {
    icon: ScanLine,
    title: 'You are told the moment it is handed over',
    body: 'The code is scanned at the counter and you hear about it there and then — not the next day, and not from us guessing.',
  },
];

/** One gap, everywhere. What makes a page of tiles read as one surface. */
const GRID = 'grid grid-cols-6 gap-3 md:gap-4';

export function Welcome() {
  const navigate = useNavigate();
  const { setMode } = useStorefrontMode();
  const [videoFailed, setVideoFailed] = useState(false);
  const { categories, loading: categoriesLoading } = useFeaturedCategories();
  // Art first, THEN the admin's order.
  //
  // Belt and braces over ui_order_index, and it exists because relying on
  // that column alone failed: it defaults to 0, not null, so the nine
  // curated categories sorted behind the sixteen untouched ones and the
  // whole mosaic rendered as black fallback blocks. Ordering by "has a
  // picture" makes a black tile structurally impossible while there is any
  // art at all -- whatever the indexes happen to say.
  const categoryMosaic = useMemo(
    () => categories
      .map((c) => ({ c, frames: categoryFrames(c.slug, c.image_url) }))
      .sort((a, b) => Number(b.frames.length > 0) - Number(a.frames.length > 0))
      .slice(0, CATEGORY_TILES)
      .map(({ c }) => c)
      .map(
      (c): MosaicTile => ({
        id: c.id,
        name: c.name,
        // The database's cover leads; the local set fills in behind it and
        // supplies the extra frames there is no column for.
        images: categoryFrames(c.slug, c.image_url),
      }),
    ),
    [categories],
  );

  const enter = useCallback(
    (mode: 'gifting' | 'shopping') => {
      markWelcomeSeen();
      setMode(mode);
      navigate('/', { replace: true });
    },
    [navigate, setMode],
  );

  // A tile answers "what", and the two doors answer "who" — so this
  // deliberately leaves the mode alone. Forcing 'shopping' because somebody
  // tapped Groceries would quietly answer the two-market question on their
  // behalf, and answering it wrong for a diaspora sender is exactly the guess
  // this page exists to stop making. The storefront keeps whatever mode it
  // already had, and the mode rail is still right there.
  const openCategory = useCallback(
    (tile: MosaicTile) => {
      markWelcomeSeen();
      const slug = categories.find((c) => c.id === tile.id)?.slug;
      navigate(slug ? `/?category=${encodeURIComponent(slug)}` : '/', { replace: true });
    },
    [navigate, categories],
  );

  // An occasion tile carries an intent, so unlike a category tile it DOES set
  // the mode — 'gifting', because every one of these is something you are
  // buying for somebody else. That is the difference between the two mosaics:
  // "Birthday" answers who as well as what, and "Furniture" answers only what.
  const openOccasion = useCallback(
    (tile: MosaicTile) => {
      const occasion = OCCASION_TILES.find((o) => o.kind === tile.id);
      if (!occasion) return;
      markWelcomeSeen();
      if (occasion.href) {
        navigate(occasion.href);
        return;
      }
      setMode('gifting');
      navigate(
        occasion.primaryCategory
          ? `/?category=${encodeURIComponent(occasion.primaryCategory)}`
          : '/',
        { replace: true },
      );
    },
    [navigate, setMode],
  );

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-6xl px-3 py-3 sm:px-5 sm:py-5 md:py-6">
        <div className="space-y-3 md:space-y-4">
          {/* ── 1. The welcome ───────────────────────────────────────────
              The header, as a tile. It used to bleed to all four edges of
              the window, which made it chrome — the band a site wears rather
              than a thing the page contains. Inset and rounded, the same
              brand colour reads as the first card in a stack, which is what
              it is: the one that says where you are before anything asks you
              for anything. */}
          <section className="kl-wash-ember relative overflow-hidden rounded-[var(--radius-tile)] px-6 py-14 text-white sm:px-10 md:px-14 md:py-24">
            <div className="max-w-2xl">
              <motion.p
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-white/80"
              >
                A touch of home
              </motion.p>
              <motion.h1
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.06 }}
                className="kl-display text-4xl leading-[0.95] tracking-[-0.03em] md:text-7xl"
              >
                KithLy
              </motion.h1>
              <motion.p
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.12 }}
                className="mt-5 max-w-xl text-base font-light leading-relaxed text-white/90 md:text-lg"
              >
                Send the thing itself, not the money for it. Groceries, a cake, a
                prescription — bought here, collected by the person you sent it to,
                at a shop in Zambia you can see before you pay.
              </motion.p>
            </div>
          </section>

          {/* ── 2. A face, and a phone number ────────────────────────────
              Before the promises and long before the doors. The order is the
              argument: anybody can write "your money is safe", and the thing
              that separates a real operation from the one that took your
              cousin's money is whether a person picks up. So the person is
              placed first, next to the film rather than at the bottom of the
              page where a contact strip usually goes to die. */}
          <div className={GRID}>
            {/* Who is behind this. The point is a face, not a production. */}
            <div className="col-span-6 h-60 overflow-hidden rounded-[var(--radius-tile)] bg-black sm:h-80 md:col-span-4 md:h-[26rem]">
              {videoFailed ? (
                <div className="flex h-full w-full items-center justify-center bg-ink-900 px-6 text-center">
                  <p className="text-sm font-light text-white/70">
                    The welcome film could not load. Everything below still applies.
                  </p>
                </div>
              ) : (
                <video
                  className="h-full w-full object-cover"
                  src={WELCOME_VIDEO}
                  poster={WELCOME_POSTER || undefined}
                  controls
                  playsInline
                  preload="none"
                  onError={() => setVideoFailed(true)}
                >
                  Your browser cannot play this video.
                </video>
              )}
            </div>

            <div className="kl-tile kl-rim col-span-6 flex flex-col justify-center p-6 sm:p-8 md:col-span-2">
              <h2 className="kl-display mb-2 text-xl tracking-tight text-ink-900">
                You get a person
              </h2>
              <p className="mb-5 text-sm font-light leading-relaxed text-muted-foreground">
                Not a ticket number. Message or ring, and the same person who
                built this answers and walks you through it.
              </p>
              <div className="flex flex-col gap-2.5">
                <a
                  href="https://wa.me/260977000000"
                  className="flex items-center gap-2 text-sm font-medium text-primary hover:underline"
                >
                  <MessageCircle className="h-4 w-4 shrink-0" strokeWidth={2} />
                  WhatsApp
                </a>
                <a
                  href="mailto:support@kithly.zm"
                  className="flex items-center gap-2 break-all text-sm font-medium text-primary hover:underline"
                >
                  <Mail className="h-4 w-4 shrink-0" strokeWidth={2} />
                  support@kithly.zm
                </a>
              </div>
              <p className="mt-5 text-xs font-light text-muted-foreground">
                That film is a placeholder. The real one is a minute of us saying
                who we are and how to reach us directly.
              </p>
            </div>
          </div>

          {/* ── 3. What we promise about your money ──────────────────── */}
          <div className={GRID}>
            <div className="kl-tile kl-rim col-span-6 p-6 sm:p-9 md:p-12">
              <h2 className="kl-display mb-4 text-2xl tracking-tight text-ink-900 md:text-4xl">
                We are new, and we would rather say so
              </h2>
              <p className="max-w-2xl text-sm font-light leading-relaxed text-muted-foreground md:text-base">
                You have probably been burned by a transfer that arrived short, or a
                relative who never quite got what you paid for. So here is exactly what
                happens to your money, before you give us any.
              </p>
            </div>

            {PROMISES.map((promise, i) => (
              <motion.div
                key={promise.title}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.05 * i }}
                className="kl-tile kl-rim col-span-6 p-6 sm:p-7 md:col-span-2"
              >
                <div className="kl-gradient-brand-br mb-4 flex h-10 w-10 items-center justify-center rounded-xl">
                  <promise.icon className="h-4.5 w-4.5 text-white" strokeWidth={1.5} />
                </div>
                <h3 className="mb-2 text-sm font-semibold text-ink-900">{promise.title}</h3>
                <p className="text-sm font-light leading-relaxed text-muted-foreground">
                  {promise.body}
                </p>
              </motion.div>
            ))}
          </div>

          {/* ── 4. The two doors ─────────────────────────────────────────
              The whole two-market question, asked once. */}
          <div className={GRID}>
            <div className="col-span-6 px-1 pt-4 pb-1 md:pt-6">
              <h2 className="kl-display text-2xl tracking-tight text-ink-900 md:text-4xl">
                Which brings you here?
              </h2>
              <p className="mt-2 max-w-xl text-sm font-light leading-relaxed text-muted-foreground">
                Either answer opens the same shops. It only decides what we put in
                front of you first, and you can change it any time from the bar at
                the top.
              </p>
            </div>

            <button
              onClick={() => enter('gifting')}
              className="kl-tile kl-rim kl-lift group col-span-6 p-6 text-left sm:p-8 md:col-span-3
                         focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring
                         focus-visible:ring-offset-2"
            >
              <span className="kl-display mb-2 block text-xl tracking-tight text-ink-900 md:text-2xl">
                Send home
              </span>
              <span className="mb-6 block text-sm font-light leading-relaxed text-muted-foreground">
                Somebody in Zambia is collecting it — groceries for the month, a
                birthday, a pharmacy run. You pay here, they collect there.
              </span>
              <span className="flex items-center gap-1.5 text-sm font-medium text-primary">
                Start sending
                <ArrowRight
                  className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5"
                  strokeWidth={2}
                />
              </span>
            </button>

            <button
              onClick={() => enter('shopping')}
              className="kl-tile kl-rim kl-lift group col-span-6 p-6 text-left sm:p-8 md:col-span-3
                         focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring
                         focus-visible:ring-offset-2"
            >
              <span className="kl-display mb-2 block text-xl tracking-tight text-ink-900 md:text-2xl">
                I am Zambian
              </span>
              <span className="mb-6 block text-sm font-light leading-relaxed text-muted-foreground">
                You are here and shopping for yourself. Straight into the
                catalogue: every shop, every item, nothing in the way.
              </span>
              <span className="flex items-center gap-1.5 text-sm font-medium text-primary">
                Browse the shops
                <ArrowRight
                  className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5"
                  strokeWidth={2}
                />
              </span>
            </button>
          </div>

          {/* ── 5. What you are sending ─────────────────────
              Occasions before categories, because Send Home is the default
              intent and an occasion is the question a sender is actually
              asking. "Birthday" is a thing you are doing; "Bakery & Cakes" is
              a shelf you would have to already know to look at.

              The heading is not inside a tile on purpose. A run of pressable
              photographs needs one thing above it that is plainly not
              pressable, or the first tile has to work out for itself that it
              is a tile and not a title. */}
          <div className={GRID}>
            <div className="col-span-6 px-1 pt-4 pb-1 md:pt-6">
              <h2 className="kl-display text-2xl tracking-tight text-ink-900 md:text-4xl">
                What are you sending?
              </h2>
              <p className="mt-2 max-w-xl text-sm font-light leading-relaxed text-muted-foreground">
                Press one and the shops open on it. Nothing is ordered yet — this
                is only looking, and you can come back out.
              </p>
            </div>
          </div>

          <TileMosaic
            tiles={OCCASION_MOSAIC}
            onSelect={openOccasion}
            label="What are you sending"
          />

          {/* ── 6. Or by shelf ─────────────────────────────────
              The same mosaic component, fed categories instead. This is the
              Browse rail's navigation, kept on the page for the Lusaka shopper
              who knows exactly what they want and does not need an occasion
              wrapped around it. */}
          <div className={GRID}>
            <div className="col-span-6 px-1 pt-4 pb-1 md:pt-6">
              <h2 className="kl-display text-2xl tracking-tight text-ink-900 md:text-4xl">
                Or just browse
              </h2>
              <p className="mt-2 max-w-xl text-sm font-light leading-relaxed text-muted-foreground">
                If you already know what you are after, go straight to the shelf.
              </p>
            </div>
          </div>

          <TileMosaic
            tiles={categoryMosaic}
            loading={categoriesLoading}
            onSelect={openCategory}
            label="Browse by category"
          />
        </div>
      </div>
    </div>
  );
}
