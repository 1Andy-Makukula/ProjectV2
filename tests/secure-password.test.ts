/**
 * Password generation for admin-created merchant accounts.
 *
 * These are real sign-in credentials handed to a third party, so the property
 * that matters is that seeing one tells you nothing about the next. The
 * previous implementation used Math.random(), whose internal state is
 * recoverable from a run of outputs; CodeQL flagged it as insecure randomness
 * and it was right to.
 *
 * A unit test cannot prove cryptographic strength. What it can do is pin the
 * things that would silently regress: the guaranteed character classes, the
 * length, and the absence of an obvious positional pattern.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_PASSWORD_LENGTH, generateSecurePassword } from '../src/utils/securePassword';

const LOWER = /[a-z]/;
const UPPER = /[A-Z]/;
const DIGIT = /[0-9]/;
const SYMBOL = /[!@#$%^&*]/;

describe('generateSecurePassword', () => {
  it('defaults to a length worth having', () => {
    expect(generateSecurePassword()).toHaveLength(DEFAULT_PASSWORD_LENGTH);
    expect(DEFAULT_PASSWORD_LENGTH).toBeGreaterThanOrEqual(12);
  });

  it('honours an explicit length', () => {
    for (const length of [4, 8, 20, 64]) {
      expect(generateSecurePassword(length)).toHaveLength(length);
    }
  });

  it('always contains every character class', () => {
    // A uniform draw can legitimately omit a class; omitting it then fails a
    // password policy and teaches the admin to distrust the button.
    for (let i = 0; i < 200; i++) {
      const password = generateSecurePassword();
      expect(LOWER.test(password), password).toBe(true);
      expect(UPPER.test(password), password).toBe(true);
      expect(DIGIT.test(password), password).toBe(true);
      expect(SYMBOL.test(password), password).toBe(true);
    }
  });

  it('uses only the intended charset', () => {
    for (let i = 0; i < 100; i++) {
      expect(generateSecurePassword()).toMatch(/^[a-zA-Z0-9!@#$%^&*]+$/);
    }
  });

  it('does not repeat itself', () => {
    const seen = new Set(Array.from({ length: 500 }, () => generateSecurePassword()));
    expect(seen.size).toBe(500);
  });

  it('shuffles, so the guaranteed classes are not pinned to the first positions', () => {
    // Without the shuffle every password would start lower/upper/digit/symbol,
    // which hands an attacker the layout for free. Over many samples the first
    // character must land in more than one class.
    const firstCharClasses = new Set(
      Array.from({ length: 200 }, () => {
        const c = generateSecurePassword()[0];
        if (LOWER.test(c)) return 'lower';
        if (UPPER.test(c)) return 'upper';
        if (DIGIT.test(c)) return 'digit';
        return 'symbol';
      }),
    );
    expect(firstCharClasses.size).toBeGreaterThan(1);
  });

  it('refuses a length that cannot hold every class', () => {
    expect(() => generateSecurePassword(3)).toThrow(RangeError);
  });
});
