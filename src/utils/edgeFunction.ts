import { supabase } from '../lib/supabaseClient';

/**
 * Invokes a Supabase Edge Function and throws on failure.
 *
 * `supabase.functions.invoke` reports non-2xx responses with a generic
 * "Edge Function returned a non-2xx status code" message and hides the real
 * body on `error.context`. This unwraps that body so callers can surface the
 * server's own message (e.g. "Insufficient balance") in a toast.
 */
export async function invokeFunction<T = unknown>(
  name: string,
  body?: unknown,
): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, {
    body: body ?? {},
  });

  if (error) {
    throw new Error(await extractErrorMessage(error));
  }

  // Functions that answer 200 with `{ success: false, error }` are failures
  // from the caller's point of view even though the transport succeeded.
  const payload = data as { success?: boolean; error?: string } | null;
  if (payload && payload.success === false && payload.error) {
    throw new Error(payload.error);
  }

  return data as T;
}

async function extractErrorMessage(error: unknown): Promise<string> {
  const context = (error as { context?: unknown }).context;

  if (context instanceof Response) {
    try {
      const body = await context.clone().json();
      if (typeof body?.error === 'string') return body.error;
      if (typeof body?.message === 'string') return body.message;
    } catch {
      // Body was not JSON — fall through to the generic message.
    }
  }

  return error instanceof Error ? error.message : 'Server request failed';
}
