import { useRef, useState } from 'react';
import { AlertTriangle, FileText, Loader2, Paperclip, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Label } from '../ui/label';
import { Input } from '../ui/input';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { uploadPublicAsset } from '../../../utils/uploadImage';
import { documentExpiry, type ShopDocument } from '../../types/shopDocuments';

interface ShopDocumentsEditorProps {
  documents: ShopDocument[];
  onAdd: (label: string, url: string, expiresAt: string | null) => Promise<boolean>;
  onRemove: (id: string) => void;
  disabled?: boolean;
}

/**
 * Licences, permits and certificates, added a row at a time.
 *
 * The label is free text on purpose: a pharmacy, a butchery and a hardware shop
 * need entirely different paperwork, and an enum of document types would end up
 * blocking someone from uploading something legitimate.
 *
 * Expiry is optional but prominent — a lapsed licence is indistinguishable from
 * a valid one if all anybody stores is the file.
 */
export function ShopDocumentsEditor({
  documents,
  onAdd,
  onRemove,
  disabled,
}: ShopDocumentsEditorProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [label, setLabel] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [uploading, setUploading] = useState(false);

  const handleFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    if (!label.trim()) {
      toast.error('Name the document first, so it is clear what was uploaded');
      return;
    }

    setUploading(true);
    try {
      const url = await uploadPublicAsset(file, '', 'shop-documents');
      const ok = await onAdd(label.trim(), url, expiresAt || null);
      if (ok) {
        setLabel('');
        setExpiresAt('');
      }
    } catch (error: any) {
      console.error('[ShopDocumentsEditor] upload failed:', error);
      toast.error('Could not upload that document');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-2">
      <Label>Licences &amp; Certificates</Label>
      <p className="text-xs font-light text-muted-foreground">
        Add any paperwork your trade requires — a practising licence, a health certificate, a
        premises permit. Add as many as you need.
      </p>

      {documents.length > 0 && (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {documents.map((doc) => {
            const expiry = documentExpiry(doc);

            return (
              <li key={doc.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                <FileText className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />

                <a
                  href={doc.document_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="min-w-0 flex-1 truncate text-sm font-medium text-foreground hover:underline"
                >
                  {doc.label}
                </a>

                {expiry.state === 'expired' && (
                  <Badge variant="destructive" className="gap-1">
                    <AlertTriangle strokeWidth={2} />
                    Expired {expiry.label}
                  </Badge>
                )}
                {expiry.state === 'expiring' && (
                  <Badge variant="warning" className="gap-1">
                    <AlertTriangle strokeWidth={2} />
                    Expires {expiry.label}
                  </Badge>
                )}
                {expiry.state === 'valid' && (
                  <span className="text-xs font-light text-muted-foreground">
                    Valid to {expiry.label}
                  </span>
                )}

                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onRemove(doc.id)}
                  aria-label={`Remove ${doc.label}`}
                  className="rounded-md p-1.5 text-muted-foreground transition-colors hover:text-destructive"
                >
                  <Trash2 className="size-3.5" strokeWidth={2} />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex flex-wrap items-end gap-2 rounded-lg border border-dashed border-border p-3">
        <div className="min-w-[10rem] flex-1 space-y-1">
          <Label htmlFor="doc-label" className="text-xs font-normal">
            What is it?
          </Label>
          <Input
            id="doc-label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. Pharmacy practising licence"
            disabled={disabled || uploading}
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor="doc-expiry" className="text-xs font-normal">
            Expires (optional)
          </Label>
          <Input
            id="doc-expiry"
            type="date"
            value={expiresAt}
            onChange={(e) => setExpiresAt(e.target.value)}
            disabled={disabled || uploading}
            className="w-40"
          />
        </div>

        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,application/pdf"
          onChange={handleFile}
          className="hidden"
        />
        <Button
          type="button"
          variant="outline"
          disabled={disabled || uploading}
          onClick={() => fileRef.current?.click()}
        >
          {uploading ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Paperclip className="size-4" />
          )}
          {uploading ? 'Uploading…' : 'Attach file'}
        </Button>
      </div>
    </div>
  );
}
