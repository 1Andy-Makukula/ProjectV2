// The side rail — what is going on around you while you browse.
//
// One set of modules, two presentations. On a wide screen they stack down a
// sticky column beside the feed; on a phone, where a rail cannot exist, the
// same modules become horizontal ribbons dropped into the feed. Both come from
// here so the two can never drift apart, and every module takes its data as a
// prop — the storefront has already fetched it, and a rail is not worth a
// second round of queries.

import { useNavigate } from 'react-router';
import {
  ArrowRight,
  Flame,
  Gift,
  BadgePercent,
  ListChecks,
  Package,
  PackageCheck,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Store,
  Truck,
} from 'lucide-react';
import { useAuth } from '../../../utils/auth/AuthContext';
import { useCart } from '../../hooks/useCart';
import { useMyLists } from '../../hooks/useLists';
import { useShopperStatus } from '../../hooks/useShopperStatus';
import { useContacts } from '../../hooks/useContacts';
import { useWishes } from '../../hooks/useWishes';
import { useMostBought } from '../../hooks/useMostBought';
import { useItemQuickView } from './ItemQuickView';
import { countdownLabel, occasionTitle, upcomingOccasions } from '../../types/contacts';
import { formatCurrency } from '../../../utils/currency';
import { useStorefrontMode } from '../../hooks/useStorefrontMode';
import {
  OCCASION_ICON,
  modeLexicon,
  modeRail,
  modeRailSide,
} from '../../types/storefrontModes';
import type { StorefrontShop } from '../../hooks/useStorefrontData';
import { discountPercentage, type CatalogItem } from '../../types/items';
import { statementIsPositive, statementKey, statementLabel } from '../../reco/pulse';
import { useMarketPulse } from '../../hooks/useMarketPulse';
import type { ListSummary } from '../../types/lists';

type Layout = 'column' | 'ribbon';
/** Which flank of the feed a rail is drawn on. */
type Side = 'left' | 'right';
type RailKeys = ReturnType<typeof modeRail>;

interface RailProps {
  shops: StorefrontShop[];
  items: CatalogItem[];
  lists: ListSummary[];
  layout?: Layout;
}

/**
 * Which colour a module names itself in.
 *
 * The one place the app leaves the orange family, and it is worth saying why:
 * a column of eight white cards with eight identical headings is a stack you
 * have to *read* to navigate. Give each module a hue and it becomes one you
 * recognise — "the green one" — which is how the SINTECH design's rail works
 * and what was missing from ours.
 *
 * Headings and their icons only. The brand is unchanged everywhere it does
 * work: buttons, prices, CTAs, active states, the pulse. A heading is a label
 * rather than an action, which is what lets it afford a colour of its own.
 */
export type ModuleAccent = 'brand' | 'coral' | 'berry' | 'leaf' | 'ink';

/** Flat, for glyphs. A 19px icon filled with a gradient looks broken. */
const ACCENT_ICON: Record<ModuleAccent, string> = {
  brand: 'text-[var(--accent-brand)]',
  coral: 'text-[var(--accent-coral)]',
  berry: 'text-[var(--accent-berry)]',
  leaf: 'text-[var(--accent-leaf)]',
  ink: 'text-[var(--accent-ink)]',
};

/* ACCENT_TITLE is gone (2026-09-18). Module headings were gradient-clipped
   text -- .kl-accent-* -- and gradient text is the one thing substitution 2
   of the charter removes outright: it has no single contrast ratio and it
   degrades at exactly the size a module title is set at.

   The five-hue system itself SURVIVES, on the icon. It was added on
   2026-09-17 to fix a real problem (a column of eight white cards you have to
   read rather than recognise), the charter predates it and so does not
   mention it, and a coloured 15px glyph beside a solid Caprasimo title keeps
   the "find the green one" affordance without spending the heading on it. */

/** The shell every module shares: a titled tile, or a titled ribbon. */
function Module({
  title,
  icon: Icon,
  action,
  layout,
  accent = 'brand',
  children,
}: {
  title: string;
  icon: typeof Store;
  action?: { label: string; onClick: () => void };
  layout: Layout;
  /** Defaults to the brand. A module with nothing special to say is orange. */
  accent?: ModuleAccent;
  children: React.ReactNode;
}) {
  return (
    <section
      className={
        layout === 'column'
          ? 'kl-rim relative bg-card p-[1.125rem] rounded-[var(--radius-panel)]'
          : ''
      }
    >
      {/* Black weight, and the module's own colour.
          This was 11px uppercase muted grey, then 17px semibold in the
          foreground. Both had the same problem from two directions: every
          label on the page speaking at one volume, so nothing led the eye.
          The SINTECH rail answers it with weight AND hue — the heading is the
          loudest thing in the card and no two neighbours are the same colour,
          which is what makes a stack of white cards scannable. */}
      <header className="mb-3 flex items-center gap-2">
        <Icon className={`size-[15px] shrink-0 ${ACCENT_ICON[accent]}`} strokeWidth={2.75} />
        <h3 className="kl-display text-[1.0625rem] leading-none text-foreground">
          {title}
        </h3>
        {action && (
          /* #C93A08 rather than --primary: this is accent-coloured TEXT on a
             white ground, where the brand itself is only 3.95:1. */
          <button
            onClick={action.onClick}
            className="ml-auto inline-flex items-center gap-0.5 text-[10px] font-bold uppercase
                       tracking-[0.06em] text-accent-text transition-opacity hover:opacity-75"
          >
            {action.label}
            <ArrowRight className="size-3" strokeWidth={2.5} />
          </button>
        )}
      </header>
      {children}
    </section>
  );
}

/**
 * A row of things inside a module.
 *
 * In a column it is a stack; in a ribbon it is a swipable row of fixed-width
 * cards. The distinction is only ever made here, so no module has to think
 * about it.
 */
function ModuleBody({
  layout,
  variant = 'list',
  children,
}: {
  layout: Layout;
  /**
   * `list` is the plain row; `feature` gives the entry a larger picture and a
   * rank. Spacing only — the modules underneath are the same modules.
   *
   * Both now sit as cards inside the module's own card rather than flat against
   * it. That is the shape the reference designs use, and it is what separates
   * one entry from the next without a divider doing the work.
   */
  variant?: 'list' | 'feature';
  children: React.ReactNode;
}) {
  if (layout === 'column') {
    return <div className="space-y-2">{children}</div>;
  }

  return (
    <div
      className={`kl-scroll -mx-4 flex gap-3 overflow-x-auto px-4 pb-1 [&>*]:shrink-0 ${
        variant === 'feature' ? '[&>*]:w-40' : '[&>*]:w-44'
      }`}
    >
      {children}
    </div>
  );
}

/** One clickable line: picture, name, and a small fact underneath. */
function Row({
  image,
  name,
  detail,
  fallbackIcon: Fallback,
  onClick,
  layout,
}: {
  image: string | null;
  name: string;
  detail: string;
  fallbackIcon: typeof Store;
  onClick: () => void;
  layout: Layout;
}) {
  return (
    <button
      onClick={onClick}
      /* On --surface-paper inside a white panel, not another white card on a
         white card. r14 (--radius-lg) and 8px padding are the charter's
         inner-row figures. */
      className={`group flex items-center gap-2.5 rounded-[var(--radius-lg)]
                  bg-surface-paper p-2 text-left transition-colors hover:bg-secondary
                  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2
                  ${layout === 'ribbon' ? '' : 'w-full'}`}
    >
      <div className="size-10 shrink-0 overflow-hidden rounded-[var(--radius-md)] bg-muted">
        {image ? (
          <img src={image} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="grid h-full w-full place-items-center">
            <Fallback className="size-4 text-muted-foreground/40" strokeWidth={1.5} />
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[0.8125rem] font-semibold text-foreground">{name}</p>
        <p className="truncate text-[0.6875rem] text-muted-foreground">{detail}</p>
      </div>
    </button>
  );
}

/**
 * The same line, ranked and given a bigger picture.
 *
 * Briefly this was a full-width 4:3 photograph per entry. It was too much: three
 * of them filled the rail and pushed everything below it out of reach, and a
 * rail is meant to sit beside the feed rather than compete with it. So the
 * picture is a 56px square — half again the plain row's 40px, enough to
 * recognise a shop by, and nowhere near a lookbook.
 *
 * It stays a presentation of the same Row data rather than a second kind of
 * module, so a feature module still comes from the registry and still renders
 * in both the column and the ribbon.
 *
 * `rank` is the position in the module's own ordering and nothing more. The
 * module title says what that ordering means — the badge deliberately carries a
 * bare number rather than "1st place", which would imply a popularity contest
 * the underlying data has not been asked to run.
 */
function FeatureRow({
  image,
  name,
  detail,
  rank,
  fallbackIcon: Fallback,
  onClick,
  layout,
}: {
  image: string | null;
  name: string;
  detail: string;
  rank?: number;
  fallbackIcon: typeof Store;
  onClick: () => void;
  layout: Layout;
}) {
  return (
    // Picture edge to edge, words on the picture. A 56px thumbnail next to two
    // lines of text is a database row with a photograph attached to it; at this
    // size the photograph is the thing being offered and the words are the
    // caption. The scrim is what keeps them legible over an unknown image —
    // nobody uploading a product shot is thinking about our type.
    <button
      onClick={onClick}
      className={`kl-rim kl-float group relative isolate block overflow-hidden text-left
                  rounded-[var(--radius-tile)] bg-muted
                  ${layout === 'ribbon' ? 'aspect-[3/4]' : 'aspect-[16/10] w-full'}`}
    >
      {image ? (
        <img
          src={image}
          alt=""
          loading="lazy"
          className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
        />
      ) : (
        <div className="absolute inset-0 grid place-items-center">
          <Fallback className="size-8 text-muted-foreground/30" strokeWidth={1.25} />
        </div>
      )}

      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/45 to-transparent p-3 pt-10">
        <p className="truncate text-sm font-bold leading-tight text-white">{name}</p>
        <p className="mt-0.5 truncate text-xs font-medium text-white/85">{detail}</p>
      </div>

      {rank !== undefined && (
        /* A block, not a ghost circle. 20x20 of solid ink pinned into the
           image's own top-left corner with only the inner corner rounded, so
           it reads as stamped onto the picture rather than floating over it.
           Square informs; this is a fact about position.

           Still a bare number. "1st place" would claim a contest the data has
           not been asked to run -- the module title says what the order means. */
        <span
          aria-hidden
          className="absolute left-0 top-0 grid size-5 place-items-center rounded-br-lg
                     bg-ink text-[11px] font-bold tabular-nums text-white"
        >
          {rank}
        </span>
      )}
    </button>
  );
}

/**
 * What is waiting on you.
 *
 * Only rendered for someone signed in, and only when a number is non-zero —
 * a row of confident zeroes says "nothing works here" rather than "you are all
 * caught up". The cart line is the exception: it is always shown once there is
 * something in it, because that is the one number people look for.
 */
function StatusModule({ layout }: { layout: Layout }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { status, loading } = useShopperStatus();
  const { mode } = useStorefrontMode();
  const lexicon = modeLexicon(mode);
  const cartCount = useCart((state) => state.getTotalItems());

  if (!user || loading) return null;

  const lines = [
    {
      key: 'collect',
      icon: PackageCheck,
      label: 'Ready to collect',
      value: String(status.toCollect),
      // Sage: collected and ready is "done and safe", which is what sage
      // means here and the one thing it is allowed to mean.
      tone: 'text-sage-deep',
      onClick: () => navigate('/dashboard'),
      show: status.toCollect > 0,
    },
    {
      key: 'preparing',
      icon: Package,
      label: 'Being prepared',
      value: String(status.preparing),
      tone: 'text-foreground',
      onClick: () => navigate('/dashboard'),
      show: status.preparing > 0,
    },
    {
      key: 'flight',
      icon: Truck,
      label: 'Gifts on their way',
      value: String(status.inFlight),
      tone: 'text-foreground',
      onClick: () => navigate('/orders'),
      show: status.inFlight > 0,
    },
    {
      key: 'cart',
      icon: ShoppingBag,
      label: `In your ${lexicon.cart.toLowerCase()}`,
      value: String(cartCount),
      tone: 'text-primary',
      onClick: () => useCart.getState().setCartSliderOpen(true),
      show: cartCount > 0,
    },
  ].filter((line) => line.show);

  if (lines.length === 0) return null;

  return (
    <Module title="Your status" icon={Sparkles} layout={layout} accent="ink">
      <div className={layout === 'ribbon' ? 'kl-rim kl-float rounded-[var(--radius-tile)] p-1' : ''}>
        {lines.map((line) => {
          const Icon = line.icon;
          return (
            <button
              key={line.key}
              onClick={line.onClick}
              className="flex w-full items-center gap-2 rounded-[var(--radius-lg)] px-2 py-1.5 text-left transition-colors hover:bg-accent"
            >
              <Icon className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={2.75} />
              <span className="flex-1 truncate text-[0.8125rem] text-foreground">{line.label}</span>
              {/* Caprasimo 17px, tabular. The hide-your-zeros rule above is
                  what makes these worth setting at this size: every line
                  present is a line with something in it. */}
              <span className={`kl-money text-[1.0625rem] leading-none ${line.tone}`}>
                {line.value}
              </span>
            </button>
          );
        })}
      </div>

      {/* The escrow thread closes here. Brass as a ground with ink on it,
          and only drawn when there is actually money being held -- the
          hide-your-zeros rule applies to this strip as much as to the rows
          above it. */}
      {status.toCollect + status.preparing + status.inFlight > 0 && (
        <p className="mt-2 flex items-center gap-1.5 rounded-[var(--radius-block)] bg-brass
                      px-2.5 py-1.5 text-[11px] font-semibold text-ink">
          <ShieldCheck className="size-3.5 shrink-0" strokeWidth={2.75} aria-hidden />
          Held for you in escrow until collection.
        </p>
      )}
    </Module>
  );
}

/**
 * Whose birthday is coming up.
 *
 * Real now: the dates come from the viewer's own contacts, windowed to the
 * next couple of months and sorted soonest first. Someone with contacts but no
 * birthdays recorded gets the prompt to add one; someone with no contacts at
 * all gets the invitation to start, because an empty module that explains
 * itself is worth more than one that hides.
 */
function Occasions({ layout }: { layout: Layout }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { contacts, loading } = useContacts();

  if (!user || loading) return null;

  const upcoming = upcomingOccasions(contacts, 60).slice(0, 4);

  return (
    <Module
      title="Occasions coming up"
      icon={OCCASION_ICON}
      layout={layout}
      accent="berry"
      action={{ label: 'People', onClick: () => navigate('/contacts') }}
    >
      <div className={layout === 'ribbon' ? 'kl-rim kl-float rounded-[var(--radius-tile)] p-3' : ''}>
        {upcoming.length === 0 ? (
          <button
            onClick={() => navigate('/contacts')}
            className="w-full rounded-[var(--radius-lg)] px-1.5 py-2 text-left text-[0.8125rem] font-light text-muted-foreground transition-colors hover:bg-accent"
          >
            {contacts.length === 0
              ? 'Save the people you send to, and their dates turn up here.'
              : 'Add a date to someone and it will appear here.'}
          </button>
        ) : (
          <div className="space-y-0.5">
            {upcoming.map(({ contact, occasion, days }) => (
              <button
                key={occasion.id}
                onClick={() => navigate('/contacts')}
                className="flex w-full items-baseline gap-2 rounded-[var(--radius-lg)] px-1.5 py-1.5 text-left transition-colors hover:bg-accent"
              >
                <span className="truncate text-[0.8125rem] font-medium">{contact.name}</span>
                <span className="shrink-0 text-[0.6875rem] font-light text-muted-foreground">
                  {occasionTitle(occasion)}
                </span>
                <span
                  className={`ml-auto shrink-0 text-[0.6875rem] font-medium ${
                    days <= 7 ? 'text-primary' : 'text-muted-foreground'
                  }`}
                >
                  {countdownLabel(days)}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </Module>
  );
}

/**
 * What people close to you have asked for.
 *
 * The surface that makes Secret Santa work: a wish is useless if the people who
 * would act on it never see it. Only ever shows wishes the reader is actually
 * allowed — `wishes_from_my_contacts` applies the wish's own visibility, and the
 * name shown is the one the reader filed them under, so it reads as "Mum" rather
 * than whatever is on their account.
 */
function Wishes({ layout }: { layout: Layout }) {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { fromContacts } = useWishes();

  if (!profile || fromContacts.length === 0) return null;

  return (
    <Module title="Wishes from people you know" icon={Gift} layout={layout} accent="brand">
      <ModuleBody layout={layout}>
        {fromContacts.slice(0, 4).map((wish) => (
          <Row
            key={wish.wish_id}
            layout={layout}
            image={null}
            name={`${wish.wisher_name} made a wish`}
            detail={wish.note ?? 'Wanna have a look?'}
            fallbackIcon={Gift}
            onClick={() => navigate(`/post/${wish.post_id}`)}
          />
        ))}
      </ModuleBody>
    </Module>
  );
}

/**
 * What people actually bought.
 *
 * The only trending number this platform can state honestly. Nothing records a
 * visit anywhere in the schema, so the "Most Visited" the reference designs ask
 * for is not here and is not invented — this is counted from real SUCCESS
 * transactions, and it renders nothing at all until enough of them exist.
 */
function MostBought({ layout }: { layout: Layout }) {
  const openItem = useItemQuickView((state) => state.open);
  const { items } = useMostBought();

  if (items.length === 0) return null;

  return (
    <Module title="Most bought" icon={ShoppingBag} layout={layout} accent="leaf">
      <ModuleBody layout={layout} variant="feature">
        {items.map((item, index) => (
          <FeatureRow
            key={item.item_id}
            layout={layout}
            rank={index + 1}
            image={item.image_url}
            name={item.name}
            detail={`${item.bought_count} bought · ${item.shop_name}`}
            fallbackIcon={Package}
            onClick={() => openItem(item.item_id)}
          />
        ))}
      </ModuleBody>
    </Module>
  );
}

function TrendingShops({ shops, layout }: { shops: StorefrontShop[]; layout: Layout }) {
  const navigate = useNavigate();
  const { profile } = useAuth();

  // Busiest first, by what the storefront already knows: how much they stock.
  // Three rather than four now these carry real pictures — four of them down a
  // sticky column pushes everything below the rail out of reach.
  const top = [...shops].sort((a, b) => b.itemCount - a.itemCount).slice(0, 3);
  if (top.length === 0) return null;

  return (
    <Module
      title="Shops with the most on"
      icon={Flame}
      layout={layout}
      accent="coral"
      action={{ label: 'All shops', onClick: () => navigate('/shops') }}
    >
      <ModuleBody layout={layout} variant="feature">
        {top.map((shop, index) => (
          <FeatureRow
            key={shop.id}
            layout={layout}
            rank={index + 1}
            // Cover first now the picture is large. A logo is drawn to sit in a
            // 40px square; stretched across a feature card it reads as a mistake.
            image={shop.cover_image_url ?? shop.image_url ?? shop.logo_url}
            name={shop.name}
            detail={`${shop.itemCount} item${shop.itemCount === 1 ? '' : 's'}${
              shop.location ? ` · ${shop.location}` : ''
            }`}
            fallbackIcon={Store}
            onClick={() => navigate(profile ? `/shop/${shop.id}` : '/signup')}
          />
        ))}
      </ModuleBody>
    </Module>
  );
}

/**
 * What is on promotion.
 *
 * Fed entirely from items the storefront has already fetched — is_discounted
 * with a real original_price_zmw above the current one. No query, no separate
 * "promos" concept to keep in step with the catalogue, and no way for a deal to
 * advertise a saving the item does not actually offer: discountPercentage is
 * the same function the product tiles use, and it returns null when the numbers
 * do not support a claim.
 */
function SpecialDeals({ items, layout }: { items: CatalogItem[]; layout: Layout }) {
  const openItem = useItemQuickView((state) => state.open);

  const deals = items
    .map((item) => ({ item, off: discountPercentage(item) }))
    .filter((entry): entry is { item: CatalogItem; off: number } => entry.off !== null)
    .sort((a, b) => b.off - a.off)
    .slice(0, 3);

  if (deals.length === 0) return null;

  return (
    <Module title="Special deals" icon={BadgePercent} layout={layout} accent="coral">
      <ModuleBody layout={layout} variant="feature">
        {deals.map(({ item, off }) => (
          <FeatureRow
            key={item.id}
            layout={layout}
            image={item.image_url ?? null}
            name={item.name}
            detail={`${off}% off · ${formatCurrency(item.price_zmw, 'ZMW')}`}
            fallbackIcon={Package}
            onClick={() => openItem(item.id)}
          />
        ))}
      </ModuleBody>
    </Module>
  );
}

function TopPicks({ items, layout }: { items: CatalogItem[]; layout: Layout }) {
  const openItem = useItemQuickView((state) => state.open);

  const picks = items.filter((item) => item.is_weekly_pick);
  const shown = (picks.length > 0 ? picks : items).slice(0, 3);
  if (shown.length === 0) return null;

  return (
    <Module title="This week's picks" icon={Sparkles} layout={layout} accent="berry">
      <ModuleBody layout={layout} variant="feature">
        {shown.map((item, index) => (
          <FeatureRow
            key={item.id}
            layout={layout}
            rank={index + 1}
            image={item.image_url ?? null}
            name={item.name}
            detail={formatCurrency(item.price_zmw, 'ZMW')}
            fallbackIcon={Package}
            onClick={() => openItem(item.id)}
          />
        ))}
      </ModuleBody>
    </Module>
  );
}

function MyLists({ layout }: { layout: Layout }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { owned, loading } = useMyLists();

  if (!user || loading || owned.length === 0) return null;

  return (
    <Module
      title="Your lists"
      icon={ListChecks}
      layout={layout}
      accent="leaf"
      action={{ label: 'All', onClick: () => navigate('/lists') }}
    >
      <ModuleBody layout={layout}>
        {owned.slice(0, 4).map((list) => (
          <Row
            key={list.id}
            layout={layout}
            image={list.preview_images[0] ?? null}
            name={list.title}
            detail={`${list.item_count} item${list.item_count === 1 ? '' : 's'}`}
            fallbackIcon={ListChecks}
            onClick={() => navigate(`/list/${list.slug}`)}
          />
        ))}
      </ModuleBody>
    </Module>
  );
}

function CommunityLists({ lists, layout }: { lists: ListSummary[]; layout: Layout }) {
  const navigate = useNavigate();
  if (lists.length === 0) return null;

  return (
    <Module title="Lists people are sharing" icon={ListChecks} layout={layout} accent="ink">
      <ModuleBody layout={layout}>
        {lists.slice(0, 3).map((list) => (
          <Row
            key={list.id}
            layout={layout}
            image={list.preview_images[0] ?? null}
            name={list.title}
            detail={`${list.item_count} item${list.item_count === 1 ? '' : 's'} · ${
              list.save_count
            } saved`}
            fallbackIcon={ListChecks}
            onClick={() => navigate(`/list/${list.slug}`)}
          />
        ))}
      </ModuleBody>
    </Module>
  );
}

/**
 * The desktop rail.
 *
 * Sticky under the page chrome and independently scrollable, so a long rail
 * never holds the feed hostage. Hidden below 1280px, where taking 300px from
 * the feed would cost more than the rail gives.
 */
/**
 * Which modules a face shows, and in what order.
 *
 * The registry is the whole point of the per-mode rail: a mode names the keys
 * it wants and gets those modules in that order. Adding a module later means
 * one entry here and one key in the mode definition — never a conditional in
 * the rail's markup.
 */
/**
 * Market Pulse — what the platform is actually doing, as counts.
 *
 * WHY IT IS BUILT ON pulse_statements AND NOT ON THE CHARTER'S FOUR ROWS
 * ---------------------------------------------------------------------
 * The charter asks for shoppers online, shops trading, gifts collected today
 * and held in escrow. Two of those cannot be answered honestly here:
 *
 *   - "shoppers online" has no source. Nothing in the schema records presence
 *     or visits, so the figure could only be invented, and the charter's own
 *     rule is that every counter must be one the schema can answer.
 *   - the platform-wide escrow total lives behind `escrow_position()`, which
 *     is REVOKE ALL / service_role. Putting it on a shopper's screen would
 *     mean a new SECURITY DEFINER function publishing a platform financial
 *     aggregate, which is a security decision and not a theming one.
 *
 * `pulse_statements` already answers the same question and was built on the
 * same principle -- it counts rows that exist, never seeds or estimates, and
 * refuses any cohort smaller than three because a count plus a precise time
 * identifies a person. So the panel says true things or says nothing.
 *
 * It renders the pool as a list rather than one-at-a-time the way PulseStrip
 * does: the strip is ambience you witness in passing, and this is a
 * dashboard. Same data, same honesty, different reading speed.
 */
function MarketPulse({ layout }: { layout: Layout }) {
  // The query lives in a hook, not here: components in this codebase do not
  // reach for the Supabase client, and the lint rule that enforces it is a
  // real architectural boundary rather than a style preference.
  const { statements: shown, loading } = useMarketPulse(4);

  // Hide the whole panel rather than render confident zeros. An empty week
  // looks like an empty week.
  if (loading || shown.length === 0) return null;

  return (
    /* Same panel in both presentations: an ink block is already the right
       shape for a ribbon, so unlike the white modules it needs no second
       skin. `layout` stays in the signature because renderModules passes it
       to every module uniformly. */
    <section className="rounded-[var(--radius-panel)] bg-ink p-[1.125rem]" data-layout={layout}>
      <header className="mb-3 flex items-center gap-2">
        <h3 className="kl-display text-[1.0625rem] leading-none text-on-ink">Market pulse</h3>
        {/* Live, and it means it: these counts were read this page load. */}
        <span className="ml-auto flex items-center gap-1.5">
          <span className="size-1.5 rounded-full bg-sage" aria-hidden />
          <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-on-ink-soft">
            Live
          </span>
        </span>
      </header>

      <dl className="space-y-2.5">
        {shown.map((statement) => (
          /* dt before dd in the DOM because that is what a definition list
             means; the figure is moved in front visually with `order`, so the
             reading order stays correct for anything not looking at it. */
          <div key={statementKey(statement)} className="flex items-baseline gap-2.5">
            <dt className="order-2 min-w-0 flex-1 truncate text-xs text-on-ink-soft">
              {statementLabel(statement)}
            </dt>
            <dd
              className={`kl-money order-1 shrink-0 text-[1.3125rem] leading-none ${
                statementIsPositive(statement) ? 'text-sage-on-ink' : 'text-on-ink'
              }`}
            >
              {statement.quantity}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function renderModules(keys: RailKeys, layout: Layout, props: RailProps) {
  return keys.map((key) => {
    switch (key) {
      case 'marketPulse':
        return <MarketPulse key={key} layout={layout} />;
      case 'status':
        return <StatusModule key={key} layout={layout} />;
      case 'occasions':
        return <Occasions key={key} layout={layout} />;
      case 'wishes':
        return <Wishes key={key} layout={layout} />;
      case 'specialDeals':
        return <SpecialDeals key={key} items={props.items} layout={layout} />;
      case 'mostBought':
        return <MostBought key={key} layout={layout} />;
      case 'trending':
        return <TrendingShops key={key} shops={props.shops} layout={layout} />;
      case 'picks':
        return <TopPicks key={key} items={props.items} layout={layout} />;
      case 'myLists':
        return <MyLists key={key} layout={layout} />;
      case 'communityLists':
        return <CommunityLists key={key} lists={props.lists} layout={layout} />;
      default:
        return null;
    }
  });
}

/**
 * The modules for the active mode, as a plain list.
 *
 * Exported so the phone drawer renders precisely what the desktop column
 * renders — the two presentations of the rail must never be two lists.
 */
export function StorefrontRailModules({
  layout = 'column',
  ...props
}: RailProps & { layout?: Layout }) {
  const { mode } = useStorefrontMode();
  return <>{renderModules(modeRail(mode), layout, props)}</>;
}

/**
 * One rail, on one side of the feed.
 *
 * `left` is the platform talking — what is popular, what is selling. `right` is
 * about you, and only appears when there is a feed worth flanking: the
 * storefront renders it when there are posts and leaves it out when there are
 * not, so an empty day collapses back to two columns rather than showing a
 * skinny column of nothing.
 *
 * Both are `xl:block` — below that the modules become ribbons in the feed and
 * the drawer, which take the whole set and know nothing about sides.
 */
export function StorefrontRail({ side = 'left', ...props }: RailProps & { side?: Side }) {
  const { mode } = useStorefrontMode();
  const keys = modeRailSide(mode, side);

  if (keys.length === 0) return null;

  return (
    <aside
      aria-label={side === 'left' ? 'Around the shop' : 'Waiting on you'}
      // empty:!hidden because a module deciding it has nothing to say is normal
      // — StatusModule hides its zeroes, Wishes hides when nobody has wished —
      // and a rail whose every module opted out would otherwise still reserve
      // 19rem of nothing beside the feed. The `!` is deliberate: it has to beat
      // the xl:block that put the column there in the first place.
      className={`kl-scroll sticky top-[calc(var(--kl-header-h)+4.25rem)] hidden
                 max-h-[calc(100vh-var(--kl-header-h)-5.5rem)] shrink-0
                 space-y-4 overflow-y-auto pb-8 empty:!hidden xl:block
                 ${side === 'right' ? 'w-[336px]' : 'w-[264px]'}`}
    >
      {renderModules(keys, 'column', props)}
    </aside>
  );
}

/**
 * The same modules on a narrow screen.
 *
 * Ribbons in the feed rather than a drawer: a rail hidden behind a button is a
 * rail nobody opens. Split into two groups so they can be dropped at different
 * depths — what is waiting on you belongs near the top, what is worth browsing
 * belongs further down.
 */
export function StorefrontStatusRibbon() {
  return (
    <div className="space-y-6 xl:hidden">
      <StatusModule layout="ribbon" />
    </div>
  );
}

