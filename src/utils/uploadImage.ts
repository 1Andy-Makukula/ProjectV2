import { supabase } from '../lib/supabaseClient';
import { validateImageFile } from '../lib/uploadValidation';
import imageCompression from 'browser-image-compression';

export interface UploadImageResult {
  publicUrl: string;
  path: string;
}

/**
 * Converts a Blob to real WebP format using HTML5 Canvas.
 */
function convertToWebP(blob: Blob): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.src = URL.createObjectURL(blob);
    img.onload = () => {
      URL.revokeObjectURL(img.src);
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Canvas context is null'));
        return;
      }
      ctx.drawImage(img, 0, 0);
      canvas.toBlob(
        (webpBlob) => {
          if (webpBlob) {
            resolve(webpBlob);
          } else {
            reject(new Error('WebP conversion returned null blob'));
          }
        },
        'image/webp',
        0.85 // High quality WebP compression
      );
    };
    img.onerror = (err) => {
      URL.revokeObjectURL(img.src);
      reject(err);
    };
  });
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
    const webpBlob = await convertToWebP(compressedBlob);
    
    // Repackage Blob as File to preserve name for validation
    fileToUpload = new File([webpBlob], rawFile.name.replace(/\.[^/.]+$/, "") + ".webp", {
      type: 'image/webp',
      lastModified: Date.now()
    });
  } catch (err) {
    console.error('Image compression or WebP conversion failed, falling back to original:', err);
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

/**
 * Uploads a public storefront asset (e.g. logos, covers, banners)
 * with automatic WebP compression.
 */
export async function uploadPublicAsset(
  file: File | null,
  existingUrl: string,
  folder: string,
  bucketName = 'storefront-assets'
): Promise<string> {
  if (!file) return existingUrl;

  let fileToUpload = file;
  try {
    const options = {
      maxSizeMB: 0.5,
      maxWidthOrHeight: 1920,
      useWebWorker: true,
      fileType: 'image/webp' as string
    };
    const compressedBlob = await imageCompression(file, options);
    const webpBlob = await convertToWebP(compressedBlob);
    fileToUpload = new File([webpBlob], file.name.replace(/\.[^/.]+$/, "") + ".webp", {
      type: 'image/webp',
      lastModified: Date.now()
    });
  } catch (err) {
    console.error('Image compression or WebP conversion failed, falling back to original:', err);
  }

  const fileName = `${folder}-${Date.now()}-${Math.random().toString(36).substring(7)}.webp`;
  const filePath = `${folder}/${fileName}`;

  const { error: uploadError } = await supabase.storage
    .from(bucketName)
    .upload(filePath, fileToUpload);

  if (uploadError) throw uploadError;

  const { data: { publicUrl } } = supabase.storage
    .from(bucketName)
    .getPublicUrl(filePath);

  return publicUrl;
}
