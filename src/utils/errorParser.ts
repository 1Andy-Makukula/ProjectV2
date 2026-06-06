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

  return msg;
}
