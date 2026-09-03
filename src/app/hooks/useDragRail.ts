import { useCallback, useEffect, useRef, useState } from 'react';

interface DragRailOptions {
  /** Move forward — a leftward swipe, or the right arrow key. */
  onNext: () => void;
  /** Move back — a rightward swipe, or the left arrow key. */
  onPrev: () => void;
  /** How far a gesture must travel, in pixels, before it counts. */
  threshold?: number;
  /** Accumulated horizontal wheel travel before a trackpad swipe counts. */
  wheelThreshold?: number;
}

/**
 * One horizontal control, every way of driving it, both directions each.
 *
 * Nothing here replaces clicking — a chip is still a button, and tapping one
 * jumps straight to it. These are the ways of moving *through* the rail for
 * people who never think to aim at a target:
 *
 *   * a thumb swipe on a phone
 *   * grab-and-drag with a mouse
 *   * two fingers on a trackpad, which is how a laptop swipes
 *   * the arrow keys
 *
 * The rail is treated as a carousel rather than as a scroller. An earlier
 * version panned the strip when its contents overflowed and only changed
 * selection when they fit, which meant the same gesture did different things on
 * different screens — and on a phone, where the chips always overflow, a swipe
 * never selected anything. Now a decisive gesture always moves one step, and
 * the strip scrolls itself to follow the selection.
 */
export function useDragRail({
  onNext,
  onPrev,
  threshold = 40,
  wheelThreshold = 60,
}: DragRailOptions) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState(false);

  // Lives in a ref, not in state: it changes on every pointer event and no
  // render depends on it.
  const gesture = useRef<{ pointerId: number; startX: number; startY: number } | null>(null);

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el) return;

    gesture.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
    };
    setDragging(true);

    // Capture only the mouse. Capturing touch would take the pointer away from
    // the browser mid-gesture and kill vertical page scrolling.
    if (event.pointerType === 'mouse') el.setPointerCapture(event.pointerId);
  }, []);

  const endGesture = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const el = ref.current;
      const active = gesture.current;
      gesture.current = null;
      setDragging(false);

      if (!el || !active || active.pointerId !== event.pointerId) return;
      if (el.hasPointerCapture?.(event.pointerId)) el.releasePointerCapture(event.pointerId);

      const dx = event.clientX - active.startX;
      const dy = event.clientY - active.startY;

      // Ignore anything that was really a vertical scroll that happened to
      // start on the rail.
      if (Math.abs(dx) < threshold || Math.abs(dx) <= Math.abs(dy)) return;

      if (dx < 0) onNext();
      else onPrev();
    },
    [onNext, onPrev, threshold],
  );

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

  /**
   * Two fingers on a trackpad.
   *
   * A horizontal trackpad swipe arrives as a stream of wheel events with a
   * deltaX, not as a pointer gesture, so it needs its own listener — and a
   * native one, because React's wheel handler is passive and cannot call
   * preventDefault. Without that call the browser reads the same gesture as
   * "go back" and navigates away from the page.
   *
   * The deltas are accumulated rather than acted on individually: one flick is
   * dozens of events, and each is only a few pixels. After a step is taken the
   * rail stays deaf until the gesture stops, otherwise a single swipe would
   * skip through every mode at once.
   */
  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let travel = 0;
    let locked = false;
    let settle: ReturnType<typeof setTimeout> | null = null;

    const onWheel = (event: WheelEvent) => {
      // A vertical scroll that happens to pass over the rail belongs to the
      // page, not to us.
      if (Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return;

      event.preventDefault();

      if (settle) clearTimeout(settle);
      settle = setTimeout(() => {
        travel = 0;
        locked = false;
      }, 220);

      if (locked) return;

      travel += event.deltaX;
      if (Math.abs(travel) < wheelThreshold) return;

      locked = true;
      if (travel > 0) onNext();
      else onPrev();
      travel = 0;
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', onWheel);
      if (settle) clearTimeout(settle);
    };
  }, [onNext, onPrev, wheelThreshold]);

  // A drag that ends outside the window would otherwise leave the rail stuck
  // showing its grabbing cursor.
  useEffect(() => {
    if (!dragging) return;

    const stop = () => {
      gesture.current = null;
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
      onPointerUp: endGesture,
      onPointerLeave: endGesture,
      onKeyDown: handleKeyDown,
    },
  };
}
