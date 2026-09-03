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
import { countdownLabel, upcomingBirthdays } from '../../types/contacts';
import { formatCurrency } from '../../../utils/currency';
import { useStorefrontMode } from '../../hooks/useStorefrontMode';
import { OCCASION_ICON, modeLexicon, modeRail } from '../../types/storefrontModes';
import type { StorefrontShop } from '../../hooks/useStorefrontData';
import type { CatalogItem } from '../../types/items';
import type { ListSummary } from '../../types/lists';

type Layout = 'column' | 'ribbon';
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
      <header className="mb-3 flex items-center gap-1.5">
        <Icon className="size-3.5 text-primary" strokeWidth={2} />
        <h3 className="text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
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
function ModuleBody({ layout, children }: { layout: Layout; children: React.ReactNode }) {
  return layout === 'column' ? (
    <div className="space-y-1">{children}</div>
  ) : (
    <div className="kl-scroll -mx-4 flex gap-3 overflow-x-auto px-4 pb-1 [&>*]:w-44 [&>*]:shrink-0">
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
      className={`group flex items-center gap-2.5 rounded-[var(--radius-lg)] p-1.5 text-left
                  transition-colors hover:bg-accent
                  ${layout === 'ribbon' ? 'kl-rim kl-float bg-background' : 'w-full'}`}
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

  const upcoming = upcomingBirthdays(contacts, 60).slice(0, 4);

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
              ? 'Save the people you send to, and their birthdays turn up here.'
              : 'Add a birthday to someone and it will appear here.'}
          </button>
        ) : (
          <div className="space-y-0.5">
            {upcoming.map(({ contact, days }) => (
              <button
                key={contact.id}
                onClick={() => navigate('/contacts')}
                className="flex w-full items-baseline gap-2 rounded-[var(--radius-lg)] px-1.5 py-1.5 text-left transition-colors hover:bg-accent"
              >
                <span className="truncate text-[0.8125rem] font-medium">{contact.name}</span>
                {contact.relationship && (
                  <span className="shrink-0 text-[0.6875rem] font-light text-muted-foreground">
                    {contact.relationship}
                  </span>
                )}
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

function TrendingShops({ shops, layout }: { shops: StorefrontShop[]; layout: Layout }) {
  const navigate = useNavigate();
  const { profile } = useAuth();

  // Busiest first, by what the storefront already knows: how much they stock.
  const top = [...shops].sort((a, b) => b.itemCount - a.itemCount).slice(0, 4);
  if (top.length === 0) return null;

  return (
    <Module
      title="Shops with the most on"
      icon={Flame}
      layout={layout}
      action={{ label: 'All shops', onClick: () => navigate('/shops') }}
    >
      <ModuleBody layout={layout}>
        {top.map((shop) => (
          <Row
            key={shop.id}
            layout={layout}
            image={shop.logo_url ?? shop.cover_image_url ?? shop.image_url}
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

function TopPicks({ items, layout }: { items: CatalogItem[]; layout: Layout }) {
  const navigate = useNavigate();

  const picks = items.filter((item) => item.is_weekly_pick);
  const shown = (picks.length > 0 ? picks : items).slice(0, 4);
  if (shown.length === 0) return null;

  return (
    <Module title="This week's picks" icon={Sparkles} layout={layout}>
      <ModuleBody layout={layout}>
        {shown.map((item) => (
          <Row
            key={item.id}
            layout={layout}
            image={item.image_url ?? null}
            name={item.name}
            detail={formatCurrency(item.price_zmw, 'ZMW')}
            fallbackIcon={Package}
            onClick={() => navigate(`/item/${item.id}`)}
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

export function StorefrontRail(props: RailProps) {
  const { mode } = useStorefrontMode();

  return (
    <aside
      aria-label="Around the shop"
      className="kl-scroll sticky top-32 hidden max-h-[calc(100vh-9rem)] w-[19rem] shrink-0
                 space-y-4 overflow-y-auto pb-8 xl:block"
    >
      {renderModules(modeRail(mode), 'column', props)}
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

