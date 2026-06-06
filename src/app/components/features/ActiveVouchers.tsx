import { Package } from 'lucide-react';
import { motion } from 'motion/react';
import { useNavigate } from 'react-router';
import { Button } from '../../components/ui/button';
import { QRCodeDisplay } from '../../components/shared/QRCodeDisplay';
import { EmptyState } from '../../components/shared/EmptyState';

export function ActiveVouchers({ activeVouchers }: { activeVouchers: any[] }) {
  const navigate = useNavigate();

  if (activeVouchers.length === 0) {
    return (
      <EmptyState
        icon={Package}
        title="No active vouchers"
        description="Gifts sent to your phone number will appear here, ready to show to the merchant."
      />
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
      {activeVouchers.map((order, idx) => {
        const firstItem = order.order_items?.[0]?.items;
        const sender = order.transactions?.users?.name || 'Someone special';
        const shop = order.shops?.name || 'Partner Shop';

        return (
          <motion.div
            key={order.shop_order_id}
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.3, delay: idx * 0.06 }}
            className="rounded-3xl border-2 border-primary/20 bg-white shadow-md hover:shadow-lg transition-all duration-300 overflow-hidden"
          >
            {/* Header accent */}
            <div className="h-1.5 bg-gradient-to-r from-primary to-primary-light" />
            <div className="p-6 flex flex-col items-center gap-5">
              <div className="text-center">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 mb-0.5">
                  From {sender}
                </p>
                <h4 className="font-bold text-slate-900 text-base">
                  {firstItem?.name || 'Gift Bundle'}
                </h4>
                <p className="text-xs text-slate-500 mt-0.5">@ {shop}</p>
              </div>
              {/* Large QR */}
              <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100 shadow-inner">
                <QRCodeDisplay value={order.claim_code} size={160} />
              </div>
              {/* Claim code */}
              <div className="flex flex-col items-center gap-1">
                <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400">
                  Claim Code
                </p>
                <p className="font-mono text-xl font-bold tracking-[0.25em] text-slate-800 select-all">
                  {order.claim_code}
                </p>
              </div>
              {order.message && (
                <p className="text-xs italic text-slate-500 text-center max-w-[200px] leading-relaxed">
                  "{order.message}"
                </p>
              )}
              <Button
                className="w-full rounded-xl text-sm font-semibold bg-gradient-to-r from-primary to-primary-light text-white shadow-sm"
                onClick={() => navigate(`/gift/${order.claim_code}`)}
              >
                Open Gift Page
              </Button>
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}
