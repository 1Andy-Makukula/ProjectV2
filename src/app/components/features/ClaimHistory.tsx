import { Gift } from 'lucide-react';
import { useNavigate } from 'react-router';

export function ClaimHistory({ claimHistory }: { claimHistory: any[] }) {
  const navigate = useNavigate();

  if (claimHistory.length === 0) {
    return (
      <p className="text-sm text-ink-400 text-center py-6">
        No completed claims yet.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {claimHistory.map((order) => {
        const firstItem = order.order_items?.[0]?.items;
        const sender = order.transactions?.users?.name || 'Someone special';
        const shop = order.shops?.name || 'Partner Shop';
        const isPartial = order.claim_status === 'PARTIAL_FULFILLMENT';

        return (
          <div
            key={order.shop_order_id}
            className="flex items-center gap-4 rounded-2xl border border-ink-100 bg-ink-50/60 px-5 py-4 opacity-70 hover:opacity-90 transition-opacity cursor-pointer"
            onClick={() => navigate(`/gift/${order.claim_code}`)}
          >
            <div className="h-12 w-12 shrink-0 overflow-hidden rounded-xl bg-ink-100 border border-ink-200 flex items-center justify-center">
              {firstItem?.image_url ? (
                <img
                  src={firstItem.image_url}
                  alt={firstItem.name}
                  className="h-full w-full object-cover grayscale"
                />
              ) : (
                <Gift className="h-5 w-5 text-ink-300" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-ink-600 truncate">
                {firstItem?.name || 'Gift Bundle'}
              </p>
              <p className="text-xs text-ink-400 mt-0.5">
                From {sender} · {shop}
              </p>
            </div>
            <span
              className={`shrink-0 rounded-full px-2.5 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${
                isPartial
                  ? 'bg-warn-50 text-warn-600 ring-warn-200'
                  : 'bg-ok-50 text-ok-600 ring-ok-200'
              }`}
            >
              {isPartial ? 'Partial' : 'Claimed'}
            </span>
          </div>
        );
      })}
    </div>
  );
}
