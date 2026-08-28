/**
 * Password generation for accounts an admin creates on someone else's behalf.
 *
 * These are real credentials. A merchant is handed one of these and signs in
 * with it, so it has to be unguessable by anyone who has seen other passwords
 * the same admin generated.
 *
 * `Math.random()` — which this replaced — cannot give that. It is a fast PRNG
 * (xorshift128+ in V8), not a cryptographic one: its internal state is
 * recoverable from a modest run of outputs, after which every future value is
 * predictable. An attacker who is handed one merchant password, or who watches
 * a few get generated in the admin UI, can derive the rest. Browsers expose a
 * real CSPRNG for free; there is no reason to use the other one here.
 *
 * Two details that matter as much as the source of entropy:
 *
 *   - **Modulo bias.** `random % charset.length` is not uniform unless the
 *     range divides evenly, which for a 70-character set it does not. The low
 *     characters come up slightly more often, which quietly costs entropy.
 *     `randomIndex` rejects the unusable tail of the range instead.
 *
 *   - **Guaranteed classes.** A uniformly random 12-character string can
 *     legitimately contain no digit at all, which then fails a password policy
 *     and trains whoever hit it to press the regenerate button rather than
 *     trust it. One character is drawn from each class first, then the rest is
 *     filled and the whole thing shuffled.
 */

const LOWER = 'abcdefghijklmnopqrstuvwxyz';
const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const DIGITS = '0123456789';
const SYMBOLS = '!@#$%^&*';

const CHARSET = LOWER + UPPER + DIGITS + SYMBOLS;

/** Long enough that the charset size stops being the interesting number. */
export const DEFAULT_PASSWORD_LENGTH = 16;

/** Not a security limit — a guard against an absurd allocation. */
export const MAX_PASSWORD_LENGTH = 256;

/**
 * A uniformly distributed integer in [0, maxExclusive).
 *
 * Rejection sampling: draw a uint32, and discard anything at or above the
 * largest exact multiple of `maxExclusive` that fits in the range. Every
 * accepted value is then equally likely. The loop is expected to run about
 * once — the rejected tail is under one part in fifty million for our range.
 */
function randomIndex(maxExclusive: number): number {
  if (maxExclusive <= 0) throw new RangeError('maxExclusive must be positive');

  const limit = Math.floor(0x1_0000_0000 / maxExclusive) * maxExclusive;
  const buffer = new Uint32Array(1);

  let value: number;
  do {
    crypto.getRandomValues(buffer);
    value = buffer[0];
  } while (value >= limit);

  return value % maxExclusive;
}

/** Fisher-Yates, driven by the same CSPRNG. */
function shuffle(characters: string[]): string[] {
  for (let i = characters.length - 1; i > 0; i--) {
    const j = randomIndex(i + 1);
    [characters[i], characters[j]] = [characters[j], characters[i]];
  }
  return characters;
}

export function generateSecurePassword(length = DEFAULT_PASSWORD_LENGTH): string {
  const classes = [LOWER, UPPER, DIGITS, SYMBOLS];

  // The whole domain, not just the low end. A `length <  classes.length` guard
  // alone lets two values through that both fail badly and silently:
  //
  //   NaN       — every comparison against it is false, so the guard does not
  //               fire AND the fill loop never runs. The caller asks for a
  //               password and is handed a FOUR character one. In a credential
  //               generator that is the worst possible failure mode: it looks
  //               like it worked.
  //   Infinity  — the fill loop never terminates and the tab hangs.
  //
  // `Number.isInteger` rejects both, plus fractions like 12.5 which otherwise
  // produced a 13-character password for a 12.5-character request.
  if (!Number.isInteger(length)) {
    throw new TypeError(`Password length must be an integer, received ${String(length)}`);
  }

  if (length < classes.length) {
    throw new RangeError(`Password length must be at least ${classes.length}`);
  }

  if (length > MAX_PASSWORD_LENGTH) {
    throw new RangeError(`Password length must not exceed ${MAX_PASSWORD_LENGTH}`);
  }

  const characters = classes.map((set) => set[randomIndex(set.length)]);

  while (characters.length < length) {
    characters.push(CHARSET[randomIndex(CHARSET.length)]);
  }

  // Without this the first four characters would always be lower, upper,
  // digit, symbol in that order — a free hint about the rest of the string.
  return shuffle(characters).join('');
}
