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

/** The shell every module shares: a titled tile, or a titled ribbon. */
function Module({
  title,
  icon: Icon,
  action,
  layout,
  children,
}: {
  title: string;
  icon: typeof Store;
  action?: { label: string; onClick: () => void };
  layout: Layout;
  children: React.ReactNode;
}) {
  return (
    <section className={layout === 'column' ? 'kl-tile p-4' : ''}>
      {/* The heading used to be 11px uppercase in muted grey. Every label on the
          page whispering at the same volume is what made the rail read as
          texture rather than as a set of things: nothing led the eye, so
          nothing was worth looking at first. This is the same title at a weight
          a heading should carry, in the foreground colour, and title-case
          rather than uppercase — at this size uppercase is shouting, and it is
          the size doing the work. */}
      <header className="mb-3 flex items-center gap-2">
        <Icon className="size-4 shrink-0 text-primary" strokeWidth={2} />
        <h3 className="kl-display text-[1.0625rem] font-semibold leading-tight text-foreground">
          {title}
        </h3>
        {action && (
          <button
            onClick={action.onClick}
            className="ml-auto inline-flex items-center gap-0.5 text-[0.6875rem] font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            {action.label}
            <ArrowRight className="size-3" strokeWidth={2} />
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
      className={`kl-rim kl-float group flex items-center gap-2.5 rounded-[var(--radius-lg)]
                  bg-card p-2 text-left transition-colors hover:bg-accent
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
        <p className="truncate text-[0.8125rem] font-medium">{name}</p>
        <p className="truncate text-[0.6875rem] font-light text-muted-foreground">{detail}</p>
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
    <button
      onClick={onClick}
      className={`kl-rim kl-float group flex items-center gap-2.5 rounded-[var(--radius-lg)]
                  bg-card p-2 text-left transition-colors hover:bg-accent
                  ${layout === 'ribbon' ? '' : 'w-full'}`}
    >
      <div className="relative size-14 shrink-0 overflow-hidden rounded-[var(--radius-md)] bg-muted">
        {image ? (
          <img src={image} alt="" loading="lazy" className="h-full w-full object-cover" />
        ) : (
          <div className="grid h-full w-full place-items-center">
            <Fallback className="size-5 text-muted-foreground/30" strokeWidth={1.25} />
          </div>
        )}
        {rank !== undefined && (
          <span
            aria-hidden
            className="absolute left-0.5 top-0.5 grid size-4 place-items-center rounded-full
                       bg-card/90 text-[0.625rem] font-semibold tabular-nums
                       text-foreground shadow-sm"
          >
            {rank}
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[0.8125rem] font-medium leading-tight">{name}</p>
        <p className="mt-0.5 truncate text-[0.6875rem] font-light text-muted-foreground">
          {detail}
        </p>
      </div>
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
      tone: 'text-[var(--success)]',
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
    <Module title="Your status" icon={Sparkles} layout={layout}>
      <div className={layout === 'ribbon' ? 'kl-rim kl-float rounded-[var(--radius-tile)] p-1' : ''}>
        {lines.map((line) => {
          const Icon = line.icon;
          return (
            <button
              key={line.key}
              onClick={line.onClick}
              className="flex w-full items-center gap-2 rounded-[var(--radius-lg)] px-2 py-1.5 text-left transition-colors hover:bg-accent"
            >
              <Icon className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={2} />
              <span className="flex-1 truncate text-[0.8125rem] font-light">{line.label}</span>
              <span className={`text-[0.8125rem] font-semibold tabular-nums ${line.tone}`}>
                {line.value}
              </span>
            </button>
          );
        })}
      </div>
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
    <Module title="Wishes from people you know" icon={Gift} layout={layout}>
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
    <Module title="Most bought" icon={ShoppingBag} layout={layout}>
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
    <Module title="Special deals" icon={BadgePercent} layout={layout}>
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
    <Module title="This week's picks" icon={Sparkles} layout={layout}>
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
    <Module title="Lists people are sharing" icon={ListChecks} layout={layout}>
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
function renderModules(keys: RailKeys, layout: Layout, props: RailProps) {
  return keys.map((key) => {
    switch (key) {
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
      className="kl-scroll sticky top-32 hidden max-h-[calc(100vh-9rem)] w-[19rem] shrink-0
                 space-y-4 overflow-y-auto pb-8 empty:!hidden xl:block"
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

