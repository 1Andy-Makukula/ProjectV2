// Merchant Agreement

import { Handshake } from 'lucide-react';

export function MerchantAgreement() {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="container mx-auto px-4 md:px-6 py-16 max-w-4xl">
        <div className="text-center mb-12">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-[#F97316] to-[#FB923C] flex items-center justify-center">
            <Handshake className="w-8 h-8 text-white" strokeWidth={1.5} />
          </div>
          <h1 className="text-3xl font-light text-black mb-2">Merchant Agreement</h1>
          <p className="text-sm font-light text-muted-foreground">Last updated: April 18, 2026</p>
        </div>

        <div className="bg-white rounded-[1.5rem] p-8 md:p-12 border border-border space-y-8">
          <section>
            <h2 className="text-2xl font-light text-black mb-4">1. Commission Structure</h2>
            <p className="font-light text-muted-foreground leading-relaxed">
              KithLy charges a 5% commission on all successful transactions. Commissions are deducted when funds are released
              from escrow. There are no upfront fees, listing fees, or monthly subscriptions.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-light text-black mb-4">2. Payment Terms</h2>
            <p className="font-light text-muted-foreground leading-relaxed">
              Funds are released to your merchant wallet within 24 hours of handshake code verification. Withdrawals can be
              made to your registered mobile money account daily. Minimum withdrawal amount is ZMW 50.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-light text-black mb-4">3. Code Verification Obligations</h2>
            <p className="font-light text-muted-foreground leading-relaxed">
              Merchants must verify handshake codes before fulfilling gifts. Codes can be entered manually or scanned via QR.
              Refusing valid codes or providing substandard products will result in disputes and potential account suspension.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-light text-black mb-4">4. Product Listings</h2>
            <p className="font-light text-muted-foreground leading-relaxed">
              All product listings must be accurate, include clear descriptions and pricing, and represent items actually available.
              False advertising or bait-and-switch tactics are strictly prohibited.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-light text-black mb-4">5. Tax Compliance</h2>
            <p className="font-light text-muted-foreground leading-relaxed">
              Merchants are responsible for their own ZRA tax obligations. KithLy provides monthly transaction reports to assist
              with tax filings. Valid TPIN is required for verification and remains on file.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
