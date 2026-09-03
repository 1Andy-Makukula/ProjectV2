import { useCallback, useEffect, useRef } from 'react';
import { motion } from 'motion/react';
import { useDragRail } from '../../hooks/useDragRail';
import { useStorefrontMode } from '../../hooks/useStorefrontMode';
import { hapticTick } from '../../../utils/native';
import { STOREFRONT_MODES } from '../../types/storefrontModes';

/**
 * The faces the storefront can wear, as a rail you can throw.
 *
 * Clicking a chip was the only way in, which reads as a toolbar rather than as
 * something you move through. It now also answers a thumb swipe, a click-drag
 * and the arrow keys — all three from `useDragRail`, so the gesture logic is
 * not tangled into the markup and any other rail can have the same behaviour.
 *
 * The active chip is filled with the mode's own gradient, so the control both
 * indicates state and previews what the shopper is about to see.
 */
export function ModeSwitcher() {
  const { mode, setMode } = useStorefrontMode();
  const index = Math.max(
    0,
    STOREFRONT_MODES.findIndex((definition) => definition.value === mode),
  );

  // Wraps at both ends: the rail is a loop of five faces, not a list with a
  // dead end you have to swipe back out of.
  const step = useCallback(
    (delta: number) => {
      const next = (index + delta + STOREFRONT_MODES.length) % STOREFRONT_MODES.length;
      // Felt as well as seen: a swipe that changes the whole face of the page
      // should register in the hand.
      hapticTick();
      setMode(STOREFRONT_MODES[next].value);
    },
    [index, setMode],
  );

  const { ref, dragging, handlers } = useDragRail({
    onNext: () => step(1),
    onPrev: () => step(-1),
  });

  // Whatever changed the mode — a swipe, a key, or a click on a half-visible
  // chip — the selected one is brought into view.
  const chipRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    chipRefs.current[index]?.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest',
      inline: 'center',
    });
  }, [index]);

  return (
    <div
      ref={ref}
      role="tablist"
      aria-label="Browse by"
      tabIndex={0}
      {...handlers}
      className={`kl-rail scrollbar-none -mx-4 flex gap-2 overflow-x-auto px-4 py-1
                  outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2
                  sm:mx-0 sm:px-0 ${dragging ? 'kl-rail--dragging' : ''}`}
    >
      {STOREFRONT_MODES.map((definition, i) => {
        const Icon = definition.icon;
        const isActive = definition.value === mode;

        return (
          <button
            key={definition.value}
            ref={(node) => {
              chipRefs.current[i] = node;
            }}
            role="tab"
            aria-selected={isActive}
            // The rail owns the arrow keys, so only the selected chip is a tab
            // stop — the usual tablist pattern.
            tabIndex={isActive ? 0 : -1}
            onClick={() => setMode(definition.value)}
            className={`relative flex h-9 shrink-0 items-center gap-1.5 rounded-[var(--radius-pill)] px-4
                        text-xs font-semibold tracking-wide transition-colors duration-200
                        active:scale-[0.97]
                        ${
                          isActive
                            ? 'kl-glow text-white'
                            : 'kl-rim kl-float bg-background text-muted-foreground hover:text-foreground'
                        }`}
          >
            {isActive && (
              <motion.span
                layoutId="mode-chip"
                transition={{ type: 'spring', damping: 28, stiffness: 300 }}
                className="kl-gradient-mode absolute inset-0 rounded-[var(--radius-pill)]"
              />
            )}
            <Icon className="relative z-10 h-3.5 w-3.5 shrink-0" strokeWidth={2} />
            <span className="relative z-10">{definition.label}</span>
          </button>
        );
      })}
    </div>
  );
}
