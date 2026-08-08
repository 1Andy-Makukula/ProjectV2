import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { toast } from 'sonner';
import { parseAuthError } from '../../utils/errorParser';
import { deleteStorefrontAsset } from '../../utils/uploadImage';
import type { ShopDocument } from '../types/shopDocuments';

/**
 * A shop's licences and certificates.
 *
 * Readable only by the shop's own merchants and by admins — these are
 * compliance papers, not storefront content, and RLS enforces that rather than
 * the UI simply not linking to them.
 */
export function useShopDocuments(shopId: string | undefined) {
  const [documents, setDocuments] = useState<ShopDocument[]>([]);
  const [loading, setLoading] = useState(true);

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
        .select('id, shop_id, label, document_url, expires_at, created_at')
        .eq('shop_id', shopId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setDocuments((data ?? []) as ShopDocument[]);
    } catch (error: any) {
      console.error('[useShopDocuments] load failed:', error);
    } finally {
      setLoading(false);
    }
  }, [shopId]);

  useEffect(() => {
    load();
  }, [load]);

  const addDocument = useCallback(
    async (label: string, documentUrl: string, expiresAt: string | null) => {
      if (!shopId) return false;

      try {
        const { error } = await supabase.from('shop_documents').insert([
          { shop_id: shopId, label, document_url: documentUrl, expires_at: expiresAt },
        ]);
        if (error) throw error;

        toast.success('Document added');
        await load();
        return true;
      } catch (error: any) {
        console.error('[useShopDocuments] add failed:', error);
        toast.error(parseAuthError(error));
        return false;
      }
    },
    [shopId, load],
  );

  const removeDocument = useCallback(
    async (id: string) => {
      const doc = documents.find((d) => d.id === id);

      try {
        const { error } = await supabase.from('shop_documents').delete().eq('id', id);
        if (error) throw error;

        // The row goes with the delete but the file does not — it has to be
        // removed explicitly or it lingers in storage indefinitely.
        if (doc?.document_url) {
          await deleteStorefrontAsset(doc.document_url).catch(console.error);
        }

        setDocuments((current) => current.filter((d) => d.id !== id));
        return true;
      } catch (error: any) {
        console.error('[useShopDocuments] remove failed:', error);
        toast.error(parseAuthError(error));
        return false;
      }
    },
    [documents],
  );

  return { documents, loading, reload: load, addDocument, removeDocument };
}
