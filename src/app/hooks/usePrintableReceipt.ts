import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { parseAuthError } from '../../utils/errorParser';
import { toast } from 'sonner';

export function usePrintableReceipt(transactionId: string | undefined) {
  const [transaction, setTransaction] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchTransactionDetails = async () => {
      if (!transactionId) return;
      setLoading(true);
      setError(null);
      try {
        const { data, error: dbError } = await supabase
          .from('transactions')
          .select(`
            transaction_id,
            buyer_id,
            total_amount,
            status,
            gateway_tx_ref,
            created_at,
            buyer:buyer_id (name, email),
            shop_orders (
              shop_order_id,
              claim_code,
              claim_status,
              subtotal,
              recipient_name,
              recipient_phone,
              shop:shop_id (name, location),
              order_items (
                order_item_id,
                allocated_price,
                fulfillment_status,
                items:item_id (name)
              )
            )
          `)
          .eq('transaction_id', transactionId)
          .single();

        if (dbError) throw dbError;
        setTransaction(data);
      } catch (err: any) {
        console.error('[usePrintableReceipt] fetch error:', err);
        const parsed = parseAuthError(err);
        setError(parsed);
        toast.error('Failed to load transaction details.');
      } finally {
        setLoading(false);
      }
    };

    fetchTransactionDetails();
  }, [transactionId]);

  return { transaction, loading, error };
}
