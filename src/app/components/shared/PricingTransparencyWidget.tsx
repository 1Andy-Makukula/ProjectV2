import React from 'react';
import { ShieldCheck } from 'lucide-react';

interface PricingTransparencyWidgetProps {
  inputPriceZMW: number;
  liveExchangeRate: number;
}

export function PricingTransparencyWidget({ inputPriceZMW, liveExchangeRate }: PricingTransparencyWidgetProps) {
  const priceZMW = isNaN(inputPriceZMW) || inputPriceZMW < 0 ? 0 : inputPriceZMW;
  const exchangeRate = isNaN(liveExchangeRate) || liveExchangeRate <= 0 ? 26.00 : liveExchangeRate;

  // Diaspora Pays: Convert to USD and add 3% gateway markup
  const diasporaUSD = (priceZMW / exchangeRate) * 1.03;

  // Merchant Receives: Subtract 8% local fee or 10% diaspora fee
  const merchantLocalZMW = priceZMW * 0.92;
  const merchantDiasporaZMW = priceZMW * 0.90;

  return (
    <div className="bg-slate-50/80 border border-slate-200/60 rounded-2xl p-4 space-y-3.5 shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-100 pb-2">
        <h4 className="text-xs font-semibold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
          <ShieldCheck className="size-4 text-primary" />
          Pricing Transparency Estimator
        </h4>
        <span className="text-[10px] text-slate-400 font-light">Rate: 1 USD = {exchangeRate.toFixed(2)} ZMW</span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {/* Local Buyer Pays */}
        <div className="bg-white border border-slate-100 rounded-xl p-3 flex flex-col justify-between">
          <span className="text-[10px] font-medium text-slate-400 uppercase tracking-wide">Local Buyer Pays</span>
          <span className="text-sm font-semibold text-slate-900 mt-1">ZMW {priceZMW.toFixed(2)}</span>
        </div>

        {/* Diaspora Pays */}
        <div className="bg-white border border-slate-100 rounded-xl p-3 flex flex-col justify-between">
          <span className="text-[10px] font-medium text-slate-400 uppercase tracking-wide flex items-center gap-1">
            Diaspora Pays (USD)
            <span className="text-[9px] text-slate-400 font-normal normal-case">(+3% markup)</span>
          </span>
          <span className="text-sm font-semibold text-primary mt-1">${diasporaUSD.toFixed(2)}</span>
        </div>

        {/* Merchant Receives */}
        <div className="bg-white border border-slate-100 rounded-xl p-3 flex flex-col justify-between">
          <span className="text-[10px] font-medium text-slate-400 uppercase tracking-wide flex items-center gap-1">
            Merchant Receives
            <span className="text-[9px] text-slate-400 font-normal normal-case">(8% local / 10% diaspora fee)</span>
          </span>
          <span className="text-sm font-semibold text-emerald-600 mt-1">
            ZMW {merchantLocalZMW.toFixed(2)} / ZMW {merchantDiasporaZMW.toFixed(2)}
          </span>
        </div>
      </div>
    </div>
  );
}
