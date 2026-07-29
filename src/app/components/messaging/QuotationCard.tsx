// QuotationCard — an itemised quote rendered inside a message thread.
//
// This is the one place a buyer sees exactly what they are being charged for
// before any money moves, so it is a proper priced breakdown rather than a
// paragraph of text.

import { useState } from 'react';
import { useNavigate } from 'react-router';
import {
  FileText,
  CalendarClock,
  Check,
  X,
  Shield,
  Clock,
} from 'lucide-react';
import { supabase } from '../../../lib/supabaseClient';
import { useCart, toProduct } from '../../hooks/useCart';
import { useSendFlowStore } from '../../../utils/sendFlowStore';
import { formatCurrency } from '../../../utils/currency';
import { absoluteTime } from '../../../utils/relativeTime';
import { parseAuthError } from '../../../utils/errorParser';
import { toast } from 'sonner';
import { Button } from '../ui/button';
import {
  QUOTATION_STATUS_LABELS,
  type Quotation,
  type ViewerRole,
} from '../../types/messaging';

interface QuotationCardProps {
  quotation: Quotation;
  viewerRole: ViewerRole;
  shopName?: string | null;
  onChanged?: (q: Quotation) => void;
}

const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-amber-50 text-amber-700 border-amber-200',
  accepted: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  declined: 'bg-slate-100 text-slate-600 border-slate-200',
  withdrawn: 'bg-slate-100 text-slate-600 border-slate-200',
  expired: 'bg-slate-100 text-slate-500 border-slate-200',
};

export function QuotationCard({
  quotation,
  viewerRole,
  shopName,
  onChanged,
}: QuotationCardProps) {
  const navigate = useNavigate();
  const { addToCart, clearCart } = useCart();
  const [busy, setBusy] = useState(false);

  const lines = [...(quotation.quotation_line_items ?? [])].sort(
    (a, b) => a.sort_order - b.sort_order,
  );

  const isBuyer = viewerRole === 'buyer';
  const isPending = quotation.status === 'pending';
  const isExpired =
    quotation.valid_until != null && new Date(quotation.valid_until).getTime() <= Date.now();

  const handleAccept = async () => {
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc('accept_quotation', {
        p_quotation_id: quotation.id,
      });
      if (error) throw error;

      const result = data as {
        item_id: string;
        shop_id: string;
        total_amount: number;
        target_execution_date: string | null;
      };

      // The accepted quote is now an ordinary catalogue item, so it goes
      // through the normal cart and checkout rather than a bespoke payment path.
      clearCart();
      addToCart(
        toProduct({
          id: result.item_id,
          shop_id: result.shop_id,
          name: `Custom quote from ${shopName ?? 'the shop'}`,
          price_zmw: result.total_amount,
          is_available: true,
        }),
      );

      // Carried through checkout so the order records the agreed date and the
      // expiry clock runs from it rather than from the purchase.
      useSendFlowStore.getState().setTargetExecutionDate(result.target_execution_date);

      onChanged?.({ ...quotation, status: 'accepted' });
      toast.success('Quotation accepted. Complete payment to confirm.');
      navigate('/checkout');
    } catch (err: any) {
      toast.error(parseAuthError(err));
    } finally {
      setBusy(false);
    }
  };

  const handleDecline = async () => {
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc('decline_quotation', {
        p_quotation_id: quotation.id,
        p_reason: null,
      });
      if (error) throw error;
      const status = (data as { status: Quotation['status'] }).status;
      onChanged?.({ ...quotation, status });
      toast.success(status === 'declined' ? 'Quotation declined' : 'Quotation withdrawn');
    } catch (err: any) {
      toast.error(parseAuthError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="w-full max-w-md overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/70 px-4 py-3">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-primary" strokeWidth={1.75} />
          <span className="text-[11px] font-bold uppercase tracking-widest text-slate-500">
            Quotation
          </span>
        </div>
        <span
          className={`rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
            STATUS_STYLES[quotation.status] ?? STATUS_STYLES.declined
          }`}
        >
          {QUOTATION_STATUS_LABELS[quotation.status]}
        </span>
      </div>

      {/* Lines */}
      <div className="divide-y divide-slate-50">
        {lines.map((line) => (
          <div key={line.id} className="flex items-start justify-between gap-4 px-4 py-2.5">
            <div className="min-w-0">
              <p className="text-sm text-slate-800">{line.description}</p>
              {line.quantity > 1 && (
                <p className="mt-0.5 text-[11px] text-slate-400">
                  {line.quantity} × {formatCurrency(line.unit_price_zmw, 'ZMW')}
                </p>
              )}
            </div>
            <p className="shrink-0 text-sm font-medium tabular-nums text-slate-900">
              {formatCurrency(line.quantity * line.unit_price_zmw, 'ZMW')}
            </p>
          </div>
        ))}
      </div>

      {/* Total */}
      <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3">
        <span className="text-sm font-semibold text-slate-900">Total</span>
        <span className="text-lg font-light tracking-tight text-slate-900 tabular-nums">
          {formatCurrency(quotation.total_amount, 'ZMW')}
        </span>
      </div>

      {/* Terms */}
      {(quotation.notes || quotation.target_execution_date || quotation.valid_until) && (
        <div className="space-y-1.5 border-t border-slate-100 bg-slate-50/50 px-4 py-3">
          {quotation.notes && (
            <p className="text-xs leading-relaxed text-slate-600">{quotation.notes}</p>
          )}
          {quotation.target_execution_date && (
            <p className="flex items-center gap-1.5 text-xs text-slate-500">
              <CalendarClock className="h-3.5 w-3.5 shrink-0 text-slate-400" strokeWidth={1.75} />
              Scheduled for {absoluteTime(quotation.target_execution_date)}
            </p>
          )}
          {quotation.valid_until && (
            <p className="flex items-center gap-1.5 text-xs text-slate-500">
              <Clock className="h-3.5 w-3.5 shrink-0 text-slate-400" strokeWidth={1.75} />
              {isExpired ? 'Expired' : 'Valid until'} {absoluteTime(quotation.valid_until)}
            </p>
          )}
        </div>
      )}

      {/* Actions */}
      {isPending && !isExpired && (
        <div className="border-t border-slate-100 px-4 py-3">
          {isBuyer ? (
            <>
              <div className="flex gap-2">
                <Button onClick={handleAccept} disabled={busy} className="flex-1 gap-1.5">
                  <Check className="h-4 w-4" />
                  Accept &amp; Pay
                </Button>
                <Button
                  variant="outline"
                  onClick={handleDecline}
                  disabled={busy}
                  className="gap-1.5"
                >
                  <X className="h-4 w-4" />
                  Decline
                </Button>
              </div>
              <p className="mt-2.5 flex items-center gap-1.5 text-[11px] text-slate-400">
                <Shield className="h-3 w-3 shrink-0 text-orange-500" strokeWidth={2} />
                Held in escrow until the work is confirmed done.
              </p>
            </>
          ) : (
            <Button
              variant="outline"
              onClick={handleDecline}
              disabled={busy}
              className="w-full gap-1.5"
            >
              <X className="h-4 w-4" />
              Withdraw quotation
            </Button>
          )}
        </div>
      )}

      {quotation.status === 'declined' && quotation.decline_reason && (
        <div className="border-t border-slate-100 px-4 py-3">
          <p className="text-xs text-slate-500">Reason: {quotation.decline_reason}</p>
        </div>
      )}
    </div>
  );
}
