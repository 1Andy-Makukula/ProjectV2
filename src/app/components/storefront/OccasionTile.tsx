import { useEffect, useRef, useState } from 'react';

/**
 * One panel of the bento: a photograph that breathes, under a frosted plate.
 *
 * WHY THE IMAGES ROTATE
 * ---------------------
 * An occasion is not one product, and a single still makes it look like one.
 * Cycling the photographs a shop has already attached to its bundles shows the
 * breadth of what "Monthly Essentials" actually buys without a word of copy —
 * and costs nothing to maintain, because the pictures are the merchandising
 * that was done anyway.
 *
 * Crossfade rather than slide: a slide competes with the page scroll and turns
 * a calm grid into a carousel fighting for attention.
 *
 * WHY THE PLATE
 * -------------
 * Type straight on a photograph is legible only by luck. A white coat behind
 * "Health & Care", a pale wall behind "Furniture", and the word is gone. The
 * plate is .kl-glass over .kl-scrim, so the picture stays bright and the words
 * stay readable whichever frame happens to be showing.
 */

/** Long enough to be noticed rather than watched. */
const DWELL_MS = 5200;
const FADE_MS = 900;

interface OccasionTileProps {
  title: string;
  /** Sits under the title. Omitted on the smallest panels. */
  subtitle?: string;
  images: string[];
  /** Tailwind classes for the span and minimum height of this panel. */
  span: string;
  /** Drives the size of the title; the bento's larger panels carry larger type. */
  scale: 'sm' | 'md' | 'lg';
  /** Staggers the crossfade so the grid never changes all at once. */
  phase?: number;
  /** Replaces the photograph on the synthetic panels. */
  gradient?: boolean;
  onOpen: () => void;
}

const TITLE_SIZE: Record<OccasionTileProps['scale'], string> = {
  sm: 'text-xl sm:text-2xl',
  md: 'text-2xl sm:text-3xl',
  lg: 'text-3xl sm:text-4xl lg:text-5xl',
};

export function OccasionTile({
  title,
  subtitle,
  images,
  span,
  scale,
  phase = 0,
  gradient = false,
  onOpen,
}: OccasionTileProps) {
  const [frame, setFrame] = useState(0);
  const reduced = useRef(false);

  useEffect(() => {
    reduced.current =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

    // One photograph is a still life, and anybody who asked the system for less
    // movement gets the first frame and nothing else.
    if (images.length < 2 || reduced.current) return;

    let interval: ReturnType<typeof setInterval>;
    const start = setTimeout(() => {
      interval = setInterval(() => {
        setFrame((f) => (f + 1) % images.length);
      }, DWELL_MS);
    }, phase);

    return () => {
      clearTimeout(start);
      clearInterval(interval);
    };
  }, [images.length, phase]);

  return (
    <button
      onClick={onOpen}
      className={`kl-scrim group relative flex items-end overflow-hidden rounded-[var(--radius-tile)] p-4 text-left shadow-[var(--shadow-float)] transition-[box-shadow,transform] duration-300 hover:-translate-y-0.5 hover:shadow-[var(--shadow-lift)] sm:p-5 ${span}`}
    >
      {gradient || images.length === 0 ? (
        <div className="kl-gradient-brand-br absolute inset-0" />
      ) : (
        images.map((src, i) => (
          <img
            key={src}
            src={src}
            alt=""
            aria-hidden="true"
            loading="lazy"
            className="absolute inset-0 h-full w-full object-cover transition-opacity ease-in-out motion-reduce:transition-none"
            style={{
              opacity: i === frame ? 1 : 0,
              transitionDuration: `${FADE_MS}ms`,
            }}
          />
        ))
      )}

      <div className="kl-glass kl-rim relative z-[3] max-w-[92%] rounded-[var(--radius-lg)] px-4 py-3">
        <span
          className={`block font-semibold leading-[1.05] tracking-tight ${TITLE_SIZE[scale]}`}
        >
          {title}
        </span>
        {subtitle && (
          <span className="mt-1 block text-[0.75rem] font-light leading-snug opacity-75 sm:text-xs">
            {subtitle}
          </span>
        )}
      </div>
    </button>
  );
}
