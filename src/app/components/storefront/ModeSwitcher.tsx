import { useCallback, useEffect, useRef } from 'react';
import { motion } from 'motion/react';
import { useDragRail } from '../../hooks/useDragRail';
import { useStorefrontMode } from '../../hooks/useStorefrontMode';
import { hapticTick } from '../../../utils/native';
import { STOREFRONT_MODES } from '../../types/storefrontModes';

/**
 * The faces the storefront can wear, as a menu.
 *
 * Everything here is aimed at reaching a chip and pressing it: scroll the rail
 * with a thumb, a trackpad or a mouse drag, walk it with the arrow keys, and
 * click what you want. On every screen, by every means.
 *
 * Changing face by *gesture* is deliberately not this component's job — a
 * sideways swipe anywhere on the page does that, and `useScreenSwipe` ignores
 * anything starting inside a horizontal scroller like this one. That division
 * is what lets the rail be scrolled without every scroll also changing the
 * page underneath it.
 *
 * The active chip is a flat block in the mode's own colour, so the control both
 * indicates state and previews what the shopper is about to see.
 *
 * ── Folding ──
 * `folded` is the storefront telling the rail that the page has moved on and
 * the bar is taking over. The five pills do not simply fade: the unchosen ones
 * collapse their width to nothing from the outside in, so the row concertinas
 * inward onto the one that is selected, and then that one rises and goes. The
 * rise is the whole point — it is what makes the pill read as having been
 * tacked up into the bar rather than having been switched off, and it lands
 * exactly as ModePerch arrives up there.
 *
 * Width, not scale. A scaled-down pill is a small pill; a pill with no width
 * has been swallowed by its neighbours, and that is the difference between
 * five things disappearing and five things becoming one.
 */
export function ModeSwitcher({ folded = false }: { folded?: boolean }) {
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
      // No overflow utility here: kl-rail owns it, and as a component class a
      // utility on the element would win and override it.
      className={`kl-rail scrollbar-none -mx-4 flex gap-2 px-4 py-1
                  outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2
                  sm:mx-0 sm:px-0 ${dragging ? 'kl-rail--dragging' : ''}`}
    >
      {STOREFRONT_MODES.map((definition, i) => {
        const Icon = definition.icon;
        const isActive = definition.value === mode;
        // Outside in. The far chips go first and the ones nearest the selected
        // pill go last, so the row closes onto it instead of all five
        // vanishing on the same frame.
        const distance = Math.abs(i - index);

        return (
          <motion.button
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
            animate={
              folded
                ? isActive
                  // Tacked up into the bar. The rise is small and the fade is
                  // late, so the eye follows it to the header rather than
                  // watching it evaporate in place.
                  ? { y: -18, opacity: 0, scale: 0.88, width: 'auto', marginRight: 0 }
                  // Swallowed by its neighbours.
                  : { y: 0, opacity: 0, scale: 0.7, width: 0, marginRight: -8 }
                : { y: 0, opacity: 1, scale: 1, width: 'auto', marginRight: 0 }
            }
            transition={{
              // Slower than it wants to be, in both directions.
              //
              // Leaving is a sequence, not an event: the outer pills clear,
              // then the inner ones, then the chosen one goes up. At the old
              // 0.34s with a 35ms stagger the whole thing was over in under
              // half a second and read as a flinch.
              //
              // Coming back is slower still and starts from the middle,
              // unfolding outward. There is a banner underneath waiting to be
              // looked at and nothing is competing for the moment, so the row
              // can take its time arriving instead of snapping into place.
              duration: folded ? 0.5 : 0.62,
              ease: [0.22, 1, 0.36, 1],
              delay: folded
                ? isActive
                  ? 0.3
                  : distance * 0.06
                : distance * 0.07,
            }}
            className={`relative flex h-11 shrink-0 items-center gap-2 overflow-hidden
                        rounded-[var(--radius-pill)] px-5 text-sm font-semibold tracking-wide
                        transition-colors duration-200 active:scale-[0.97]
                        ${
                          isActive
                            // Ink or paper per mode, never a fixed white:
                            // white cleared 4.5:1 on only two of the five
                            // blocks. See --mode-on-block in theme.css for
                            // the measured table. No kl-glow either -- the
                            // glow is reserved for the one primary action on
                            // a screen, and a mode chip is a state, not an
                            // action.
                            ? 'text-[var(--mode-on-block)]'
                            // Frosted rather than a solid white chip: on a grey
                            // ground a floating pill you can see the page
                            // through is an object in the room, and an opaque
                            // one is a sticker on the glass. Near-black label,
                            // because a grey label on a translucent pill is two
                            // greys arguing over a moving backdrop.
                            : 'kl-rim kl-frost text-foreground'
                        }`}
          >
            {isActive && (
              <motion.span
                layoutId="mode-chip"
                transition={{ type: 'spring', damping: 28, stiffness: 300 }}
                // A flat block in the mode's own colour, not a wash.
                // Colour arrives with a hard edge in this language.
                className="absolute inset-0 rounded-[var(--radius-pill)] bg-mode-from"
              />
            )}
            <Icon className="relative z-10 h-4 w-4 shrink-0" strokeWidth={2} />
            <span className="relative z-10 whitespace-nowrap">{definition.label}</span>
          </motion.button>
        );
      })}
    </div>
  );
}
