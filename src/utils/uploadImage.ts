import { supabase } from '../lib/supabaseClient';
import { validateImageFile } from '../lib/uploadValidation';
import imageCompression from 'browser-image-compression';

export interface UploadImageResult {
  publicUrl: string;
  path: string;
}

/**
 * A chat attachment lives in the PRIVATE `chat-attachments` bucket, so there is
 * no public URL to keep. `path` is the durable reference stored on the message;
 * `signedUrl` is a short-lived view grant for the sender's own optimistic
 * render. See migration 20260903020000.
 */
export interface UploadChatImageResult {
  signedUrl: string;
  path: string;
}

/** How long a minted chat-image view URL is valid for. */
const CHAT_IMAGE_SIGNED_TTL_SECONDS = 60 * 60;

/**
 * Resolves what is stored in `messages.image_url` into something an <img> can
 * load.
 *
 * The column holds one of two things, and which one depends on when the message
 * was sent:
 *
 *   - a legacy absolute URL, from when attachments were written to the public
 *     `storefront-assets` bucket. Already public; used as-is.
 *   - a storage path in the private `chat-attachments` bucket, for everything
 *     sent since. Needs a signed URL, minted per view and expiring.
 *
 * Migration 20260903020000 explains why the legacy rows are left alone rather
 * than rewritten: they are real conversation history, and re-homing the files
 * would break every historical message while un-publishing nothing already
 * handed out.
 */
export async function resolveChatImageSrc(stored: string | null | undefined): Promise<string | null> {
  if (!stored) return null;
  if (/^https?:\/\//i.test(stored)) return stored;

  const { data, error } = await supabase.storage
    .from('chat-attachments')
    .createSignedUrl(stored, CHAT_IMAGE_SIGNED_TTL_SECONDS);

  if (error || !data?.signedUrl) {
    console.error('[resolveChatImageSrc] Could not sign chat attachment:', error?.message);
    return null;
  }
  return data.signedUrl;
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
 * Uploads a chat image attachment via the `upload-chat-image` Edge Function.
 * Authorisation is conversation participancy (buyer, the shop's merchant, or
 * an admin), checked server-side against `conversation_role_for`.
 *
 * Returns the storage `path` -- that is what belongs on the message. The
 * `signedUrl` expires and must never be persisted.
 */
export async function uploadChatImage(rawFile: File, conversationId: string): Promise<UploadChatImageResult> {
  let fileToUpload: File;

  try {
    const options = {
      maxSizeMB: 0.3,
      maxWidthOrHeight: 1080,
      useWebWorker: true,
      fileType: 'image/webp' as string
    };
    const compressedBlob = await imageCompression(rawFile, options);
    const webpBlob = await convertToWebP(compressedBlob);

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
    throw new Error('You must be signed in to send images.');
  }

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
  const form = new FormData();
  form.append('file', fileToUpload);
  form.append('conversation_id', conversationId);

  const response = await fetch(`${supabaseUrl}/functions/v1/upload-chat-image`, {
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
    signedUrl: payload.signedUrl as string,
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

/**
 * Uploads a compliance document to the PRIVATE shop-documents bucket.
 *
 * Deliberately not uploadPublicAsset: that writes to `storefront-assets`, which
 * is public, and a licence or an NRC must not have an unauthenticated URL. The
 * object path is namespaced by shop so the storage policy can decide access
 * from the path alone, and the caller stores the path — never a URL, since a
 * signed one expires.
 *
 * No compression: these are documents, often PDFs, and re-encoding a scan of a
 * licence would be both pointless and destructive.
 */
export async function uploadShopDocument(file: File, shopId: string): Promise<string> {
  const extension = file.name.includes('.') ? file.name.split('.').pop() : 'bin';
  const path = `${shopId}/${crypto.randomUUID()}.${extension}`;

  const { error } = await supabase.storage
    .from('shop-documents')
    .upload(path, file, { contentType: file.type || 'application/octet-stream' });

  if (error) throw error;
  return path;
}

/**
 * A short-lived link to a private document, for someone already entitled to it.
 *
 * The storage policy is the real gate — this only fails to produce a link for
 * anyone it would have refused anyway.
 */
export async function signedShopDocumentUrl(
  path: string,
  expiresInSeconds = 60,
): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from('shop-documents')
    .createSignedUrl(path, expiresInSeconds);

  if (error) {
    console.error('[signedShopDocumentUrl] failed:', error.message);
    return null;
  }
  return data?.signedUrl ?? null;
}

/** Removes a document object from the private bucket. */
export async function deleteShopDocument(path: string): Promise<void> {
  if (!path) return;
  const { error } = await supabase.storage.from('shop-documents').remove([path]);
  if (error) throw error;
}

/**
 * Deletes a public storefront asset from storage given its public URL.
 */
export async function deleteStorefrontAsset(url: string, bucketName = 'storefront-assets'): Promise<void> {
  if (!url) return;
  const filePath = url.split(`/public/${bucketName}/`)[1];
  if (filePath) {
    const { error } = await supabase.storage.from(bucketName).remove([filePath]);
    if (error) throw error;
  }
}
