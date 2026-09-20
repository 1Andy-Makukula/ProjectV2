// The pacing buffer — witnessing, rather than volume.
//
// Real events arrive in a ragged burst: three in a minute, then four hours of
// nothing. Somebody who opens the app during the silence concludes it is dead,
// though the platform did forty things today. The scarce resource is not events,
// it is attention landing at the same moment as one.
//
// So statements are held and released at a smoothed rate. This only ever
// DELAYS. It cannot invent a statement, inflate a count, or emit one it was not
// given -- the server counts rows that exist and this decides when they are
// said. That distinction is the whole ethics of the feature and it is enforced
// by shape: nothing here constructs a Statement.
//
// Everything is pure and takes its clock as an argument, so the behaviour can
// be tested as arithmetic rather than by waiting.

export interface PulseStatement {
  kind: 'collected' | 'saved' | 'rated' | 'journeys' | 'open_now' | string;
  subject: string | null;
  quantity: number;
  window_days: number;
  weight: number;
}

/**
 * How long a statement stays worth saying.
 *
 * A collection today is warm; a rating from a fortnight ago is furniture. The
 * half-life is per kind because the kinds decay at genuinely different rates,
 * not because it makes the numbers prettier.
 */
const HALF_LIFE_MS: Record<string, number> = {
  collected: 6 * 3600_000,
  rated: 48 * 3600_000,
  saved: 24 * 3600_000,
  journeys: 5 * 86_400_000,
  // Not an event: it is true right now or it is not, and it never goes stale
  // while it is true.
  open_now: Number.POSITIVE_INFINITY,
};

const DEFAULT_HALF_LIFE_MS = 24 * 3600_000;

/** How alive a statement still is, 0..1. */
export function aliveness(statement: PulseStatement, ageMs: number): number {
  const halfLife = HALF_LIFE_MS[statement.kind] ?? DEFAULT_HALF_LIFE_MS;
  if (!Number.isFinite(halfLife)) return 1;
  if (ageMs <= 0) return 1;
  return Math.pow(0.5, ageMs / halfLife);
}

/**
 * What a statement is worth right now: its own weight, decayed by age.
 *
 * The pool is ordered by this, so a fresh collection outranks a stale one
 * without either being fabricated.
 */
export function currentWeight(statement: PulseStatement, ageMs: number): number {
  return statement.weight * aliveness(statement, ageMs);
}

export interface PacingOptions {
  /** Shortest gap between two statements reaching the screen. */
  minGapMs?: number;
  /** Longest a surface should sit on one statement before moving on. */
  maxGapMs?: number;
  /** Deterministic jitter source, so a test is not at the mercy of Math.random. */
  jitter?: () => number;
}

const DEFAULTS = {
  minGapMs: 4_000,
  maxGapMs: 11_000,
};

/**
 * How long to wait before showing the next statement.
 *
 * Fuller pools move faster, because there is more that is genuinely worth
 * saying; a thin pool slows down rather than repeating itself, which is the
 * honest way to handle having little to report.
 *
 * The jitter is what stops it feeling metronomic -- a perfectly regular pulse
 * reads as a carousel, which is the thing this is not.
 */
export function nextDelayMs(poolSize: number, options: PacingOptions = {}): number {
  const minGap = options.minGapMs ?? DEFAULTS.minGapMs;
  const maxGap = options.maxGapMs ?? DEFAULTS.maxGapMs;
  const jitter = options.jitter ?? Math.random;

  if (poolSize <= 0) return maxGap;

  // Six or more is a full pool; below that the gap stretches towards maxGap.
  const fullness = Math.min(poolSize / 6, 1);
  const base = maxGap - (maxGap - minGap) * fullness;

  // ±20%, never below the floor.
  const spread = base * 0.2;
  return Math.max(minGap, Math.round(base + (jitter() * 2 - 1) * spread));
}

/**
 * Choose what to say next.
 *
 * Weighted by current value, but NOT simply the maximum: always showing the
 * heaviest statement means showing the same one until it decays, and a surface
 * that repeats itself is worse than a still one. So the choice is sampled from
 * the pool in proportion to weight, with anything shown recently held back.
 *
 * Returns null when there is nothing worth saying -- a real answer, and the
 * caller should render nothing rather than reach for a filler.
 */
export function pickNext(
  pool: PulseStatement[],
  recentlyShown: ReadonlySet<string>,
  ageMs: (statement: PulseStatement) => number,
  random: () => number = Math.random,
): PulseStatement | null {
  const eligible = pool.filter((s) => !recentlyShown.has(statementKey(s)));
  // Everything has been said recently; better to repeat than to go silent, so
  // the whole pool comes back into play.
  const candidates = eligible.length > 0 ? eligible : pool;
  if (candidates.length === 0) return null;

  const weights = candidates.map((s) => Math.max(currentWeight(s, ageMs(s)), 0));
  const total = weights.reduce((sum, w) => sum + w, 0);

  // Everything has decayed to nothing. Saying the freshest thing anyway would
  // be saying something stale; saying nothing is correct.
  if (total <= 0) return null;

  let target = random() * total;
  for (let i = 0; i < candidates.length; i++) {
    target -= weights[i];
    if (target <= 0) return candidates[i];
  }
  return candidates[candidates.length - 1];
}

/** Stable identity for a statement, for the recently-shown set. */
export function statementKey(statement: PulseStatement): string {
  return `${statement.kind}:${statement.subject ?? ''}`;
}

/**
 * The sentence itself.
 *
 * Kept here rather than in the component so the phrasing is one thing to
 * review. Note that every one is a count and none names a person.
 */
/**
 * The same statement as a LABEL, with the number taken out.
 *
 * Market Pulse renders the count as a big tabular figure and the words beside
 * it, so the sentence form would say the number twice. This is the sentence
 * minus its quantity -- nothing else differs, and in particular nothing here
 * can invent or round a count: the number the panel draws is `quantity`
 * exactly as the server returned it.
 */
export function statementLabel(statement: PulseStatement): string {
  switch (statement.kind) {
    case 'collected':
      return `collected from ${statement.subject} this week`;
    case 'saved':
      return `saved “${statement.subject}”`;
    case 'rated':
      return `rated ${statement.subject}`;
    case 'journeys':
      return statement.quantity === 1 ? 'journey shared recently' : 'journeys shared recently';
    case 'open_now':
      return 'shops open right now';
    default:
      return statement.subject ?? '';
  }
}

/**
 * Which statements are about something GOOD HAPPENING rather than merely
 * something existing. Sage means done or safe in this design language, so it
 * is rationed to the two kinds that actually mean it.
 */
export function statementIsPositive(statement: PulseStatement): boolean {
  return statement.kind === 'collected' || statement.kind === 'open_now';
}

export function statementText(statement: PulseStatement): string {
  const n = statement.quantity;
  const people = `${n} ${n === 1 ? 'person' : 'people'}`;

  switch (statement.kind) {
    case 'collected':
      return `${people} collected from ${statement.subject} this week`;
    case 'saved':
      return `${people} saved “${statement.subject}”`;
    case 'rated':
      return `${statement.subject} was rated by ${people}`;
    case 'journeys':
      return `${n} new ${n === 1 ? 'journey' : 'journeys'} shared recently`;
    case 'open_now':
      return `${n} shops open right now`;
    default:
      return statement.subject ? `${statement.subject} · ${n}` : `${n}`;
  }
}
