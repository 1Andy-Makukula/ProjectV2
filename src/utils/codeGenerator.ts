// Generate unique 6-character code for orders
// Excludes ambiguous characters: 0, O, 1, I
const ALLOWED_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generateOrderCode(): string {
  let code = '';
  for (let i = 0; i < 6; i++) {
    const randomIndex = Math.floor(Math.random() * ALLOWED_CHARS.length);
    code += ALLOWED_CHARS[randomIndex];
  }
  return code;
}

export async function generateUniqueOrderCode(checkExists: (code: string) => Promise<boolean>): Promise<string> {
  let attempts = 0;
  const maxAttempts = 10;

  while (attempts < maxAttempts) {
    const code = generateOrderCode();
    const exists = await checkExists(code);

    if (!exists) {
      return code;
    }

    attempts++;
  }

  throw new Error('Failed to generate unique order code after multiple attempts');
}
