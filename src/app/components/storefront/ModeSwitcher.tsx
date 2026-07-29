import { motion } from 'motion/react';
import { useStorefrontMode } from '../../hooks/useStorefrontMode';
import { STOREFRONT_MODES } from '../../types/storefrontModes';

/**
 * The five faces, as a scrollable chip row.
 *
 * The active chip is filled with the mode's own gradient, so the control both
 * indicates state and previews what the shopper is about to see.
 */
export function ModeSwitcher() {
  const { mode, setMode } = useStorefrontMode();

  return (
    <div
      role="tablist"
      aria-label="Browse by"
      className="scrollbar-none -mx-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:px-0"
    >
      {STOREFRONT_MODES.map((definition) => {
        const Icon = definition.icon;
        const isActive = definition.value === mode;

        return (
          <button
            key={definition.value}
            role="tab"
            aria-selected={isActive}
            onClick={() => setMode(definition.value)}
            className={`relative flex shrink-0 items-center gap-1.5 rounded-full border px-4 py-2
                        text-xs font-semibold tracking-wide transition-all duration-200
                        active:scale-[0.97]
                        ${
                          isActive
                            ? 'border-transparent text-white shadow-sm'
                            : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900'
                        }`}
          >
            {isActive && (
              <motion.span
                layoutId="mode-chip"
                transition={{ type: 'spring', damping: 28, stiffness: 300 }}
                className="kl-gradient-mode absolute inset-0 rounded-full"
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
