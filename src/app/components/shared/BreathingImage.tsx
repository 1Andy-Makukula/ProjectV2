// BreathingImage — a tile that shows what else there is.
//
// One picture is what a shop had to show before. An item with five photographs
// has four more reasons to look, and a shop has its own front and then what is
// inside it. This cycles them slowly, in time with every other tile on the
// page, because the Conductor gives them all the same clock.
//
// HOW IT STAYS CHEAP
// ------------------
// The Conductor only reports slot changes -- an integer, several seconds apart
// -- so this re-renders about as often as a clock's minute hand. The
// cross-fade itself is a CSS opacity transition on two stacked images, which
// the compositor runs without touching the main thread.
//
// Every frame is in the DOM from the start, so a fade never waits on a network
// request. That is the trade: a few more bytes of <img> up front in exchange
// for never showing a blank tile mid-cycle. `loading="lazy"` on everything but
// the cover keeps the fetch off the critical path.

import { useEffect, useRef, useState } from 'react';
import { subscribe } from '../../reco/conductor';

interface BreathingImageProps {
  /** Stable id — decides this tile's place in the wave. Never random. */
  id: string;
  /** Cover first. Anything after it is what the tile breathes through. */
  sources: string[];
  alt: string;
  className?: string;
  /** Applied to each frame; this is where object-fit and sizing go. */
  imageClassName?: string;
  fallback?: React.ReactNode;
}

export function BreathingImage({
  id,
  sources,
  alt,
  className = '',
  imageClassName = '',
  fallback,
}: BreathingImageProps) {
  const frames = sources.filter(Boolean);
  const [slot, setSlot] = useState(0);
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (frames.length <= 1) return;

    const handle = subscribe(id, frames.length, setSlot);

    // Only tiles on screen are allowed to spend the motion budget, and the
    // Conductor cannot know what is visible -- so it is told.
    const host = hostRef.current;
    let observer: IntersectionObserver | null = null;

    if (host && typeof IntersectionObserver !== 'undefined') {
      observer = new IntersectionObserver(
        ([entry]) => handle.setVisible(entry.isIntersecting),
        { rootMargin: '0px', threshold: 0.35 },
      );
      observer.observe(host);
    } else {
      // No observer to ask, so assume visible rather than freeze the tile.
      handle.setVisible(true);
    }

    return () => {
      observer?.disconnect();
      handle.unsubscribe();
    };
  }, [id, frames.length]);

  if (frames.length === 0) {
    return <div className={className}>{fallback}</div>;
  }

  return (
    <div ref={hostRef} className={`relative ${className}`}>
      {frames.map((src, index) => (
        <img
          key={src}
          src={src}
          alt={index === 0 ? alt : ''}
          // Only the first frame is announced; the rest are the same subject
          // from another angle and would just repeat themselves to a reader.
          aria-hidden={index === 0 ? undefined : true}
          loading={index === 0 ? undefined : 'lazy'}
          draggable={false}
          className={`absolute inset-0 transition-opacity duration-[1200ms] ease-in-out
                      ${index === slot ? 'opacity-100' : 'opacity-0'} ${imageClassName}`}
        />
      ))}
    </div>
  );
}

export default BreathingImage;
