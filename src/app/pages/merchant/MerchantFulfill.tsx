/**
 * MerchantFulfill — Handover Checklist Terminal
 *
 * Flow:
 *   IDLE       → 8-char OTP code entry
 *   LOADING    → Fetches shop_order + order_items by claim_code
 *   CHECKLIST  → Cashier checks/unchecks items; dynamic payout total
 *   SUBMITTING → Calls fulfill-voucher Edge Function
 *   SUCCESS    → Confirmation screen
 *   REJECTED   → Error with reason
 */

import { useState, useRef, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import { ArrowLeft, ShieldCheck, PackageCheck, Package } from 'lucide-react';
import { supabase } from '../../../utils/supabase/client';
import { useAuth } from '../../../utils/auth/AuthContext';
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
  InputOTPSeparator,
} from '../../components/ui/input-otp';
import { Button } from '../../components/ui/button';
import { Checkbox } from '../../components/ui/checkbox';
import { cn } from '../../components/ui/utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Stage = 'IDLE' | 'LOADING' | 'CHECKLIST' | 'SUBMITTING' | 'SUCCESS' | 'REJECTED';

interface OrderItem {
  order_item_id: string;
  item_id: string;
  allocated_price: number;
  item_name: string;
  item_image_url: string | null;
}

interface ShopOrder {
  shop_order_id: string;
  shop_id: string;
  claim_code: string;
  subtotal: number;
}

// ---------------------------------------------------------------------------
// Animation preset
// ---------------------------------------------------------------------------

const panel = {
  hidden:  { opacity: 0, y: 18 },
  visible: { opacity: 1, y: 0,  transition: { duration: 0.42, ease: [0.22, 1, 0.36, 1] } },
  exit:    { opacity: 0, y: -10, transition: { duration: 0.22, ease: 'easeIn' } },
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const fmt = (n: number) =>
  new Intl.NumberFormat('en-ZM', { style: 'currency', currency: 'ZMW', maximumFractionDigits: 0 }).format(n);

export function MerchantFulfill() {
  const navigate = useNavigate();
  const { profile } = useAuth();

  const [stage, setStage]           = useState<Stage>('IDLE');
  const [code, setCode]             = useState('');
  const [shopOrder, setShopOrder]   = useState<ShopOrder | null>(null);
  const [items, setItems]           = useState<OrderItem[]>([]);
  const [checked, setChecked]       = useState<Record<string, boolean>>({});
  const [rejectReason, setRejectReason] = useState('');

  const submittingRef = useRef(false);

  // ---- helpers -------------------------------------------------------

  const { checkedIds, uncheckedIds, payoutTotal } = useMemo(() => {
    const cIds: string[] = [];
    const uIds: string[] = [];
    let total = 0;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (checked[item.order_item_id]) {
        cIds.push(item.order_item_id);
        total += item.allocated_price;
      } else {
        uIds.push(item.order_item_id);
      }
    }

    return { checkedIds: cIds, uncheckedIds: uIds, payoutTotal: total };
  }, [items, checked]);

  // ---- fetch order ---------------------------------------------------

  const handleCodeComplete = useCallback(async (val: string) => {
    if (val.length !== 8) return;

    if (!navigator.onLine) {
      setRejectReason('No internet connection. Please check your network.');
      setStage('REJECTED');
      return;
    }

    setStage('LOADING');

    try {
      // Unified Supabase Relational Query
      // Fetches the order, enforces the merchant's ownership via !inner join,
      // and retrieves all items in a single network round-trip.
      const { data: orderData, error: orderErr } = await supabase
        .from('shop_orders')
        .select(`
          shop_order_id, 
          shop_id, 
          claim_code, 
          subtotal,
          merchant_shops!inner ( user_id ),
          order_items (
            order_item_id,
            item_id,
            allocated_price,
            items ( name, image_url )
          )
        `)
        .eq('claim_code', val.toUpperCase())
        .eq('merchant_shops.user_id', profile?.id)
        .single();

      if (orderErr || !orderData) {
        setRejectReason('This code is invalid or does not belong to your shop.');
        setStage('REJECTED');
        return;
      }

      const rawItems = orderData.order_items;
      if (!rawItems || !Array.isArray(rawItems) || rawItems.length === 0) {
        throw new Error('Failed to load order items.');
      }

      const mapped: OrderItem[] = (rawItems as any[]).map(r => ({
        order_item_id:   r.order_item_id,
        item_id:         r.item_id,
        allocated_price: r.allocated_price,
        item_name:       r.items?.name       ?? 'Unknown Item',
        item_image_url:  r.items?.image_url  ?? null,
      }));

      // All items checked by default
      const initial: Record<string, boolean> = {};
      mapped.forEach(i => { initial[i.order_item_id] = true; });

      const { merchant_shops, order_items, ...cleanOrder } = orderData;
      setShopOrder(cleanOrder as unknown as ShopOrder);
      setItems(mapped);
      setChecked(initial);
      setStage('CHECKLIST');
    } catch (err: any) {
      const isNetworkError = err.message?.toLowerCase().includes('fetch') || !navigator.onLine;
      setRejectReason(isNetworkError ? 'Network error. Please check your connection and try again.' : (err.message ?? 'Verification failed. Please try again.'));
      setStage('REJECTED');
    }
  }, [profile?.id]);

  // ---- confirm handover ----------------------------------------------

  const handleConfirm = useCallback(async () => {
    if (submittingRef.current || !shopOrder) return;

    if (!navigator.onLine) {
      setRejectReason('No internet connection. Please check your network.');
      setStage('REJECTED');
      return;
    }

    submittingRef.current = true;
    setStage('SUBMITTING');

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error('Session expired. Please log in again.');

      const payload = {
        claim_code:       shopOrder.claim_code,
        shop_id:          shopOrder.shop_id,
        present_item_ids: checkedIds,
        missing_item_ids: uncheckedIds,
      };

      const { data, error } = await supabase.functions.invoke('fulfill-voucher', {
        body: payload,
      });

      if (error || !data?.success) {
        const reason = data?.rejection_reason ?? error?.message ?? 'Handover rejected.';
        setRejectReason(reason);
        if ('vibrate' in navigator) navigator.vibrate([300]);
        toast.error('Handover rejected', { description: reason });
        setStage('REJECTED');
        return;
      }

      if ('vibrate' in navigator) navigator.vibrate([80, 40, 80]);
      toast.success('Handover confirmed!');
      setStage('SUCCESS');
    } catch (err: any) {
      const isNetworkError = err.message?.toLowerCase().includes('fetch') || !navigator.onLine;
      setRejectReason(isNetworkError ? 'Network error. Please check your connection and try again.' : (err.message ?? 'Network error. Please try again.'));
      setStage('REJECTED');
    } finally {
      submittingRef.current = false;
    }
  }, [shopOrder, checkedIds, uncheckedIds]);

  // ---- reset ---------------------------------------------------------

  const handleReset = useCallback(() => {
    setCode('');
    setShopOrder(null);
    setItems([]);
    setChecked({});
    setRejectReason('');
    setStage('IDLE');
  }, []);

  // ---- render --------------------------------------------------------

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="sticky top-0 z-10 border-b border-slate-100 bg-white">
        <div className="mx-auto flex max-w-xl items-center gap-3 px-5 py-4">
          <button
            onClick={() => navigate('/merchant')}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
            aria-label="Back to merchant dashboard"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <h1 className="text-base font-semibold tracking-tight text-slate-900">
            Handover Terminal
          </h1>
          <span className="ml-auto text-xs font-medium uppercase tracking-widest text-slate-300">
            KithLy POS
          </span>
        </div>
      </div>

      <div className="mx-auto max-w-xl px-5 py-10">
        <AnimatePresence mode="wait">

          {/* ---- IDLE: code entry ---- */}
          {stage === 'IDLE' && (
            <motion.div key="idle" variants={panel} initial="hidden" animate="visible" exit="exit"
              className="flex flex-col items-center gap-8 rounded-2xl bg-white p-8 shadow-sm border border-slate-100"
            >
              <div className="flex flex-col items-center gap-2 text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-slate-100">
                  <ShieldCheck className="h-7 w-7 text-slate-700" strokeWidth={1.5} />
                </div>
                <h2 className="text-xl font-semibold text-slate-900">Enter Claim Code</h2>
                <p className="text-sm text-slate-500">
                  Type or scan the 8-character code from the customer's WhatsApp message.
                </p>
              </div>

              <InputOTP
                maxLength={8}
                value={code}
                onChange={setCode}
                onComplete={handleCodeComplete}
                aria-label="Gift claim code"
              >
                <InputOTPGroup>
                  {[0,1,2,3].map(i => (
                    <InputOTPSlot key={i} index={i} className="h-14 w-11 text-lg font-mono uppercase" />
                  ))}
                </InputOTPGroup>
                <InputOTPSeparator />
                <InputOTPGroup>
                  {[4,5,6,7].map(i => (
                    <InputOTPSlot key={i} index={i} className="h-14 w-11 text-lg font-mono uppercase" />
                  ))}
                </InputOTPGroup>
              </InputOTP>

              <p className="text-xs text-slate-400">Auto-submits when all 8 characters are entered.</p>

              <div className="w-full rounded-xl border border-slate-100 bg-slate-50 p-4 flex gap-3 items-start">
                <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.25"
                  className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden>
                  <path d="M10 2L3 5v5c0 4.4 3 8.5 7 9.5C14 18.5 17 14.4 17 10V5L10 2z" />
                </svg>
                <p className="text-xs text-slate-500 leading-relaxed">
                  This terminal displays <span className="font-medium text-slate-700">item information only</span>.
                  No pricing or account data is shown to the cashier.
                </p>
              </div>
            </motion.div>
          )}

          {/* ---- LOADING ---- */}
          {stage === 'LOADING' && (
            <motion.div key="loading" variants={panel} initial="hidden" animate="visible" exit="exit"
              className="flex flex-col items-center gap-8 rounded-2xl bg-white p-12 shadow-sm border border-slate-100"
            >
              <div className="relative flex h-20 w-20 items-center justify-center" aria-hidden>
                <motion.span className="absolute h-20 w-20 rounded-full border border-slate-200"
                  animate={{ scale: [1, 1.15, 1], opacity: [0.5, 0.1, 0.5] }}
                  transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }} />
                <motion.span className="absolute h-12 w-12 rounded-full border border-slate-300"
                  animate={{ scale: [1, 1.1, 1], opacity: [0.7, 0.2, 0.7] }}
                  transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut', delay: 0.2 }} />
                <span className="h-5 w-5 rounded-full bg-slate-800" />
              </div>
              <div className="flex flex-col items-center gap-1 text-center">
                <p className="text-lg font-medium text-slate-900">Fetching order…</p>
                <p className="text-sm text-slate-500">Checking the secure ledger.</p>
              </div>
            </motion.div>
          )}

          {/* ---- CHECKLIST ---- */}
          {stage === 'CHECKLIST' && shopOrder && (
            <motion.div key="checklist" variants={panel} initial="hidden" animate="visible" exit="exit"
              className="flex flex-col gap-5"
            >
              {/* Order header */}
              <div className="rounded-2xl bg-white border border-slate-100 shadow-sm px-5 py-4 flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium uppercase tracking-widest text-slate-400 mb-0.5">Claim Code</p>
                  <p className="font-mono text-lg font-semibold text-slate-900">{shopOrder.claim_code}</p>
                </div>
                <span className="rounded-full bg-emerald-50 border border-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">
                  {items.length} item{items.length !== 1 ? 's' : ''}
                </span>
              </div>

              {/* Checklist */}
              <div className="rounded-2xl bg-white border border-slate-100 shadow-sm overflow-hidden">
                <div className="px-5 py-3 border-b border-slate-50">
                  <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">
                    Handover Checklist
                  </p>
                </div>

                <div className="divide-y divide-slate-50">
                  {items.map((item, idx) => {
                    const isChecked = checked[item.order_item_id] ?? true;
                    return (
                      <motion.label
                        key={item.order_item_id}
                        initial={{ opacity: 0, x: -6 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: idx * 0.06 }}
                        htmlFor={`item-${item.order_item_id}`}
                        className={cn(
                          'flex items-center gap-4 px-5 py-4 cursor-pointer transition-colors select-none',
                          isChecked ? 'bg-white hover:bg-slate-50' : 'bg-red-50/60 hover:bg-red-50',
                        )}
                      >
                        {/* Thumbnail */}
                        <div className="h-12 w-12 rounded-xl overflow-hidden bg-slate-100 flex-shrink-0">
                          {item.item_image_url ? (
                            <img src={item.item_image_url} alt={item.item_name}
                              className="h-full w-full object-cover" />
                          ) : (
                            <div className="h-full w-full flex items-center justify-center">
                              <Package className="h-5 w-5 text-slate-300" />
                            </div>
                          )}
                        </div>

                        {/* Name */}
                        <div className="flex-1 min-w-0">
                          <p className={cn(
                            'font-medium truncate transition-colors',
                            isChecked ? 'text-slate-900' : 'text-slate-400 line-through',
                          )}>
                            {item.item_name}
                          </p>
                          {!isChecked && (
                            <p className="text-xs text-red-500 mt-0.5 font-medium">Marked as missing</p>
                          )}
                        </div>

                        {/* Checkbox */}
                        <Checkbox
                          id={`item-${item.order_item_id}`}
                          checked={isChecked}
                          onCheckedChange={(v) =>
                            setChecked(prev => ({ ...prev, [item.order_item_id]: !!v }))
                          }
                          className={cn(
                            'h-5 w-5 rounded-md border-slate-300 flex-shrink-0',
                            isChecked && 'data-[state=checked]:bg-slate-900 data-[state=checked]:border-slate-900',
                          )}
                          aria-label={`Mark ${item.item_name} as present`}
                        />
                      </motion.label>
                    );
                  })}
                </div>
              </div>

              {/* Dynamic payout summary */}
              <motion.div
                className={cn(
                  'rounded-2xl border px-5 py-4 flex items-center justify-between transition-colors',
                  uncheckedIds.length > 0
                    ? 'border-amber-200 bg-amber-50'
                    : 'border-slate-100 bg-white',
                )}
                layout
              >
                <div>
                  <p className="text-xs font-medium uppercase tracking-widest text-slate-400 mb-0.5">
                    Total Value to Payout
                  </p>
                  <motion.p
                    key={payoutTotal}
                    initial={{ scale: 0.95, opacity: 0.7 }}
                    animate={{ scale: 1, opacity: 1 }}
                    className="text-2xl font-bold text-slate-900"
                  >
                    {fmt(payoutTotal)}
                  </motion.p>
                  {uncheckedIds.length > 0 && (
                    <p className="text-xs text-amber-600 mt-1">
                      {uncheckedIds.length} item{uncheckedIds.length !== 1 ? 's' : ''} marked missing — payout adjusted.
                    </p>
                  )}
                </div>
                <PackageCheck className={cn(
                  'h-8 w-8 flex-shrink-0',
                  uncheckedIds.length > 0 ? 'text-amber-400' : 'text-slate-300',
                )} strokeWidth={1.5} />
              </motion.div>

              {/* Confirm button */}
              <Button
                id="confirm-handover-button"
                onClick={handleConfirm}
                disabled={checkedIds.length === 0}
                className="w-full h-14 text-base font-semibold rounded-2xl bg-slate-900 hover:bg-slate-800 text-white"
              >
                Confirm Handover
              </Button>

              <button onClick={handleReset}
                className="w-full text-center text-sm text-slate-400 hover:text-slate-600 transition-colors py-1">
                Cancel &amp; scan a different code
              </button>
            </motion.div>
          )}

          {/* ---- SUBMITTING ---- */}
          {stage === 'SUBMITTING' && (
            <motion.div key="submitting" variants={panel} initial="hidden" animate="visible" exit="exit"
              className="flex flex-col items-center gap-8 rounded-2xl bg-white p-12 shadow-sm border border-slate-100"
            >
              <div className="relative flex h-20 w-20 items-center justify-center" aria-hidden>
                <motion.span className="absolute h-20 w-20 rounded-full border border-orange-200"
                  animate={{ scale: [1, 1.18, 1], opacity: [0.4, 0.1, 0.4] }}
                  transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }} />
                <motion.span className="absolute h-12 w-12 rounded-full border border-orange-300"
                  animate={{ scale: [1, 1.1, 1], opacity: [0.6, 0.2, 0.6] }}
                  transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut', delay: 0.25 }} />
                <ShieldCheck className="h-7 w-7 text-slate-700" strokeWidth={1.5} />
              </div>
              <div className="flex flex-col items-center gap-1 text-center">
                <p className="text-lg font-medium text-slate-900">Recording handover…</p>
                <p className="text-sm text-slate-500">Writing to the secure escrow ledger.</p>
              </div>
            </motion.div>
          )}

          {/* ---- SUCCESS ---- */}
          {stage === 'SUCCESS' && (
            <motion.div key="success" variants={panel} initial="hidden" animate="visible" exit="exit"
              className="flex flex-col items-center gap-8 rounded-2xl bg-white p-10 shadow-sm border border-slate-100 text-center"
            >
              <motion.div
                className="flex h-20 w-20 items-center justify-center rounded-full border border-slate-200 bg-white shadow-sm"
                initial={{ scale: 0.7, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                aria-hidden
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
                  strokeLinecap="round" strokeLinejoin="round" className="h-9 w-9 text-slate-900">
                  <motion.path d="M4.5 12.75l6 6 9-13.5"
                    initial={{ pathLength: 0 }}
                    animate={{ pathLength: 1 }}
                    transition={{ duration: 0.55, ease: 'easeOut', delay: 0.25 }} />
                </svg>
              </motion.div>

              <div className="flex flex-col gap-2">
                <h2 className="text-2xl font-semibold tracking-tight text-slate-900">Handover Confirmed</h2>
                <p className="text-sm text-slate-500 max-w-xs">
                  The escrow ledger has been updated. Funds will be included in the next settlement batch.
                </p>
              </div>

              <div className="w-full rounded-xl border border-slate-100 bg-slate-50 px-5 py-3 flex justify-between">
                <span className="text-xs text-slate-400">Items handed over</span>
                <span className="text-sm font-semibold text-slate-800">{checkedIds.length}</span>
              </div>

              <Button
                onClick={handleReset}
                className="w-full h-12 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-medium"
              >
                Verify next code
              </Button>
            </motion.div>
          )}

          {/* ---- REJECTED ---- */}
          {stage === 'REJECTED' && (
            <motion.div key="rejected" variants={panel} initial="hidden" animate="visible" exit="exit"
              className="flex flex-col items-center gap-8 rounded-2xl bg-white p-10 shadow-sm border border-slate-100 text-center"
            >
              <motion.div
                className="flex h-20 w-20 items-center justify-center rounded-full border border-slate-200 bg-white"
                initial={{ scale: 0.7, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
                aria-hidden
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
                  strokeLinecap="round" strokeLinejoin="round" className="h-9 w-9 text-slate-400">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </motion.div>

              <div className="flex flex-col gap-2">
                <h2 className="text-2xl font-semibold tracking-tight text-slate-900">Do Not Redeem</h2>
                <p className="text-sm text-slate-500 max-w-xs">This code was rejected by the secure ledger.</p>
              </div>

              <div className="w-full rounded-xl border border-slate-100 bg-slate-50 p-4 text-left">
                <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-2">Reason</p>
                <p className="text-sm text-slate-600 leading-relaxed">{rejectReason}</p>
              </div>

              <div className="flex w-full flex-col gap-3">
                <Button onClick={handleReset}
                  className="w-full h-12 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-medium">
                  Try another code
                </Button>
                <Button variant="ghost"
                  className="w-full text-sm text-slate-400 hover:text-slate-600"
                  onClick={() => window.open('mailto:merchants@kithly.com', '_blank')}>
                  Contact merchant support
                </Button>
              </div>
            </motion.div>
          )}

        </AnimatePresence>
      </div>
    </div>
  );
}

export default MerchantFulfill;
