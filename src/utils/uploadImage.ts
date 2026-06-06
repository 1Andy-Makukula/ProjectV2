import { supabase } from '../lib/supabaseClient';
import { validateImageFile } from '../lib/uploadValidation';
import imageCompression from 'browser-image-compression';

export interface UploadImageResult {
  publicUrl: string;
  path: string;
}

/**
 * Uploads an item image via the `upload-item-image` Edge Function
 * (server-side MIME/size validation).
 */
export async function uploadItemImage(rawFile: File, shopId: string): Promise<UploadImageResult> {
  let fileToUpload: File;

  try {
    const options = {
      maxSizeMB: 0.3, // Crush to max 300KB
      maxWidthOrHeight: 1080, // Downscale massive 4K phone photos
      useWebWorker: true,
      fileType: 'image/webp' as string // Force modern, highly compressed format
    };
    const compressedBlob = await imageCompression(rawFile, options);
    // Repackage Blob as File to preserve name for validation
    fileToUpload = new File([compressedBlob], rawFile.name.replace(/\.[^/.]+$/, "") + ".webp", {
      type: 'image/webp',
      lastModified: Date.now()
    });
  } catch (err) {
    console.error('Image compression failed, falling back to original:', err);
    fileToUpload = rawFile;
  }

  const validation = validateImageFile(fileToUpload);
  if (!validation.ok) {
    throw new Error(validation.reason);
  }

  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) {
    throw new Error('You must be signed in to upload images.');
  }

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
  const form = new FormData();
  form.append('file', fileToUpload);
  form.append('shop_id', shopId);

  const response = await fetch(`${supabaseUrl}/functions/v1/upload-item-image`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY as string,
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
