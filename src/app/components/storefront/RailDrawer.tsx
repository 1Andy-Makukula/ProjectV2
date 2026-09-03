import { useEffect, useRef, useState } from 'react';
import { PanelRightClose } from 'lucide-react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '../ui/sheet';
import { StorefrontRailModules } from './StorefrontRail';
import { hapticTick } from '../../../utils/native';
import type { StorefrontShop } from '../../hooks/useStorefrontData';
import type { CatalogItem } from '../../types/items';
import type { ListSummary } from '../../types/lists';

interface RailDrawerProps {
  shops: StorefrontShop[];
  items: CatalogItem[];
  lists: ListSummary[];
}

/** How far in from the left edge a drag has to start to count as an edge pull. */
const EDGE_ZONE = 24;
/** How far it has to travel before the drawer opens. */
const PULL_DISTANCE = 56;

/**
 * The rail, on a phone.
 *
 * Same modules as the desktop column — imported, not reimplemented, so the two
 * cannot drift. What changes is how you get to it: dragged in from the left
 * edge, which is the gesture both platforms already teach for a drawer.
 *
 * There is deliberately no third floating button. The corner already carries
 * the cart and the way home, and a screen where every corner holds a bubble is
 * a screen with no room left for shopping. The affordance is instead a slim
 * handle on the edge, tinted by the active mode — visible enough to be found,
 * quiet enough to be ignored.
 */
export function RailDrawer(props: RailDrawerProps) {
  const [open, setOpen] = useState(false);
  const gesture = useRef<{ startX: number; startY: number } | null>(null);

  useEffect(() => {
    // Only worth listening on the widths where the drawer exists; above 1280
    // the rail is a column and this is dead weight.
    const narrow = window.matchMedia('(max-width: 1279px)');
    if (!narrow.matches) return;

    const onStart = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!touch || touch.clientX > EDGE_ZONE) return;
      gesture.current = { startX: touch.clientX, startY: touch.clientY };
    };

    const onMove = (event: TouchEvent) => {
      const active = gesture.current;
      const touch = event.touches[0];
      if (!active || !touch) return;

      const dx = touch.clientX - active.startX;
      const dy = touch.clientY - active.startY;

      // A vertical drag that happened to begin near the edge is the page
      // scrolling, and must be left alone.
      if (Math.abs(dy) > Math.abs(dx)) {
        gesture.current = null;
        return;
      }

      if (dx > PULL_DISTANCE) {
        gesture.current = null;
        hapticTick();
        setOpen(true);
      }
    };

    const clear = () => {
      gesture.current = null;
    };

    // Passive: the drawer opens on the gesture, it never fights the scroll.
    window.addEventListener('touchstart', onStart, { passive: true });
    window.addEventListener('touchmove', onMove, { passive: true });
    window.addEventListener('touchend', clear, { passive: true });
    window.addEventListener('touchcancel', clear, { passive: true });

    return () => {
      window.removeEventListener('touchstart', onStart);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', clear);
      window.removeEventListener('touchcancel', clear);
    };
  }, []);

  return (
    <>
      {/* The handle. Sits against the left edge, below the sticky chrome and
          clear of the thumb's resting place, and does nothing but say the edge
          is draggable — tapping it opens the same drawer. */}
      <button
        onClick={() => {
          hapticTick();
          setOpen(true);
        }}
        aria-label="Open the side panel"
        className="kl-gradient-mode fixed left-0 top-1/2 z-40 h-16 w-1.5 -translate-y-1/2
                   rounded-r-[var(--radius-pill)] opacity-70 transition-opacity
                   hover:opacity-100 focus-visible:opacity-100 xl:hidden"
      />

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="left"
          className="kl-scroll w-[86vw] max-w-sm overflow-y-auto p-0 sm:w-[22rem]"
        >
          <SheetHeader className="sticky top-0 z-10 border-b border-border bg-background/90 px-5 py-4 backdrop-blur-md">
            <SheetTitle className="flex items-center gap-2 text-base">
              <PanelRightClose className="size-4 text-primary" strokeWidth={2} />
              Around the shop
            </SheetTitle>
            <SheetDescription className="text-xs font-light">
              What is waiting on you, and what is worth a look.
            </SheetDescription>
          </SheetHeader>

          <div className="space-y-4 px-4 py-4">
            <StorefrontRailModules {...props} layout="column" />
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
