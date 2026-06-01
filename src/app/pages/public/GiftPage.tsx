import { useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { supabase } from '../../../lib/supabaseClient';
import { motion } from 'motion/react';
import { Gift as GiftIcon, MapPin, Package, QrCode as QrCodeIcon, SearchX, Sparkles } from 'lucide-react';
import QRCode from 'qrcode'; // preserved import

import { calculateTimeRemaining } from '../../../utils/timeHelpers';

import { QRCodeDisplay } from '../../components/shared/QRCodeDisplay';
import { EmptyState } from '../../components/shared/EmptyState';
import { Card, CardContent } from '../../components/ui/card';
import { Separator } from '../../components/ui/separator';

// ---------------------------------------------------------------------------
// V2 Exact Relational Types
// ---------------------------------------------------------------------------

interface ShopOrder {
  claim_code: string;
  message: string | null;
  recipient_name: string;
  created_at: string;
  shops: {
    name: string;
    address: string | null;
    logo_url: string | null;
  } | null;
  order_items: Array<{
    items: {
      name: string;
      image_url: string | null;
    } | null;
  }>;
  transactions: {
    users: {
      name: string;
    } | null;
  } | null;
}

export function GiftPage() {
  const { claimCode } = useParams<{ claimCode: string }>();
  const [shopOrder, setShopOrder] = useState<ShopOrder | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!claimCode) {
      setLoading(false);
      return;
    }

    const fetchShopOrder = async () => {
      try {
        const { data, error } = await supabase
          .rpc('get_shop_order_by_claim_code', { code: claimCode.toUpperCase() });

        if (error) throw error;
        setShopOrder(data as unknown as ShopOrder);
      } catch (error) {
        console.error('Error fetching shop order:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchShopOrder();
  }, [claimCode]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#FAFAFA]">
        <Package className="h-8 w-8 animate-pulse text-slate-300" strokeWidth={1} />
      </div>
    );
  }

  if (!shopOrder) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#FAFAFA]">
        <EmptyState
          icon={SearchX}
          title="Gift Not Found"
          description="This gift code doesn't exist or the link may be invalid."
        />
      </div>
    );
  }

  const senderName = shopOrder.transactions?.users?.name || 'Someone special';
  const shopName = shopOrder.shops?.name || 'a KithLy partner shop';

  // Group items by name to show exact counts in the checklist
  const groupedItems = shopOrder.order_items.reduce((acc, curr) => {
    const item = curr.items;
    if (!item) return acc;
    const existing = acc.find((i) => i.name === item.name);
    if (existing) {
      existing.quantity += 1;
    } else {
      acc.push({ ...item, quantity: 1 });
    }
    return acc;
  }, [] as Array<{ name: string; image_url: string | null; quantity: number }>);

  return (
    <div className="flex min-h-screen items-start justify-center bg-[#FAFAFA] text-slate-900 font-sans selection:bg-orange-100">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="w-full max-w-lg mx-auto py-12 px-6 flex flex-col gap-10"
      >
        
        {/* The Greeting */}
        <div className="text-center mt-4">
          <h1 className="text-3xl sm:text-4xl font-light tracking-tight text-slate-900 leading-tight">
            <span className="font-semibold">{shopOrder.recipient_name}</span>, you have a gift from <span className="font-medium text-slate-700">{senderName}</span>!
          </h1>
        </div>

        {/* The Digital Card (Message) */}
        {shopOrder.message && (
          <Card className="overflow-hidden border-slate-200/60 bg-white/50 backdrop-blur-sm shadow-sm rounded-3xl relative">
            <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-orange-200 via-orange-300 to-orange-200 opacity-70" />
            <CardContent className="p-8 sm:p-10 flex flex-col items-center">
              <GiftIcon className="h-6 w-6 text-orange-300/80 mb-6" strokeWidth={1.5} />
              <p className="text-center text-lg sm:text-xl italic text-slate-700 font-serif leading-relaxed">
                &ldquo;{shopOrder.message}&rdquo;
              </p>
            </CardContent>
          </Card>
        )}

        {/* The Action Center (QR Code) */}
        <div className="flex flex-col items-center mt-2">
          <p className="text-sm font-medium text-slate-500 mb-8 text-center px-4 leading-relaxed">
            Show this code to the cashier at <strong className="text-slate-900 font-semibold">{shopName}</strong>
          </p>

          <Card className="p-6 rounded-[2rem] shadow-sm border-slate-200/80 bg-white mb-6">
            <QRCodeDisplay value={shopOrder.claim_code} size={220} />
          </Card>

          {/* Expiration warning banner */}
          {(() => {
            const remaining = calculateTimeRemaining(shopOrder.created_at);
            return (
              <div className={`mb-8 flex items-center gap-2 rounded-full px-4 py-1.5 text-xs font-semibold ring-1 transition-all ${
                remaining.isUrgent 
                  ? 'text-red-600 bg-red-50 ring-red-100 animate-pulse' 
                  : 'text-slate-600 bg-slate-50 ring-slate-200'
              }`}>
                <span>⏳</span>
                <span>Please claim this gift: {remaining.text}</span>
              </div>
            );
          })()}

          <div className="flex flex-col items-center gap-2">
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400">Master Code</p>
            <p className="font-mono text-xl sm:text-2xl font-semibold tracking-[0.25em] text-slate-800">
              {shopOrder.claim_code}
            </p>
          </div>
        </div>

        <Separator className="my-2 bg-slate-200/60" />

        {/* The Item Checklist */}
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-2 px-2">
            <Sparkles className="h-4 w-4 text-orange-400" strokeWidth={1.5} />
            <h2 className="text-sm font-medium tracking-wide text-slate-800">
              What's inside your bundle
            </h2>
          </div>

          <Card className="overflow-hidden rounded-3xl shadow-sm border-slate-200/60 bg-white">
            <div className="divide-y divide-slate-100">
              {groupedItems.map((item, idx) => (
                <div key={idx} className="flex items-center gap-4 p-4 sm:p-5">
                  {item.image_url ? (
                    <img
                      src={item.image_url}
                      alt={item.name}
                      className="h-14 w-14 rounded-2xl object-cover border border-slate-100 shadow-sm shrink-0"
                    />
                  ) : (
                    <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-50 border border-slate-100 shrink-0">
                      <Package className="h-5 w-5 text-slate-300" strokeWidth={1.5} />
                    </div>
                  )}
                  <div className="flex-1 min-w-0 pr-4">
                    <p className="text-base font-medium text-slate-800 truncate">
                      {item.name}
                    </p>
                  </div>
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-50 border border-slate-100">
                    <span className="text-xs font-semibold text-slate-600">x{item.quantity}</span>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>

        {/* Footer */}
        <div className="mt-8 text-center pb-8">
          <p className="text-[11px] font-medium tracking-widest text-slate-400 uppercase">
            Powered by KithLy
          </p>
        </div>

      </motion.div>
    </div>
  );
}
