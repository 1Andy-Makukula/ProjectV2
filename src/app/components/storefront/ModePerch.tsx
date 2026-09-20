import { useStorefrontMode } from '../../hooks/useStorefrontMode';
import { modeDefinition } from '../../types/storefrontModes';

/**
 * The mode rail, folded down to the one fact worth keeping.
 *
 * When the storefront's chrome leaves on scroll, the five chips go with it and
 * this arrives in the header in their place. It is not a smaller switcher —
 * it is the *answer* the switcher gave, which is the only part of a set of
 * five options that is still worth screen space once you have stopped
 * choosing and started browsing.
 *
 * It wears the active mode's own gradient for the same reason the chip does:
 * by the time it reaches the bar the page has already retinted around it, and
 * a neutral pill would be the one thing on screen not saying which face you
 * are looking at.
 *
 * Pressing it returns you to the top, where the rail is, rather than opening a
 * menu of its own. A second way to change mode is a second thing to keep in
 * step with the swipe gesture, the arrow keys and the rail itself — and the
 * rail is three hundred milliseconds away.
 */
export function ModePerch() {
  const { mode } = useStorefrontMode();
  const definition = modeDefinition(mode);
  const Icon = definition.icon;

  return (
    <button
      type="button"
      onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
      // Announced as what it does, not as what it shows: "Gifting" alone would
      // read as a heading sitting in the toolbar.
      aria-label={`Browsing ${definition.label}. Back to top to change`}
      title={`Browsing ${definition.label}`}
      className="kl-gradient-mode flex h-9 shrink-0 items-center gap-1.5 rounded-[var(--radius-pill)]
                 px-3.5 text-xs font-semibold tracking-wide text-white
                 transition-transform active:scale-[0.97]"
    >
      <Icon className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
      {/* The label is the first thing to go when the bar is tight — the
          gradient and the glyph already say which mode this is. */}
      <span className="hidden sm:inline">{definition.label}</span>
    </button>
  );
}
