// IntentStrip — the top of /browse, answering the question the mode implies.
//
// One slot, two contents, chosen by `intentOf(mode)`:
//
//   send    the occasion catalogues. Somebody buying for a person back home
//           thinks "a month of groceries" or "her birthday", not "the Bakery
//           & Cakes aisle", and until now those shelves were only reachable
//           from the Welcome page. Leave it and they were gone.
//   browse  the category chips. Somebody shopping for themselves knows the
//           aisle they want and should be one press from it.
//
// This is what the two-rails plan's Stage 1 toggle was a means to. The toggle
// itself was retired: the Welcome doors already ask the question and the mode
// already remembers the answer, so a header switch would have been a seventh
// control restating the same thing. What was actually missing was a place on
// the catalogue where the answer changed what you see first.
//
// Grammar per the charter: these are pills because they are presses. The
// active category is ink on paper -- a fact about the current view -- and
// never brand, which is reserved for one act-now per region.

import { useNavigate } from 'react-router';
import { useStorefrontMode } from '../../hooks/useStorefrontMode';
import { useFeaturedCategories } from '../../hooks/useCategories';
import { useRequestThread } from '../../hooks/useRequestThread';
import { intentOf } from '../../types/storefrontModes';
import { OCCASION_TILES } from '../../types/occasions';

interface IntentStripProps {
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

export function IntentStrip({ activeCategorySlug, onSelectCategory }: IntentStripProps) {
  const navigate = useNavigate();
  const { mode } = useStorefrontMode();
  const { categories } = useFeaturedCategories();
  const { askKithly, opening } = useRequestThread();
  const intent = intentOf(mode);

  if (intent === 'send') {
    return (
      <nav aria-label="Shop by occasion" className="kl-scroll -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        {OCCASION_TILES.map((occasion) => (
          <button
            key={occasion.kind}
            type="button"
            disabled={occasion.opensRequest && opening}
            onClick={() =>
              // The catch-all is a door into the request engine rather than a
              // shelf, exactly as on the Welcome mosaic.
              occasion.opensRequest
                ? askKithly('Something else')
                : navigate(`/catalogue/${occasion.kind}`)
            }
            className={`${CHIP} ${CHIP_IDLE}`}
          >
            {occasion.label}
          </button>
        ))}
      </nav>
    );
  }

  // Nothing featured is a normal state for a fresh environment; an "All" chip
  // alone would be a control with nothing to choose between.
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
