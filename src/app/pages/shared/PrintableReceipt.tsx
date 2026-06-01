import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router';
import { supabase } from '../../../lib/supabaseClient';
import { formatCurrency } from '../../../utils/currency';
import { Button } from '../../components/ui/button';
import { Printer, ArrowLeft, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

export function PrintableReceipt() {
  const { transactionId } = useParams<{ transactionId: string }>();
  const navigate = useNavigate();
  const [transaction, setTransaction] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchTransactionDetails = async () => {
      if (!transactionId) return;
      setLoading(true);
      try {
        const { data, error } = await supabase
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

        if (error) throw error;
        setTransaction(data);
      } catch (err) {
        console.error('[PrintableReceipt] fetch error:', err);
        toast.error('Failed to load transaction details.');
      } finally {
        setLoading(false);
      }
    };

    fetchTransactionDetails();
  }, [transactionId]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <Loader2 className="h-8 w-8 animate-spin text-slate-800" />
      </div>
    );
  }

  if (!transaction) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-white space-y-4">
        <p className="text-sm font-mono text-slate-500">Transaction details not found.</p>
        <Button variant="outline" size="sm" onClick={() => navigate(-1)}>
          Go Back
        </Button>
      </div>
    );
  }

  // Find the first merchant/shop name for the header
  const firstShopName = transaction.shop_orders?.[0]?.shop?.name || 'KithLy Vendor Partner';

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-mono p-4 sm:p-8 flex flex-col items-center select-none print:bg-white print:p-0">
      {/* Dynamic Print CSS Overrides */}
      <style dangerouslySetInnerHTML={{__html: `
        @media print {
          body * {
            visibility: hidden !important;
          }
          .print-section, .print-section * {
            visibility: visible !important;
          }
          .print-section {
            position: absolute !important;
            left: 50% !important;
            top: 0 !important;
            transform: translateX(-50%) !important;
            width: 100% !important;
            max-width: 100% !important;
            margin: 0 !important;
            padding: 0 !important;
            border: none !important;
            box-shadow: none !important;
            background: white !important;
          }
        }
      `}} />

      {/* Action buttons (hidden on print) */}
      <div className="w-full max-w-md flex items-center justify-between mb-8 print:hidden">
        <Button
          variant="ghost"
          size="sm"
          className="rounded-xl flex items-center gap-1.5 text-slate-600 hover:text-slate-900"
          onClick={() => navigate(-1)}
        >
          <ArrowLeft className="h-4 w-4" />
          <span>Back</span>
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="rounded-xl bg-slate-900 text-white hover:bg-slate-800 hover:text-white flex items-center gap-1.5 border-slate-900 shadow-sm"
          onClick={() => window.print()}
        >
          <Printer className="h-4 w-4" />
          <span>Download / Print PDF</span>
        </Button>
      </div>

      {/* Till Receipt Layout - Max width matching physical receipt rolls */}
      <div className="print-section w-full max-w-md p-8 border border-slate-200 rounded-sm bg-white shadow-sm flex flex-col items-center print:border-none print:shadow-none print:block">
        
        {/* Header */}
        <div className="text-center w-full space-y-1.5 mb-6 border-b border-dashed border-gray-300 pb-6">
          <h1 className="text-xl font-bold tracking-[0.25em] uppercase">*** KITHLY ***</h1>
          <p className="text-xs uppercase tracking-wide font-semibold text-slate-700">{firstShopName}</p>
          <p className="text-[10px] text-slate-500 font-mono">TX ID: {transaction.transaction_id.toUpperCase()}</p>
        </div>

        {/* Metadata Details */}
        <div className="w-full text-xs space-y-2 border-b border-dashed border-gray-300 pb-4 mb-4">
          <div className="flex justify-between">
            <span className="text-slate-500">DATE:</span>
            <span>{new Date(transaction.created_at).toLocaleString()}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">BUYER:</span>
            <span className="font-semibold">{transaction.buyer?.name?.toUpperCase() || 'GENERIC CUSTOMER'}</span>
          </div>
          {transaction.gateway_tx_ref && (
            <div className="flex justify-between">
              <span className="text-slate-500">GATEWAY REF:</span>
              <span className="font-mono text-[10px]">{transaction.gateway_tx_ref}</span>
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-slate-500">PAYMENT STATUS:</span>
            <span className="font-semibold text-emerald-600">{transaction.status}</span>
          </div>
        </div>

        {/* Line Items */}
        <div className="w-full text-xs mb-6 space-y-3">
          <div className="flex justify-between font-bold border-b border-dashed border-gray-300 pb-2">
            <span>ITEM NAME</span>
            <span>QTY</span>
            <span>PRICE</span>
          </div>

          {transaction.shop_orders?.map((order: any) => (
            <div key={order.shop_order_id} className="space-y-1.5 pt-1">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex justify-between">
                <span>[DEALER: {order.shop?.name || 'PARTNER SHOP'}]</span>
                <span>CODE: {order.claim_code}</span>
              </div>
              {order.order_items?.map((orderItem: any) => (
                <div key={orderItem.order_item_id} className="flex justify-between items-center w-full py-0.5">
                  <span className="truncate max-w-[220px] font-semibold text-slate-800">
                    {orderItem.items?.name || 'KithLy Gift Item'}
                  </span>
                  <span className="flex-1 border-b border-dotted border-slate-300 mx-2 mt-2" />
                  <span className="shrink-0 text-slate-500 mr-4 font-mono text-[11px]">x1</span>
                  <span className="shrink-0 font-bold font-mono">
                    {formatCurrency(orderItem.allocated_price, 'ZMW')}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>

        {/* Total Price Section */}
        <div className="w-full text-xs space-y-2 border-t border-dashed border-gray-300 pt-4">
          <div className="flex justify-between text-sm font-bold tracking-wide">
            <span>TOTAL AMOUNT PAID:</span>
            <span className="text-slate-900 font-mono text-sm">
              {formatCurrency(transaction.total_amount, 'ZMW')}
            </span>
          </div>
        </div>

        {/* Footer */}
        <div className="text-center w-full space-y-1.5 mt-8 border-t border-dashed border-gray-300 pt-6">
          <p className="text-[10px] text-slate-500 uppercase tracking-widest">*** THANK YOU FOR GIFTING ***</p>
          <p className="text-[9px] text-slate-400">Escrow guaranteed. Retail network verified.</p>
          <p className="text-[9px] font-bold text-slate-500 mt-2">*** KEEP THIS RECEIPT FOR YOUR RECORDS ***</p>
        </div>

      </div>
    </div>
  );
}
