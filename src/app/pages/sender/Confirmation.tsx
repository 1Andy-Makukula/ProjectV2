import { useEffect, useState, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { motion, AnimatePresence } from 'motion/react';
import { supabase } from '../../../lib/supabaseClient';
import { useAuth } from '../../../utils/auth/AuthContext';
import { formatCurrency } from '../../../utils/currency';
import { getGiftPageUrl } from '../../../utils/whatsapp';
import { Button } from '../../components/ui/button';
import { toast } from 'sonner';
import {
  CheckCircle2,
  Copy,
  ExternalLink,
  Loader2,
  Package,
  Gift,
  MapPin,
  ArrowRight,
  MessageSquare,
  Share,
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { WhatsAppShareButton } from '../../components/shared/WhatsAppShareButton';
import QRCode from 'react-qr-code';

// ---------------------------------------------------------------------------
// V2 Schema Types
// ---------------------------------------------------------------------------

interface ShopOrderConfirm {
  shop_order_id: string;
  claim_code: string;
  claim_status: string; // PENDING_PAYMENT | PENDING | REDEEMED
  recipient_name: string | null;
  message: string | null;
  shop: {
    id: string;
    name: string;
    location: string | null;
  } | null;
  order_items: Array<{
    child_claim_code?: string;
    item: {
      id: string;
      name: string;
      description: string | null;
      image_url: string | null;
    } | null;
  }>;
}

interface TransactionConfirm {
  transaction_id: string;
  buyer_id: string;
  total_amount: number;
  status: string;         // GATEWAY_PROCESSING | SUCCESSFUL | FAILED
  gateway_tx_ref: string | null;
  created_at: string;
  shop_orders: ShopOrderConfirm[];
}

// ---------------------------------------------------------------------------
// Payment status polling hook
// ---------------------------------------------------------------------------

function usePaymentConfirmation(transactionId: string | null, txRef: string | null, statusParam: string | null) {
  const [transaction, setTransaction] = useState<TransactionConfirm | null>(null);
  const [pollingStatus, setPollingStatus] = useState<
    'idle' | 'polling' | 'confirmed' | 'failed'
  >('idle');
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const attemptsRef = useRef(0);
  const MAX_ATTEMPTS = 20;

  const fetchTransaction = async (id: string): Promise<TransactionConfirm | null> => {
    const { data, error } = await supabase
      .from('transactions')
      .select(`
        transaction_id,
        buyer_id,
        total_amount,
        status,
        gateway_tx_ref,
        created_at,
        shop_orders (
          shop_order_id,
          claim_code,
          claim_status,
          recipient_name,
          message,
          shop:shop_id (id, name, location),
          order_items (
            child_claim_code,
            item:item_id (id, name, description, image_url)
          )
        )
      `)
      .eq('transaction_id', id)
      .single();

    if (error) {
      console.error('[Confirmation] fetch error:', error);
      return null;
    }

    return data as unknown as TransactionConfirm;
  };

  useEffect(() => {
    if (!transactionId) return;

    setPollingStatus('polling');
    attemptsRef.current = 0;

    const poll = async () => {
      attemptsRef.current += 1;
      const txn = await fetchTransaction(transactionId);

      if (!txn) {
        if (attemptsRef.current >= MAX_ATTEMPTS) {
          clearInterval(pollingRef.current!);
          setPollingStatus('failed');
        }
        return;
      }

      setTransaction(txn);

      if (txn.status === 'SUCCESSFUL') {
        clearInterval(pollingRef.current!);
        setPollingStatus('confirmed');
        return;
      }

      if (txn.status === 'FAILED' || txn.status === 'CANCELLED') {
        clearInterval(pollingRef.current!);
        setPollingStatus('failed');
        return;
      }

      if (attemptsRef.current >= MAX_ATTEMPTS) {
        clearInterval(pollingRef.current!);
        setPollingStatus('failed');
      }
    };

    // If Flutterwave explicitly tells us it was successful, don't wait for the webhook, verify instantly!
    if (statusParam === 'successful' && txRef) {
      verifyManually();
    } else {
      // Kick off immediately, then poll every 3 seconds
      poll();
      pollingRef.current = setInterval(poll, 3000);
    }

    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [transactionId, statusParam, txRef]);

  const verifyManually = async () => {
    if (!txRef) return;

    setPollingStatus('polling');

    try {
      const { data, error } = await supabase.functions.invoke('server', {
        body: { action: 'verify_payment', txRef },
      });

      if (error) throw error;
      if (data?.success && transactionId) {
        const txn = await fetchTransaction(transactionId);
        if (txn) setTransaction(txn);
        setPollingStatus('confirmed');
      } else {
        if (data?.error) {
          console.error('[Confirmation] Server returned error:', data.error);
          toast.error(`Verification Failed: ${data.error}`);
        }
        setPollingStatus('failed');
      }
    } catch (err: any) {
      console.error('[Confirmation] verify error:', err);
      toast.error(err.message || 'Verification failed');
      setPollingStatus('failed');
    }
  };

  return { transaction, pollingStatus, verifyManually };
}

// ---------------------------------------------------------------------------
// Sub-views
// ---------------------------------------------------------------------------

function PollingView({ attempt, max }: { attempt: number; max: number }) {
  const progress = Math.min((attempt / max) * 100, 100);
  return (
    <div className="flex flex-col items-center gap-10 text-center">
      <div className="relative flex items-center justify-center" aria-hidden>
        <motion.span
          className="absolute h-28 w-28 rounded-full border border-orange-100"
          animate={{ scale: [1, 1.15, 1], opacity: [0.4, 0.1, 0.4] }}
          transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.span
          className="absolute h-20 w-20 rounded-full border border-orange-200"
          animate={{ scale: [1, 1.1, 1], opacity: [0.6, 0.2, 0.6] }}
          transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut', delay: 0.3 }}
        />
        <motion.span
          className="h-10 w-10 rounded-full bg-gradient-to-br from-primary to-primary-light shadow-md"
          animate={{ scale: [1, 0.9, 1] }}
          transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut', delay: 0.15 }}
        />
      </div>
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Verifying your payment</h1>
        <p className="mt-2 max-w-xs text-sm text-slate-500">
          Your payment is being confirmed by the network. This usually takes a few seconds.
        </p>
      </div>
      <div className="w-full max-w-xs">
        <div className="mb-1.5 flex justify-between text-xs text-slate-400">
          <span>Check {attempt} of {max}</span>
          <span>{Math.round(progress)}%</span>
        </div>
        <div className="h-px w-full overflow-hidden rounded-full bg-slate-100">
          <motion.div
            className="h-full bg-primary"
            initial={{ width: '0%' }}
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.6, ease: 'easeOut' }}
          />
        </div>
      </div>
    </div>
  );
}

function SuccessView({ transaction, onDone }: { transaction: TransactionConfirm; onDone: () => void }) {
  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copied`);
  };

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.45 }}
      className="flex w-full flex-col items-center gap-8"
    >
      {/* Confirmation mark */}
      <motion.div
        initial={{ scale: 0.7, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="flex h-20 w-20 items-center justify-center rounded-full border border-green-200 bg-green-50"
      >
        <CheckCircle2 className="h-10 w-10 text-green-500" strokeWidth={1.5} />
      </motion.div>

      <div className="text-center">
        <h1 className="text-2xl font-semibold text-slate-900">Gift Secured!</h1>
        <p className="mt-2 max-w-sm text-sm text-slate-500">
          Your payment of{' '}
          <span className="font-semibold text-primary">
            {formatCurrency(transaction.total_amount, 'ZMW')}
          </span>{' '}
          is held in escrow. Share the claim code with your recipient.
        </p>
      </div>

      {transaction.shop_orders.map((shopOrder, idx) => {
        const firstItem = shopOrder.order_items?.[0]?.item;
        const giftUrl = getGiftPageUrl(shopOrder.claim_code);

        // Group identical items for the checklist
        const groupedItems = shopOrder.order_items.reduce((acc, curr) => {
          if (!curr.item) return acc;
          const existing = acc.find(i => i.item.id === curr.item?.id);
          if (existing) {
            existing.quantity += 1;
          } else {
            acc.push({ item: curr.item, quantity: 1 });
          }
          return acc;
        }, [] as Array<{ item: { id: string; name: string; image_url: string | null }; quantity: number }>);

        return (
          <motion.div
            key={shopOrder.shop_order_id}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 + idx * 0.1 }}
            className="w-full overflow-hidden rounded-2xl border border-slate-100 bg-slate-50"
          >
            {/* Product row */}
            <div className="flex items-center gap-3 border-b border-slate-100 p-4">
              <div className="h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-slate-200">
                {firstItem?.image_url ? (
                  <img src={firstItem.image_url} alt={firstItem.name ?? ''} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center">
                    <Package className="h-6 w-6 text-slate-400" />
                  </div>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-slate-900 truncate">{firstItem?.name ?? 'Gift item'}</p>
                {shopOrder.shop && (
                  <div className="mt-0.5 flex items-center gap-1 text-xs text-slate-500">
                    <MapPin className="h-3 w-3" />
                    {shopOrder.shop.name}
                    {shopOrder.shop.location && ` · ${shopOrder.shop.location}`}
                  </div>
                )}
              </div>
            </div>

            {/* Master Claim Code & QR Code */}
            <div className="px-4 py-4">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400 text-center">
                Master Claim Code
              </p>
              
              <div className="flex flex-col items-center justify-center mb-6">
                <div className="rounded-2xl border border-orange-200 bg-white p-4 shadow-sm">
                  <QRCode
                    value={shopOrder.claim_code}
                    size={160}
                    level="H"
                    className="h-auto max-w-full"
                    fgColor="#1E3A8A" // Primary blue
                  />
                </div>
              </div>

              <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3">
                <span className="font-mono text-xl font-bold tracking-[0.2em] text-slate-800">
                  {shopOrder.claim_code}
                </span>
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => copyToClipboard(shopOrder.claim_code, 'Master claim code')}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => window.open(giftUrl, '_blank')}
                  >
                    <ExternalLink className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>

            {/* Bulleted Checklist of Bundle Items */}
            <div className="border-t border-slate-100 bg-white px-4 py-4">
              <p className="text-sm font-semibold text-slate-800 mb-2">Bundle Contents</p>
              <ul className="space-y-2">
                {groupedItems.map((group, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-slate-600">
                    <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-orange-100 text-[10px] font-bold text-orange-600">
                      {group.quantity}
                    </span>
                    <span>{group.item.name}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Recipient info */}
            {(shopOrder.recipient_name || shopOrder.message) && (
              <div className="border-t border-slate-100 px-4 py-3 space-y-1">
                {shopOrder.recipient_name && (
                  <div className="flex items-center gap-2 text-sm">
                    <Gift className="h-3.5 w-3.5 text-primary" />
                    <span className="text-slate-600">For <span className="font-medium">{shopOrder.recipient_name}</span></span>
                  </div>
                )}
                {shopOrder.message && (
                  <div className="flex items-start gap-2 text-sm">
                    <MessageSquare className="h-3.5 w-3.5 text-primary mt-0.5" />
                    <span className="text-slate-500 italic">"{shopOrder.message}"</span>
                  </div>
                )}
              </div>
            )}

            {/* WhatsApp share */}
            <div className="px-4 pb-4">
              <WhatsAppShareButton
                claimCode={shopOrder.claim_code}
                shopName={shopOrder.shop?.name ?? 'KithLy Merchant'}
                recipientName={shopOrder.recipient_name ?? undefined}
              />
            </div>
          </motion.div>
        );
      })}

      <Button
        onClick={onDone}
        className="w-full max-w-xs rounded-xl bg-slate-900 py-5 font-medium text-white hover:bg-slate-800"
      >
        View All Orders
        <ArrowRight className="ml-2 h-4 w-4" />
      </Button>
    </motion.div>
  );
}

function FailedView({ onVerify, verifying }: { onVerify: () => void; verifying: boolean }) {
  return (
    <div className="flex flex-col items-center gap-8 text-center">
      <div className="flex h-20 w-20 items-center justify-center rounded-full border border-amber-200 bg-amber-50">
        <Loader2 className="h-9 w-9 text-amber-500" />
      </div>
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Verification Delayed</h1>
        <p className="mt-2 max-w-sm text-sm text-slate-500">
          Our system is taking longer than usual to confirm your payment. If you were charged,
          your gift code will appear after manual verification.
        </p>
      </div>
      <div className="flex w-full max-w-xs flex-col gap-3">
        <Button
          onClick={onVerify}
          disabled={verifying}
          className="w-full rounded-xl bg-slate-900 py-5 font-medium text-white hover:bg-slate-800"
        >
          {verifying ? (
            <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Checking...</>
          ) : 'Check Payment Status'}
        </Button>
        <Button
          variant="ghost"
          className="w-full text-slate-500 hover:text-slate-700"
          onClick={() => window.open('mailto:support@kithly.com', '_blank')}
        >
          Contact Support
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Root component
// ---------------------------------------------------------------------------

export function Confirmation() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { profile } = useAuth();

  // V2: The Flutterwave redirect appends tx_ref (our transaction_id) to the URL.
  // Per the agreed design, transaction_id IS the gateway_tx_ref (KITHLY-{ts}-{suffix}).
  // We also accept it as the route param if present in the query string.
  const txRef = searchParams.get('tx_ref') || searchParams.get('transaction_id');

  const [transactionId, setTransactionId] = useState<string | null>(null);
  const [resolving, setResolving] = useState(true);

  // Resolve the transaction_id from the tx_ref (gateway reference)
  useEffect(() => {
    if (!txRef) {
      setResolving(false);
      return;
    }

    const resolveTransaction = async () => {
      const isUuid =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(txRef);

      if (isUuid) {
        setTransactionId(txRef);
        setResolving(false);
        return;
      }

      const { data, error } = await supabase
        .from('transactions')
        .select('transaction_id')
        .eq('gateway_tx_ref', txRef)
        .single();

      if (error || !data) {
        console.error('[Confirmation] could not resolve transaction from tx_ref:', txRef, error);
        toast.error('Could not find your transaction. Please contact support.');
        navigate('/orders');
        return;
      }

      setTransactionId(data.transaction_id);
      setResolving(false);
    };

    resolveTransaction();
  }, [txRef]);

  const [attemptCount, setAttemptCount] = useState(0);
  const MAX_ATTEMPTS = 100;

  const statusParam = searchParams.get('status');

  const { transaction, pollingStatus, verifyManually } = usePaymentConfirmation(
    transactionId,
    txRef,
    statusParam
  );

  // Increment display counter while polling
  useEffect(() => {
    if (pollingStatus !== 'polling') return;
    const timer = setInterval(() => {
      setAttemptCount((n) => Math.min(n + 1, MAX_ATTEMPTS));
    }, 3000);
    return () => clearInterval(timer);
  }, [pollingStatus]);

  // Fire confetti when payment is confirmed
  useEffect(() => {
    if (pollingStatus === 'confirmed') {
      const brandColors = ['#F97316', '#FB923C', '#FDBA74', '#FED7AA', '#ffffff'];
      const opts: confetti.Options = {
        particleCount: 80, spread: 80, startVelocity: 45,
        decay: 0.92, gravity: 1.1, ticks: 200,
        colors: brandColors, shapes: ['circle', 'square'] as confetti.Shape[], scalar: 1.1,
      };
      confetti({ ...opts, origin: { x: 0.2, y: 0.75 }, angle: 60 });
      setTimeout(() => confetti({ ...opts, origin: { x: 0.8, y: 0.75 }, angle: 120 }), 120);
    }
  }, [pollingStatus]);

  if (resolving) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-12 w-12 animate-spin rounded-full border-b-2 border-primary" />
      </div>
    );
  }

  if (!txRef) {
    return (
      <div className="flex min-h-screen items-center justify-center px-6">
        <div className="text-center max-w-sm">
          <h2 className="mb-2 text-xl font-semibold">Invalid confirmation link</h2>
          <p className="mb-6 text-sm text-muted-foreground">
            We couldn't identify your transaction. Please go to your orders to check the status.
          </p>
          <Button onClick={() => navigate('/orders')}>View Orders</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex min-h-screen w-full flex-col items-center justify-center bg-white px-6 py-12">
      {/* KithLy wordmark */}
      <motion.div
        className="absolute top-8 left-1/2 -translate-x-1/2"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
      >
        <span className="text-xs font-medium tracking-[0.28em] text-slate-300 uppercase">KithLy</span>
      </motion.div>

      <div className="w-full max-w-md py-12">
        <AnimatePresence mode="wait">
          {(pollingStatus === 'idle' || pollingStatus === 'polling') && (
            <motion.div
              key="polling"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
            >
              <PollingView attempt={attemptCount} max={MAX_ATTEMPTS} />
            </motion.div>
          )}

          {pollingStatus === 'confirmed' && transaction && (
            <motion.div key="success" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              <SuccessView
                transaction={transaction}
                onDone={() => navigate('/orders')}
              />
            </motion.div>
          )}

          {pollingStatus === 'failed' && (
            <motion.div key="failed" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              <FailedView
                onVerify={verifyManually}
                verifying={pollingStatus === 'polling'}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Escrow footer */}
      <div className="absolute bottom-6 flex items-center gap-1.5">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.25"
          strokeLinecap="round" strokeLinejoin="round"
          className="h-3.5 w-3.5 text-slate-300" aria-hidden>
          <rect x="3" y="7" width="10" height="8" rx="1.5" />
          <path d="M5 7V5a3 3 0 0 1 6 0v2" />
        </svg>
        <span className="text-xs text-slate-400">Escrow-protected transaction</span>
      </div>
    </div>
  );
}
