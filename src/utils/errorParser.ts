/**
 * Global utility to parse Postgres and Supabase errors into user-friendly messages.
 * Centralizes constraint mapping (e.g. E.164 phone validation).
 */
export function parseAuthError(error: any): string {
  if (!error) return 'An unexpected error occurred. Please try again.';

  const msg = error.message || String(error);

  // E.164 Postgres Constraint Matcher
  if (
    msg.toLowerCase().includes('e.164') ||
    msg.toLowerCase().includes('e164') ||
    msg.includes('users_phone_check')
  ) {
    return 'International format required (e.g., +260...).';
  }

  // Duplicate Account Matches
  if (msg.includes('User already registered') || msg.includes('unique constraint')) {
    return 'An account with this email or phone number already exists.';
  }

  // Auth Credentials Matcher
  if (msg.includes('Invalid login credentials')) {
    return 'Incorrect email or password.';
  }

  // Postgres 42501 — an RLS policy or a missing grant refused the write. The
  // raw text names the table and the policy, which means nothing to the person
  // reading the toast: a merchant refused by items_merchant_write was shown
  // "permission denied" when their only problem was a shop still under review.
  // Callers that know WHICH write was refused should say so before reaching
  // here; this is the floor, not the explanation.
  if (
    error.code === '42501' ||
    msg.includes('row-level security policy') ||
    msg.includes('permission denied for')
  ) {
    return 'You do not have permission to do that. If that is unexpected, your account may not be approved for it yet.';
  }

  return msg;
}
