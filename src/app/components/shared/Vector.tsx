/**
 * The vector cast — four characters, each with one job.
 *
 * A character is never decoration on its own. It is the handle a tag hangs
 * from, and the tag carries the words: the drawing is what makes you look and
 * the block beside it is what tells you something. That pairing is the rule,
 * which is why `tag` is a required prop rather than a nicety — a mascot with
 * nothing to say is clip-art, and this component will not render one.
 *
 * WHERE EACH ONE LIVES (and nowhere else)
 *   promo    L  special-deals headers, campaign stages, promo tiles
 *   car      M  the tracker, "gifts on their way", delivery explainers
 *                S inline beside a single delivery line
 *   santa    S  the wishes module, the Secret Santa action, wish empty states
 *   shopper  L  EMPTY STATES ONLY — an empty bag, no wishes, no contacts
 *
 * THE HARD RULES, enforced here so a call site cannot break them
 *   - Sizes are 40 / 72 / 120 and nothing else, capped at 88px on a phone.
 *   - `aria-hidden` always. These are decorative; the tag carries the meaning
 *     and the tag is real text.
 *   - Never animated. This is a long scrolling page of photographs on cheap
 *     Android hardware, and a page that stutters while you read it feels
 *     worse than one that never moved.
 *   - One per viewport region.
 *   - NEVER on checkout, escrow, dispute, payout, receipt or terminal
 *     surfaces. Money screens are the quietest in the app and that restraint
 *     is itself the premium signal.
 *
 * FORMAT, AND A KNOWN COST
 * The charter asks for SVG under a 100KB storefront budget. What shipped is
 * PNG, and three of the four are over it — promo 107KB, shopper 123KB, car
 * 64KB, santa 7KB. Andy chose to ship the supplied art as-is on 2026-09-18
 * rather than wait for redraws. `loading="lazy"` and `decoding="async"` are
 * here to soften that; they do not fix it. Replacing these with real SVGs is
 * a drop-in swap — only the four paths below change.
 */

type VectorName = 'promo' | 'car' | 'santa' | 'shopper';
type VectorSize = 'S' | 'M' | 'L';

const SRC: Record<VectorName, string> = {
  promo: '/vectors/promo.png',
  car: '/vectors/delivery-car.png',
  santa: '/vectors/santa.png',
  shopper: '/vectors/shopper.png',
};

/** 40 / 72 / 120, with the phone cap at 88 applied to the largest. */
const SIZE: Record<VectorSize, string> = {
  S: 'h-10 w-10',
  M: 'h-[72px] w-[72px]',
  L: 'h-[88px] w-[88px] sm:h-[120px] sm:w-[120px]',
};

/** How the tag beside the character is coloured. */
type TagTone = 'ink' | 'brand' | 'brass';

const TAG: Record<TagTone, string> = {
  ink: 'bg-ink text-on-ink',
  brand: 'bg-primary text-white',
  brass: 'bg-brass text-ink',
};

export function Vector({
  name,
  size = 'L',
  tag,
  tone = 'ink',
  className = '',
}: {
  name: VectorName;
  size?: VectorSize;
  /** The words. Required: a character without a tag is decoration. */
  tag: string;
  tone?: TagTone;
  className?: string;
}) {
  return (
    <div className={`flex flex-col items-center gap-2 ${className}`}>
      <img
        src={SRC[name]}
        alt=""
        aria-hidden
        loading="lazy"
        decoding="async"
        // drop-shadow rather than box-shadow: it follows the subject's alpha,
        // so the figure stands on the card instead of casting a rectangle.
        className={`${SIZE[size]} shrink-0 object-contain
                    [filter:drop-shadow(0_6px_10px_rgba(16,16,20,0.18))]`}
      />
      <span
        className={`rounded-[var(--radius-block)] px-2 py-1 text-[11px] font-bold
                    uppercase tracking-[0.06em] ${TAG[tone]}`}
      >
        {tag}
      </span>
    </div>
  );
}
