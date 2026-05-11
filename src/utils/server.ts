import { supabase } from './supabase/client';
import { projectId } from './supabase/info';

const defaultFunctionsBaseUrl = `https://${projectId}.supabase.co/functions/v1/server`;
const configuredFunctionsBaseUrl =
  import.meta.env.VITE_SUPABASE_FUNCTIONS_BASE_URL?.replace(/\/$/, '');

const functionsBaseUrl = configuredFunctionsBaseUrl || defaultFunctionsBaseUrl;

type ServerRequestOptions = {
  auth?: boolean;
  body?: unknown;
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
};

export async function callServer<T>(
  path: string,
  { auth = true, body, method = 'POST' }: ServerRequestOptions = {},
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (auth) {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (session?.access_token) {
      headers.Authorization = `Bearer ${session.access_token}`;
    }
  }

  const response = await fetch(`${functionsBaseUrl}/make-server-468852b1${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.error || payload.message || 'Server request failed');
  }

  return payload as T;
}
