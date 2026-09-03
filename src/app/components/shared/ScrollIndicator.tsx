import { useEffect, useRef, useState } from 'react';

/**
 * Where you are on the page, in KithLy's colours.
 *
 * The native scrollbar is still there underneath, slimmed and tinted — wheel,
 * drag, keyboard and assistive tech are untouched. This sits on top purely to
 * carry the moving gradient, which a real scrollbar cannot: browsers do not run
 * animations on scrollbar pseudo-elements.
 *
 * It fades in while you are moving and fades out a moment after you stop, so a
 * still page has nothing hanging off its edge.
 */
export function ScrollIndicator() {
  const barRef = useRef<HTMLDivElement | null>(null);
  const frame = useRef<number | null>(null);
  const idle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const bar = barRef.current;
    if (!bar) return;

    const measure = () => {
      frame.current = null;

      const doc = document.documentElement;
      const viewport = window.innerHeight;
      const total = doc.scrollHeight;
      const scrollable = total - viewport;

      // A page that does not scroll has no position worth reporting.
      if (scrollable <= 8) {
        setVisible(false);
        return;
      }

      // Length is the share of the page you can see, floored so it stays
      // grabbable-looking on very long pages.
      const height = Math.max(40, (viewport / total) * viewport);
      const progress = Math.min(1, Math.max(0, window.scrollY / scrollable));

      bar.style.height = `${height}px`;
      bar.style.transform = `translateY(${progress * (viewport - height)}px)`;

      setVisible(true);
      if (idle.current) clearTimeout(idle.current);
      idle.current = setTimeout(() => setVisible(false), 900);
    };

    const onScroll = () => {
      if (frame.current !== null) return;
      frame.current = requestAnimationFrame(measure);
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });

    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      if (idle.current) clearTimeout(idle.current);
    };
  }, []);

  return (
    <div
      ref={barRef}
      aria-hidden
      className={`kl-scroll-indicator ${visible ? 'kl-scroll-indicator--visible' : ''}`}
    />
  );
}
