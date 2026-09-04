import { useCallback, useEffect, useRef, useState } from 'react';

interface DragRailOptions {
  /** Move the selection forward — the right arrow key. */
  onNext: () => void;
  /** Move the selection back — the left arrow key. */
  onPrev: () => void;
}

/**
 * A rail you can scroll, drag and drive from the keyboard.
 *
 * This hook used to interpret a swipe as "change the selection", which was a
 * mistake: it meant the rail could not be scrolled to reach a chip sitting off
 * the edge, so the only way to see the last option was to step through every
 * option before it. A menu you cannot scroll is not a menu.
 *
 * The responsibilities are now split, and the split is the whole design:
 *
 *   * this rail is a MENU — scroll it, click what you want;
 *   * the PAGE carries the gesture — a sideways swipe anywhere else changes
 *     face, which is `useScreenSwipe`, and it deliberately ignores gestures
 *     that begin inside a horizontal scroller like this one.
 *
 * So a thumb dragged across the rail scrolls the rail, and a thumb dragged
 * across the page changes the mode. Neither can be mistaken for the other.
 *
 * What remains here is what a browser does not give a rail for free:
 *
 *   * drag-to-pan with a mouse, since a mouse cannot flick a scroll container
 *     the way a finger or a trackpad can;
 *   * the arrow keys, which is the standard tablist behaviour and the only way
 *     to drive this without a pointer at all.
 *
 * Touch and trackpad scrolling are left entirely to the browser — a hand-rolled
 * momentum scroll never feels like the real one.
 */
export function useDragRail({ onNext, onPrev }: DragRailOptions) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState(false);

  // Lives in a ref, not in state: it changes on every pointermove and no render
  // depends on it.
  const pan = useRef<{ pointerId: number; startX: number; startScroll: number } | null>(null);

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const el = ref.current;
    // Only a mouse pans by drag. A finger already scrolls the rail itself, and
    // doing both at once moves it twice as fast as the thumb.
    if (!el || event.pointerType !== 'mouse') return;
    if (el.scrollWidth <= el.clientWidth + 1) return;

    pan.current = { pointerId: event.pointerId, startX: event.clientX, startScroll: el.scrollLeft };
    setDragging(true);
    el.setPointerCapture(event.pointerId);
  }, []);

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const el = ref.current;
    const active = pan.current;
    if (!el || !active || active.pointerId !== event.pointerId) return;

    el.scrollLeft = active.startScroll - (event.clientX - active.startX);
  }, []);

  const endPan = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const el = ref.current;
    const active = pan.current;
    pan.current = null;
    setDragging(false);

    if (!el || !active || active.pointerId !== event.pointerId) return;
    if (el.hasPointerCapture?.(event.pointerId)) el.releasePointerCapture(event.pointerId);
  }, []);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        onNext();
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        onPrev();
      }
    },
    [onNext, onPrev],
  );

  // A drag that ends outside the window would otherwise leave the rail stuck
  // showing its grabbing cursor.
  useEffect(() => {
    if (!dragging) return;

    const stop = () => {
      pan.current = null;
      setDragging(false);
    };

    window.addEventListener('pointercancel', stop);
    window.addEventListener('blur', stop);
    return () => {
      window.removeEventListener('pointercancel', stop);
      window.removeEventListener('blur', stop);
    };
  }, [dragging]);

  return {
    ref,
    dragging,
    handlers: {
      onPointerDown: handlePointerDown,
      onPointerMove: handlePointerMove,
      onPointerUp: endPan,
      onPointerLeave: endPan,
      onKeyDown: handleKeyDown,
    },
  };
}
