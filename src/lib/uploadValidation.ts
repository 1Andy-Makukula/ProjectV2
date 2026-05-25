/** Client- and server-aligned image upload rules. */

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB

export const ALLOWED_IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
] as const;

export type AllowedImageMime = (typeof ALLOWED_IMAGE_MIME_TYPES)[number];

export type ImageValidationResult =
  | { ok: true; mime: AllowedImageMime; extension: string }
  | { ok: false; reason: string };

const EXT_BY_MIME: Record<AllowedImageMime, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

export function validateImageFile(file: File): ImageValidationResult {
  if (!file) {
    return { ok: false, reason: 'No file selected.' };
  }

  if (file.size > MAX_IMAGE_BYTES) {
    return { ok: false, reason: 'Image must be 5 MB or smaller.' };
  }

  if (!ALLOWED_IMAGE_MIME_TYPES.includes(file.type as AllowedImageMime)) {
    return {
      ok: false,
      reason: 'Only JPEG, PNG, WebP, or GIF images are allowed.',
    };
  }

  const extension = EXT_BY_MIME[file.type as AllowedImageMime];
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '');
  if (safeName.includes('..')) {
    return { ok: false, reason: 'Invalid file name.' };
  }

  return { ok: true, mime: file.type as AllowedImageMime, extension };
}
