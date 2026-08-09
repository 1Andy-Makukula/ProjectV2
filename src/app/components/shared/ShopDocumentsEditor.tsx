import { useRef, useState } from 'react';
import { AlertTriangle, Archive, FileText, Loader2, Paperclip, RotateCcw } from 'lucide-react';
import { Label } from '../ui/label';
import { Input } from '../ui/input';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { documentExpiry, type ShopDocument } from '../../types/shopDocuments';

interface ShopDocumentsEditorProps {
  documents: ShopDocument[];
  archivedDocuments: ShopDocument[];
  onAdd: (label: string, file: File, expiresAt: string | null) => Promise<boolean>;
  onArchive: (id: string, archived: boolean) => void;
  onOpen: (doc: ShopDocument) => void;
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
  archivedDocuments,
  onAdd,
  onArchive,
  onOpen,
  disabled,
}: ShopDocumentsEditorProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [label, setLabel] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [uploading, setUploading] = useState(false);

  const hasLabel = label.trim().length > 0;

  const handleFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setUploading(true);
    try {
      const ok = await onAdd(label.trim(), file, expiresAt || null);
      if (ok) {
        setLabel('');
        setExpiresAt('');
      }
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-2">
      <Label>Licences &amp; Certificates</Label>
      <p className="text-xs font-light text-muted-foreground">
        Add any paperwork your trade requires — a practising licence, a health certificate, a
        premises permit. Add as many as you need. Only you and KithLy can open these.
      </p>
      {/* These write straight away, unlike the fields around them. Said plainly
          so nobody expects Cancel to take an upload back. */}
      <p className="text-xs font-light text-muted-foreground">
        Documents are saved as soon as you attach them — the Cancel button below does not
        undo them. Removing one archives it rather than deleting it, so it stays on record.
      </p>

      {documents.length > 0 && (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {documents.map((doc) => {
            const expiry = documentExpiry(doc);

            return (
              <li key={doc.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                <FileText className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />

                {/* Not an <a href>: the file is private, so a link only exists
                    for as long as a signed one is valid and is minted on
                    demand for whoever is entitled to it. */}
                <button
                  type="button"
                  onClick={() => onOpen(doc)}
                  className="min-w-0 flex-1 truncate text-left text-sm font-medium text-foreground hover:underline"
                >
                  {doc.label}
                </button>

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

                {/* Archives rather than deletes. Compliance paperwork is an
                    audit record, and the moment it matters most is exactly when
                    someone would want it gone. */}
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onArchive(doc.id, true)}
                  aria-label={`Archive ${doc.label}`}
                  className="rounded-md p-1.5 text-muted-foreground transition-colors hover:text-foreground"
                >
                  <Archive className="size-3.5" strokeWidth={2} />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {/* Kept visible rather than hidden behind a toggle: a merchant who
          archived the wrong licence needs to find it again without knowing to
          look for it, and the list is short by nature. */}
      {archivedDocuments.length > 0 && (
        <div className="space-y-1.5 pt-1">
          <p className="text-xs font-medium text-muted-foreground">Archived</p>
          <ul className="divide-y divide-border rounded-lg border border-dashed border-border">
            {archivedDocuments.map((doc) => (
              <li key={doc.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
                <FileText className="size-4 shrink-0 text-muted-foreground/60" strokeWidth={1.75} />
                <button
                  type="button"
                  onClick={() => onOpen(doc)}
                  className="min-w-0 flex-1 truncate text-left text-sm font-light text-muted-foreground hover:underline"
                >
                  {doc.label}
                </button>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onArchive(doc.id, false)}
                  aria-label={`Restore ${doc.label}`}
                  className="rounded-md p-1.5 text-muted-foreground transition-colors hover:text-foreground"
                >
                  <RotateCcw className="size-3.5" strokeWidth={2} />
                </button>
              </li>
            ))}
          </ul>
        </div>
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
        {/* Gated on the label rather than checking after the fact: the old
            order let someone pick a file, then told them to name it first and
            threw the selection away. */}
        <Button
          type="button"
          variant="outline"
          disabled={disabled || uploading || !hasLabel}
          title={hasLabel ? undefined : 'Name the document first'}
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
