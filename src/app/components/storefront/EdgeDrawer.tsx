// A panel pulled in from the left edge, on the widths where a rail cannot fit.
//
// Extracted from RailDrawer when the shop page needed the same behaviour for
// different content. The gesture, the handle and the sheet are the thing worth
// sharing — a second copy would have been a second set of edge-zone constants
// and a second chance for the two to teach different gestures for the same
// affordance.

import { useEffect, useRef, useState } from 'react';
import { PanelRightClose } from 'lucide-react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '../ui/sheet';
import { hapticTick } from '../../../utils/native';

/** How far in from the left edge a drag has to start to count as an edge pull. */
const EDGE_ZONE = 24;
/** How far it has to travel before the drawer opens. */
const PULL_DISTANCE = 56;

interface EdgeDrawerProps {
  title: string;
  description: string;
  children: React.ReactNode;
  /** Where the drawer stops existing because a real column takes over. */
  hiddenFrom?: 'lg' | 'xl';
}

export function EdgeDrawer({
  title,
  description,
  children,
  hiddenFrom = 'xl',
}: EdgeDrawerProps) {
  const [open, setOpen] = useState(false);
  const gesture = useRef<{ startX: number; startY: number } | null>(null);

  useEffect(() => {
    // Only worth listening on the widths where the drawer exists; above the
    // breakpoint the rail is a column and this is dead weight.
    const query = hiddenFrom === 'lg' ? '(max-width: 1023px)' : '(max-width: 1279px)';
    const narrow = window.matchMedia(query);
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
  }, [hiddenFrom]);

  const hiddenClass = hiddenFrom === 'lg' ? 'lg:hidden' : 'xl:hidden';

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
        aria-label={`Open ${title.toLowerCase()}`}
        className={`kl-gradient-mode fixed left-0 top-1/2 z-40 h-16 w-1.5 -translate-y-1/2
                    rounded-r-[var(--radius-pill)] opacity-70 transition-opacity
                    hover:opacity-100 focus-visible:opacity-100 ${hiddenClass}`}
      />

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="left"
          className="kl-scroll w-[86vw] max-w-sm overflow-y-auto p-0 sm:w-[22rem]"
        >
          <SheetHeader className="sticky top-0 z-10 border-b border-border bg-card/90 px-5 py-4 backdrop-blur-md">
            <SheetTitle className="flex items-center gap-2 text-base">
              <PanelRightClose className="size-4 text-primary" strokeWidth={2} />
              {title}
            </SheetTitle>
            <SheetDescription className="text-xs font-light">{description}</SheetDescription>
          </SheetHeader>

          <div className="space-y-4 px-4 py-4">{children}</div>
        </SheetContent>
      </Sheet>
    </>
  );
}
