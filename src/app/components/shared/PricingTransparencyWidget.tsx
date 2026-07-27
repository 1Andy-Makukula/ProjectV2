import { ShieldCheck } from 'lucide-react';
import { usePlatformPricing } from '../../hooks/usePlatformPricing';

interface PricingTransparencyWidgetProps {
  inputPriceZMW: number;
  liveExchangeRate: number;
  /** Percentage deducted from the merchant's settlement. */
  merchantFeePercent?: number;
}

/**
 * Shows a merchant what a listed price means for everyone involved.
 *
 * The buyer pays a service fee on top of the asking price and the merchant
 * gives up a flat percentage of it. Both sides are stated because a merchant
 * setting a price needs to know what the customer will actually be quoted.
 */
export function PricingTransparencyWidget({
  inputPriceZMW,
  liveExchangeRate,
  merchantFeePercent = 2,
}: PricingTransparencyWidgetProps) {
  const { rates } = usePlatformPricing();

  const priceZMW = isNaN(inputPriceZMW) || inputPriceZMW < 0 ? 0 : inputPriceZMW;
  const exchangeRate = isNaN(liveExchangeRate) || liveExchangeRate <= 0 ? 26.0 : liveExchangeRate;

  const localBuyerPays = priceZMW * (1 + rates.local / 100);
  const diasporaBuyerPaysUSD = (priceZMW * (1 + rates.international / 100)) / exchangeRate;

  // The merchant's share does not depend on where the buyer paid from.
  const merchantReceives = priceZMW * (1 - merchantFeePercent / 100);

  return (
    <div className="bg-slate-50/80 border border-slate-200/60 rounded-2xl p-4 space-y-3.5 shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-100 pb-2">
        <h4 className="text-xs font-semibold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
          <ShieldCheck className="size-4 text-primary" />
          Pricing Transparency Estimator
        </h4>
        <span className="text-[10px] text-slate-400 font-light">
          Rate: 1 USD = {exchangeRate.toFixed(2)} ZMW
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {/* Local buyer */}
        <div className="bg-white border border-slate-100 rounded-xl p-3 flex flex-col justify-between">
          <span className="text-[10px] font-medium text-slate-400 uppercase tracking-wide flex items-center gap-1">
            Local Buyer Pays
            <span className="text-[9px] text-slate-400 font-normal normal-case">
              (+{rates.local}% fee)
            </span>
          </span>
          <span className="text-sm font-semibold text-slate-900 mt-1">
            ZMW {localBuyerPays.toFixed(2)}
          </span>
        </div>

        {/* Diaspora buyer */}
        <div className="bg-white border border-slate-100 rounded-xl p-3 flex flex-col justify-between">
          <span className="text-[10px] font-medium text-slate-400 uppercase tracking-wide flex items-center gap-1">
            Diaspora Pays
            <span className="text-[9px] text-slate-400 font-normal normal-case">
              (+{rates.international}% fee)
            </span>
          </span>
          <span className="text-sm font-semibold text-primary mt-1">
            ${diasporaBuyerPaysUSD.toFixed(2)}
          </span>
        </div>

        {/* Merchant */}
        <div className="bg-white border border-slate-100 rounded-xl p-3 flex flex-col justify-between">
          <span className="text-[10px] font-medium text-slate-400 uppercase tracking-wide flex items-center gap-1">
            You Receive
            <span className="text-[9px] text-slate-400 font-normal normal-case">
              (−{merchantFeePercent}%)
            </span>
          </span>
          <span className="text-sm font-semibold text-emerald-600 mt-1">
            ZMW {merchantReceives.toFixed(2)}
          </span>
        </div>
      </div>
    </div>
  );
}
