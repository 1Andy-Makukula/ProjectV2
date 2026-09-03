import { useEffect, useRef } from 'react';

interface ScreenSwipeOptions {
  onNext: () => void;
  onPrev: () => void;
  /** Off on wide screens, where there is no thumb to swipe with. */
  enabled?: boolean;
  /** How far a swipe must travel across the screen to count. */
  threshold?: number;
  /**
   * How much of each side belongs to the system and to the drawer.
   *
   * The left strip is the rail drawer's pull and iOS's back gesture; the right
   * is the forward gesture. A page-wide swipe that also claimed the edges would
   * fight both.
   */
  edgeGuard?: number;
}

/**
 * Swipe anywhere to change face.
 *
 * The mode rail could already be swiped, but it is a thin strip at the top of
 * a tall page — by the time somebody has scrolled into the feed, the control
 * that switches faces is off-screen. On a phone the natural gesture is to push
 * the whole page sideways, so that is what this listens for.
 *
 * Three things have to keep working underneath it, and each is a rule:
 *
 *   * vertical scrolling, which is most of what anyone does — a gesture that
 *     travels further down than across is never a swipe;
 *   * horizontal scrollers inside the page (the ribbons, the mode rail
 *     itself) — a swipe that starts inside one belongs to it, so the walk up
 *     the tree below hands the gesture over;
 *   * the screen edges, which belong to the drawer and to the system.
 *
 * Listeners are passive: this never calls preventDefault, so it cannot make
 * the page feel sticky even when it decides the gesture was not for it.
 */
export function useScreenSwipe({
  onNext,
  onPrev,
  enabled = true,
  threshold = 64,
  edgeGuard = 28,
}: ScreenSwipeOptions) {
  const gesture = useRef<{ x: number; y: number; drifted: boolean } | null>(null);

  useEffect(() => {
    if (!enabled) return;

    const onStart = (event: TouchEvent) => {
      // Two fingers is a pinch or a zoom, never a page swipe.
      if (event.touches.length !== 1) {
        gesture.current = null;
        return;
      }

      const touch = event.touches[0];
      const width = window.innerWidth;
      if (touch.clientX < edgeGuard || touch.clientX > width - edgeGuard) return;
      if (startsInsideHorizontalScroller(event.target)) return;

      gesture.current = { x: touch.clientX, y: touch.clientY, drifted: false };
    };

    const onMove = (event: TouchEvent) => {
      const active = gesture.current;
      const touch = event.touches[0];
      if (!active || !touch) return;

      // Once a gesture has committed to going down the page it stays the
      // page's, however far sideways it wanders afterwards.
      if (Math.abs(touch.clientY - active.y) > Math.abs(touch.clientX - active.x)) {
        active.drifted = true;
      }
    };

    const onEnd = (event: TouchEvent) => {
      const active = gesture.current;
      gesture.current = null;

      const touch = event.changedTouches[0];
      if (!active || !touch || active.drifted) return;

      const dx = touch.clientX - active.x;
      const dy = touch.clientY - active.y;

      // Decisively sideways: far enough, and clearly more across than down.
      if (Math.abs(dx) < threshold || Math.abs(dx) < Math.abs(dy) * 1.5) return;

      if (dx < 0) onNext();
      else onPrev();
    };

    window.addEventListener('touchstart', onStart, { passive: true });
    window.addEventListener('touchmove', onMove, { passive: true });
    window.addEventListener('touchend', onEnd, { passive: true });
    window.addEventListener('touchcancel', () => (gesture.current = null), { passive: true });

    return () => {
      window.removeEventListener('touchstart', onStart);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);
    };
  }, [enabled, onNext, onPrev, threshold, edgeGuard]);
}

/**
 * Whether the gesture began inside something that scrolls sideways of its own.
 *
 * Walks up from the touched node looking for an element wider than its own box
 * with an overflow that allows scrolling. A ribbon of shop cards is exactly
 * that, and swiping one should move the ribbon rather than the whole
 * storefront.
 */
function startsInsideHorizontalScroller(target: EventTarget | null): boolean {
  let node = target instanceof Element ? target : null;

  while (node && node !== document.body) {
    // The mode rail says so directly: it is a carousel with its overflow
    // hidden, so measuring it would not reveal what it is.
    if (node.classList?.contains('kl-rail')) return true;

    if (node.scrollWidth > node.clientWidth + 1) {
      const overflowX = getComputedStyle(node).overflowX;
      if (overflowX === 'auto' || overflowX === 'scroll') return true;
    }

    node = node.parentElement;
  }

  return false;
}
