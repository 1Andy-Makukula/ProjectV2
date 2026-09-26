// CategoryStrip — the aisles, at the top of /browse.
//
// Somebody on /browse is shopping, whichever mode they are in: the Send Home
// door leads to /catalogue instead (26 Sep). So this is one thing only -- the
// featured categories as chips, one press from any aisle.
//
// It replaces IntentStrip, which switched between occasion pills and these
// chips depending on the mode. That was a compromise with the two-rails design
// -- occasions squeezed onto the top of the marketplace -- and it went once the
// occasions had a catalogue of their own. One place for occasions, one for
// aisles.
//
// Grammar per the charter: pills because they are presses. The current aisle
// is ink on paper -- a fact about the view -- never brand, which stays one
// act-now per region.

import { useFeaturedCategories } from '../../hooks/useCategories';

interface CategoryStripProps {
  /** The `?category=` in force, so the matching chip can show as current. */
  activeCategorySlug: string | null;
  /** Null clears the filter. */
  onSelectCategory: (slug: string | null) => void;
}

const CHIP =
  'shrink-0 whitespace-nowrap rounded-[var(--radius-pill)] px-3.5 py-1.5 text-[0.8125rem] font-medium ' +
  'transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

const CHIP_IDLE = 'bg-surface-paper text-ink-900 hover:bg-ink-100';
const CHIP_CURRENT = 'bg-ink text-on-ink';

export function CategoryStrip({ activeCategorySlug, onSelectCategory }: CategoryStripProps) {
  const { categories } = useFeaturedCategories();

  // Nothing featured is normal in a fresh environment, and an "All" chip on
  // its own would be a control with nothing to choose between.
  if (categories.length === 0) return null;

  return (
    <nav aria-label="Shop by category" className="kl-scroll -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
      <button
        type="button"
        onClick={() => onSelectCategory(null)}
        aria-current={activeCategorySlug === null ? 'true' : undefined}
        className={`${CHIP} ${activeCategorySlug === null ? CHIP_CURRENT : CHIP_IDLE}`}
      >
        All
      </button>
      {categories.map((category) => {
        const current = category.slug === activeCategorySlug;
        return (
          <button
            key={category.id}
            type="button"
            onClick={() => onSelectCategory(current ? null : category.slug)}
            aria-current={current ? 'true' : undefined}
            className={`${CHIP} ${current ? CHIP_CURRENT : CHIP_IDLE}`}
          >
            {category.name}
          </button>
        );
      })}
    </nav>
  );
}
