import { useEffect, useRef, useState } from 'react';

interface ScrollDirectionOptions {
  /** How far down the page before anything is allowed to hide. */
  offset?: number;
  /** Downward travel needed to hide, so a jittery finger does not flicker it. */
  hideAfter?: number;
  /** Upward travel needed to bring it back. Deliberately tiny. */
  revealAfter?: number;
}

/**
 * Whether the page's top chrome should be out of the way.
 *
 * Asymmetric on purpose. Hiding takes a deliberate downward scroll, because
 * chrome that vanishes on the smallest twitch feels unstable — but reaching for
 * it is an intent, so the faintest upward movement brings it straight back.
 * That asymmetry is the whole trick to this pattern feeling responsive rather
 * than sticky.
 *
 * Reads are rAF-throttled: the scroll event fires far more often than the
 * screen redraws, and a state update per event is wasted work.
 */
export function useScrollDirection({
  offset = 72,
  hideAfter = 8,
  revealAfter = 2,
}: ScrollDirectionOptions = {}) {
  const [hidden, setHidden] = useState(false);
  const lastY = useRef(0);
  const frame = useRef<number | null>(null);

  useEffect(() => {
    lastY.current = window.scrollY;

    const measure = () => {
      frame.current = null;
      const y = window.scrollY;
      const delta = y - lastY.current;

      // The top of the page always shows everything: there is nothing to
      // reclaim, and it is where the page starts.
      if (y <= offset) {
        lastY.current = y;
        setHidden(false);
        return;
      }

      if (delta > hideAfter) {
        lastY.current = y;
        setHidden(true);
      } else if (delta < -revealAfter) {
        lastY.current = y;
        setHidden(false);
      }
      // Movement smaller than either bound is noise — leave both the state and
      // the reference point alone so small drifts accumulate into a real one.
    };

    const onScroll = () => {
      if (frame.current !== null) return;
      frame.current = requestAnimationFrame(measure);
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
  }, [offset, hideAfter, revealAfter]);

  return hidden;
}
