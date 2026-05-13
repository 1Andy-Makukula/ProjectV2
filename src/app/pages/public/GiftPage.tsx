import { useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { supabase } from '../../../utils/supabase/client';
import { motion } from 'motion/react';
import { Gift as GiftIcon, MapPin, Package, QrCode as QrCodeIcon } from 'lucide-react';
import QRCode from 'qrcode';

interface Order {
  id: string;
  recipient_name: string;
  message: string | null;
  code: string;
  status: string;
  amount: number;
  currency: string;
  users: {
    name: string;
  } | null;
  items: {
    id: string;
    name: string;
    description: string | null;
    image_url: string | null;
  } | null;
  shops: {
    name: string;
    location: string | null;
    address: string | null;
  } | null;
}

export function GiftPage() {
  const { code } = useParams<{ code: string }>();
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [qrDataUrl, setQrDataUrl] = useState('');

  useEffect(() => {
    if (!code) return;

    fetchOrder();

    const subscription = supabase
      .channel(`order:${code}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'orders',
          filter: `code=eq.${code}`,
        },
        () => {
          fetchOrder();
        },
      )
      .subscribe();

    return () => {
      subscription.unsubscribe();
    };
  }, [code]);

  const fetchOrder = async () => {
    if (!code) return;

    try {
      const { data, error } = await supabase
        .from('orders')
        .select('*, items(*), shops(name, location, address), users!sender_id(name)')
        .eq('code', code.toUpperCase())
        .single();

      if (error) throw error;
      setOrder(data as unknown as Order);
    } catch (error) {
      console.error('Error fetching order:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (order?.status === 'paid' && order.code) {
      QRCode.toDataURL(order.code, {
        width: 300,
        margin: 2,
        color: {
          dark: '#1f2937',
          light: '#ffffff',
        },
      })
        .then((url) => {
          setQrDataUrl(url);
        })
        .catch((error) => {
          console.error('Error generating QR code:', error);
        });
      return;
    }

    setQrDataUrl('');
  }, [order]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-12 w-12 animate-spin rounded-full border-b-2 border-primary" />
      </div>
    );
  }

  if (!order) {
    return (
      <div className="flex min-h-screen items-center justify-center px-6">
        <div className="max-w-md text-center">
          <h2 className="mb-2 text-2xl font-medium">Gift Not Found</h2>
          <p className="text-muted-foreground">
            This gift code doesn&apos;t exist or may have expired.
          </p>
        </div>
      </div>
    );
  }

  const senderName = order.users?.name || 'Someone';
  const productName = order.items?.name || 'Your gift';
  const shopName = order.shops?.name || 'KithLy partner shop';
  const shopLocation = order.shops?.location || order.shops?.address;

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(251,146,60,0.22),_transparent_30%),linear-gradient(180deg,_#fff7ed_0%,_#ffffff_45%,_#fffaf5_100%)] px-4 py-8 sm:px-6 sm:py-12">
      <motion.div
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45 }}
        className="mx-auto w-full max-w-3xl overflow-hidden rounded-[2rem] border border-orange-100/80 bg-white shadow-[0_30px_90px_rgba(249,115,22,0.14)]"
      >
        <div className="bg-[linear-gradient(135deg,_#f97316_0%,_#fb923c_55%,_#fdba74_100%)] px-6 py-8 text-center text-white sm:px-10">
          <motion.div
            initial={{ scale: 0.88, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.12, duration: 0.45 }}
            className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-white/18 ring-1 ring-white/30 backdrop-blur-sm"
          >
            <GiftIcon className="h-8 w-8" />
          </motion.div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.32em] text-white/80">
            You&apos;ve Received a Gift
          </p>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            {order.recipient_name}, this one is for you.
          </h1>
          <p className="mt-3 text-sm text-white/90 sm:text-base">
            Sent with care by {senderName}
          </p>
        </div>

        <div className="space-y-8 px-5 py-6 sm:px-8 sm:py-8">
          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.8 }}
            className="overflow-hidden rounded-[1.75rem] border border-orange-100 bg-orange-50/40"
          >
            {order.items?.image_url ? (
              <img
                src={order.items.image_url}
                alt={productName}
                className="aspect-square w-full object-cover sm:aspect-[4/3]"
              />
            ) : (
              <div className="flex aspect-square w-full items-center justify-center bg-gradient-to-br from-orange-100 to-amber-50 sm:aspect-[4/3]">
                <div className="text-center">
                  <Package className="mx-auto h-12 w-12 text-orange-400" />
                  <p className="mt-3 text-sm font-medium text-orange-900">{productName}</p>
                </div>
              </div>
            )}
          </motion.div>

          <div className="text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.26em] text-primary/75">
              Ready for Collection
            </p>
            <h2 className="mt-2 text-2xl font-semibold text-gray-950 sm:text-3xl">
              {productName}
            </h2>
            <p className="mt-3 text-lg font-medium text-gray-700">{shopName}</p>
            {shopLocation && (
              <div className="mt-2 flex items-center justify-center gap-2 text-sm text-muted-foreground">
                <MapPin className="h-4 w-4 text-primary" />
                <span>{shopLocation}</span>
              </div>
            )}
          </div>

          {order.message && (
            <div className="rounded-2xl border border-orange-200 bg-orange-50 px-5 py-4">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary/80">
                Message for you
              </p>
              <p className="mt-2 text-base italic leading-relaxed text-gray-700">
                &quot;{order.message}&quot;
              </p>
            </div>
          )}

          <div className="rounded-3xl border border-orange-200 bg-orange-50 px-5 py-6 text-center shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-primary/80">
              Handshake Code
            </p>
            <p className="mt-3 break-all font-mono text-3xl font-bold tracking-[0.35em] text-primary sm:text-4xl">
              {order.code}
            </p>
            <p className="mt-3 text-sm text-muted-foreground">
              Show this code to the merchant when you collect your gift.
            </p>
          </div>

          {(order.status === 'pending_payment' || order.status === 'payment_submitted') && (
            <div className="rounded-3xl border border-amber-200 bg-amber-50 px-5 py-6 text-center">
              <div className="mb-4 inline-flex h-14 w-14 items-center justify-center rounded-full bg-amber-100">
                <div className="h-6 w-6 rounded-full bg-primary animate-pulse" />
              </div>
              <h3 className="text-xl font-semibold text-gray-900">Your gift is being confirmed</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                Payment is still processing. Come back soon and your collection details will appear here.
              </p>
            </div>
          )}

          {order.status === 'paid' && (
            <div className="grid gap-5 lg:grid-cols-[1fr_1.1fr]">
              <div className="rounded-3xl border border-orange-200 bg-white p-5 text-center shadow-sm">
                <div className="mb-3 flex items-center justify-center gap-2 text-sm font-semibold uppercase tracking-[0.2em] text-primary/80">
                  <QrCodeIcon className="h-4 w-4" />
                  <span>Quick Scan</span>
                </div>
                {qrDataUrl ? (
                  <div className="mx-auto inline-flex rounded-2xl border border-orange-100 bg-white p-4 shadow-sm">
                    <img src={qrDataUrl} alt="QR Code" className="h-56 w-56" />
                  </div>
                ) : (
                  <div className="mx-auto flex h-56 w-56 items-center justify-center rounded-2xl border border-dashed border-orange-200 bg-orange-50 text-sm text-muted-foreground">
                    Generating QR code...
                  </div>
                )}
              </div>

              <div className="rounded-3xl border border-blue-100 bg-blue-50/65 px-5 py-6">
                <h3 className="flex items-center gap-2 text-base font-semibold text-gray-900">
                  <MapPin className="h-5 w-5 text-primary" />
                  Collecting your gift
                </h3>
                <ol className="mt-4 space-y-3 pl-5 text-sm leading-relaxed text-gray-700 list-decimal">
                  <li>Visit <strong>{shopName}</strong>.</li>
                  <li>Show this screen, the QR code, or your handshake code.</li>
                  <li>The merchant will verify the item image and hand over your gift.</li>
                </ol>
                {order.shops?.address && (
                  <div className="mt-5 rounded-2xl border border-blue-100 bg-white/80 px-4 py-3 text-sm text-gray-700">
                    <span className="font-semibold text-gray-900">Address:</span> {order.shops.address}
                  </div>
                )}
              </div>
            </div>
          )}

          {order.status === 'fulfilled' && (
            <div className="rounded-3xl border border-green-200 bg-green-50 px-5 py-6 text-center">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
                <svg
                  className="h-8 w-8 text-green-600"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M5 13l4 4L19 7"
                  />
                </svg>
              </div>
              <h3 className="text-xl font-semibold text-green-700">Gift Collected</h3>
              <p className="mt-2 text-sm text-green-800/80">
                This gift has already been redeemed. We hope you enjoyed it.
              </p>
            </div>
          )}
        </div>

        <div className="border-t border-orange-100 bg-orange-50/60 px-6 py-4 text-center text-sm text-muted-foreground">
          Powered by <span className="font-semibold text-primary">KithLy</span>
        </div>
      </motion.div>
    </div>
  );
}
