import { supabase } from '../lib/supabaseClient';
import { validateImageFile } from '../lib/uploadValidation';

export interface UploadImageResult {
  publicUrl: string;
  path: string;
}

/**
 * Uploads an item image via the `upload-item-image` Edge Function
 * (server-side MIME/size validation).
 */
export async function uploadItemImage(file: File, shopId: string): Promise<UploadImageResult> {
  const validation = validateImageFile(file);
  if (!validation.ok) {
    throw new Error(validation.reason);
  }

  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) {
    throw new Error('You must be signed in to upload images.');
  }

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
  const form = new FormData();
  form.append('file', file);
  form.append('shop_id', shopId);

  const response = await fetch(`${supabaseUrl}/functions/v1/upload-item-image`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
    },
    body: form,
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error ?? 'Image upload failed.');
  }

  return {
    publicUrl: payload.publicUrl as string,
    path: payload.path as string,
  };
}
