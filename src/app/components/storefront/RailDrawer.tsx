import { EdgeDrawer } from './EdgeDrawer';
import { StorefrontRailModules } from './StorefrontRail';
import type { StorefrontShop } from '../../hooks/useStorefrontData';
import type { CatalogItem } from '../../types/items';
import type { ListSummary } from '../../types/lists';

interface RailDrawerProps {
  shops: StorefrontShop[];
  items: CatalogItem[];
  lists: ListSummary[];
}

/**
 * The rail, on a phone.
 *
 * Same modules as the desktop column — imported, not reimplemented, so the two
 * cannot drift. What changes is how you get to it: dragged in from the left
 * edge, which is the gesture both platforms already teach for a drawer. That
 * gesture, the edge handle and the sheet now live in EdgeDrawer, because the
 * shop page wanted the same behaviour around different content.
 *
 * There is deliberately no third floating button. The corner already carries
 * the cart and the way home, and a screen where every corner holds a bubble is
 * a screen with no room left for shopping. The affordance is instead a slim
 * handle on the edge, tinted by the active mode — visible enough to be found,
 * quiet enough to be ignored.
 */
export function RailDrawer(props: RailDrawerProps) {
  return (
    <EdgeDrawer
      title="Around the shop"
      description="What is waiting on you, and what is worth a look."
    >
      <StorefrontRailModules {...props} layout="column" />
    </EdgeDrawer>
  );
}
