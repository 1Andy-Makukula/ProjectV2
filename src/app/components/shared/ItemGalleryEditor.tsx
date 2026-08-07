import { useRef } from 'react';
import { ChevronLeft, ChevronRight, ImagePlus, Star, X } from 'lucide-react';
import { toast } from 'sonner';
import { Label } from '../ui/label';
import { Button } from '../ui/button';
import { validateImageFile } from '../../../lib/uploadValidation';
import { MAX_ITEM_IMAGES, type GalleryEntry } from '../../../utils/itemGallery';

interface ItemGalleryEditorProps {
  gallery: GalleryEntry[];
  uploading: boolean;
  onAddFiles: (files: File[]) => void;
  onRemove: (index: number) => void;
  onMove: (from: number, to: number) => void;
}

/**
 * Up to five item photographs, in the order buyers will see them.
 *
 * Position 0 is the cover: it is what the storefront card, the cart and the
 * order history render, so promoting an image to first is the only way to
 * change the cover. That is why reordering exists here at all rather than being
 * left as a nicety.
 *
 * Files are validated on selection with the same `validateImageFile` the single
 * upload used, then held locally until the item is saved — so a half-filled
 * form never leaves orphaned uploads behind.
 */
export function ItemGalleryEditor({
  gallery,
  uploading,
  onAddFiles,
  onRemove,
  onMove,
}: ItemGalleryEditorProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const remaining = MAX_ITEM_IMAGES - gallery.length;

  const handleFiles = (event: React.ChangeEvent<HTMLInputElement>) => {
    const chosen = Array.from(event.target.files ?? []);
    // Reset immediately so re-picking the same file still fires a change event.
    event.target.value = '';
    if (chosen.length === 0) return;

    const accepted: File[] = [];
    for (const file of chosen) {
      const check = validateImageFile(file);
      if (!check.ok) {
        toast.error(`${file.name}: ${check.reason}`);
        continue;
      }
      accepted.push(file);
    }

    if (accepted.length > 0) onAddFiles(accepted);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-4">
        <Label htmlFor="item-images">Item Images</Label>
        <span className="text-xs font-light text-muted-foreground">
          {gallery.length} of {MAX_ITEM_IMAGES}
        </span>
      </div>

      <p className="text-xs font-light text-muted-foreground">
        The first image is the cover buyers see on cards and in their cart. Add up to{' '}
        {MAX_ITEM_IMAGES}.
      </p>

      {gallery.length > 0 && (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {gallery.map((entry, index) => (
            <li
              key={entry.id ?? entry.url}
              className="group relative aspect-square overflow-hidden rounded-lg border border-border bg-muted"
            >
              <img
                src={entry.url}
                alt={index === 0 ? 'Cover image' : `Image ${index + 1}`}
                className="h-full w-full object-cover"
              />

              {index === 0 && (
                <span className="absolute left-1.5 top-1.5 inline-flex items-center gap-1 rounded-full bg-black/70 px-2 py-0.5 text-[10px] font-medium text-white">
                  <Star className="size-2.5" strokeWidth={2.5} />
                  Cover
                </span>
              )}

              <button
                type="button"
                onClick={() => onRemove(index)}
                disabled={uploading}
                aria-label={`Remove image ${index + 1}`}
                className="absolute right-1.5 top-1.5 rounded-full bg-black/70 p-1 text-white transition-opacity hover:bg-black/85 disabled:opacity-50"
              >
                <X className="size-3" strokeWidth={2.5} />
              </button>

              <div className="absolute inset-x-1.5 bottom-1.5 flex justify-between gap-1">
                <button
                  type="button"
                  onClick={() => onMove(index, index - 1)}
                  disabled={uploading || index === 0}
                  aria-label={`Move image ${index + 1} earlier`}
                  className="rounded-full bg-black/70 p-1 text-white transition-opacity hover:bg-black/85 disabled:invisible"
                >
                  <ChevronLeft className="size-3" strokeWidth={2.5} />
                </button>
                <button
                  type="button"
                  onClick={() => onMove(index, index + 1)}
                  disabled={uploading || index === gallery.length - 1}
                  aria-label={`Move image ${index + 1} later`}
                  className="rounded-full bg-black/70 p-1 text-white transition-opacity hover:bg-black/85 disabled:invisible"
                >
                  <ChevronRight className="size-3" strokeWidth={2.5} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <input
        ref={inputRef}
        id="item-images"
        type="file"
        multiple
        accept="image/jpeg,image/png,image/webp,image/gif"
        onChange={handleFiles}
        className="hidden"
      />

      <Button
        type="button"
        variant="outline"
        disabled={uploading || remaining <= 0}
        onClick={() => inputRef.current?.click()}
        className="flex items-center gap-2"
      >
        <ImagePlus className="size-4" />
        {gallery.length === 0
          ? 'Add images'
          : remaining > 0
            ? `Add ${remaining} more`
            : 'Maximum reached'}
      </Button>
    </div>
  );
}
