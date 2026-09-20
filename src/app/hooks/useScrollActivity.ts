import { useEffect } from 'react';

/**
 * Marks the document as moving or still, as `data-scroll` on the root element.
 *
 * A CSS concern answered in CSS: anything that wants to behave differently
 * while the page is in motion reads `:root[data-scroll='moving']` and never
 * needs the boolean in React. That matters because the things that care are
 * decorative — the glass sheen on the header and the mode rail — and routing a
 * per-scroll boolean through component state to reach them would re-render
 * half the page on every frame of every scroll, to move a gradient.
 *
 * Called once, in the Root layout, so the whole app shares one listener. It is
 * deliberately NOT folded into useScrollDirection: that hook answers "which
 * way, and enough to act on", this one answers "at all, right now", and the
 * two want opposite things from a threshold.
 *
 * Writes happen on the edges only — entering motion, and settling — not per
 * event, so a long scroll is two attribute writes rather than two hundred.
 */
export function useScrollActivity(settleMs = 180) {
  useEffect(() => {
    const root = document.documentElement;
    let settleTimer: number | undefined;
    let moving = false;

    const settle = () => {
      moving = false;
      root.dataset.scroll = 'idle';
    };

    const onScroll = () => {
      if (!moving) {
        moving = true;
        root.dataset.scroll = 'moving';
      }
      // Restarted on every event, so "still" means genuinely still rather than
      // a gap between two flicks of a trackpad. Momentum scrolling on iOS
      // keeps firing the whole way through the glide, which is exactly the
      // behaviour we want — the page is still moving, so the sheen stays out.
      window.clearTimeout(settleTimer);
      settleTimer = window.setTimeout(settle, settleMs);
    };

    root.dataset.scroll = 'idle';
    window.addEventListener('scroll', onScroll, { passive: true });

    return () => {
      window.removeEventListener('scroll', onScroll);
      window.clearTimeout(settleTimer);
      // Left unset rather than 'idle': the attribute means "something is
      // watching", and on the way out nothing is.
      delete root.dataset.scroll;
    };
  }, [settleMs]);
}
