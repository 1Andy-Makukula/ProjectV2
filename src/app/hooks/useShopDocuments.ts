import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { toast } from 'sonner';
import { parseAuthError } from '../../utils/errorParser';
import {
  deleteShopDocument,
  signedShopDocumentUrl,
  uploadShopDocument,
} from '../../utils/uploadImage';
import { SIGNED_URL_TTL_SECONDS, type ShopDocument } from '../types/shopDocuments';

/**
 * A shop's licences and certificates.
 *
 * Files live in a private bucket and the table stores their path, so viewing
 * one means minting a short-lived signed URL. Both the row (RLS) and the object
 * (storage policy) are gated — protecting only the row would be pointless when
 * the row's whole content is a pointer to the file.
 *
 * Writes commit immediately rather than being staged until the surrounding form
 * is saved. Staging would mean uploading on save, and a failed shop update
 * after a successful upload leaves orphaned files in storage; an attachment
 * that persists the moment it is attached is also the behaviour people expect.
 * The editor says so explicitly rather than leaving it to be discovered.
 */
export function useShopDocuments(shopId: string | undefined) {
  const [documents, setDocuments] = useState<ShopDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!shopId) {
      setDocuments([]);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('shop_documents')
        .select('id, shop_id, label, storage_path, expires_at, archived_at, created_at')
        .eq('shop_id', shopId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setDocuments((data ?? []) as ShopDocument[]);
    } catch (error: any) {
      console.error('[useShopDocuments] load failed:', error);
      // Surfaced, not swallowed: an empty list after a failed read is
      // indistinguishable from having no documents, and a merchant who
      // believes their licence is missing will upload it again.
      toast.error('Could not load your documents. Refresh to try again.');
    } finally {
      setLoading(false);
    }
  }, [shopId]);

  useEffect(() => {
    load();
  }, [load]);

  const addDocument = useCallback(
    async (label: string, file: File, expiresAt: string | null) => {
      if (!shopId) return false;

      setBusy(true);
      let path: string | null = null;

      try {
        path = await uploadShopDocument(file, shopId);

        const { error } = await supabase
          .from('shop_documents')
          .insert([{ shop_id: shopId, label, storage_path: path, expires_at: expiresAt }]);

        if (error) throw error;

        toast.success('Document added');
        await load();
        return true;
      } catch (error: any) {
        console.error('[useShopDocuments] add failed:', error);
        // The row failed after the file landed. Worth attempting, but merchants
        // no longer hold delete on this bucket, so for them it will not
        // succeed — leaving an object no row references, which is invisible to
        // everyone and cleanable by an admin. That is the accepted cost of
        // merchants being unable to erase their own paperwork.
        if (path) await deleteShopDocument(path).catch(() => undefined);
        toast.error(parseAuthError(error));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [shopId, load],
  );

  /**
   * Retires a document without destroying it.
   *
   * Merchants have no delete permission on either the row or the file — these
   * are kept so there is a record if something goes wrong later, and the moment
   * something goes wrong is exactly when someone would want them gone. Archiving
   * clears it from the working view and nothing else.
   */
  const archiveDocument = useCallback(
    async (id: string, archived = true) => {
      setBusy(true);
      try {
        const { error } = await supabase
          .from('shop_documents')
          .update({ archived_at: archived ? new Date().toISOString() : null })
          .eq('id', id);
        if (error) throw error;

        setDocuments((current) =>
          current.map((d) =>
            d.id === id ? { ...d, archived_at: archived ? new Date().toISOString() : null } : d,
          ),
        );
        toast.success(archived ? 'Document archived' : 'Document restored');
        return true;
      } catch (error: any) {
        console.error('[useShopDocuments] archive failed:', error);
        toast.error(parseAuthError(error));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  /** Opens a document through a link that expires shortly after it is made. */
  const openDocument = useCallback(async (doc: ShopDocument) => {
    const url = await signedShopDocumentUrl(doc.storage_path, SIGNED_URL_TTL_SECONDS);
    if (!url) {
      toast.error('Could not open that document');
      return;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  }, []);

  return {
    documents: documents.filter((d) => !d.archived_at),
    archivedDocuments: documents.filter((d) => d.archived_at),
    loading,
    busy,
    reload: load,
    addDocument,
    archiveDocument,
    openDocument,
  };
}
