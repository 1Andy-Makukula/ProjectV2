// Terms of Service

import { FileText } from 'lucide-react';

export function Terms() {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="container mx-auto px-4 md:px-6 py-16 max-w-4xl">
        <div className="text-center mb-12">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-[#F97316] to-[#FB923C] flex items-center justify-center">
            <FileText className="w-8 h-8 text-white" strokeWidth={1.5} />
          </div>
          <h1 className="text-3xl font-light text-black mb-2">Terms of Service</h1>
          <p className="text-sm font-light text-muted-foreground">Last updated: April 18, 2026</p>
        </div>

        <div className="bg-white rounded-[1.5rem] p-8 md:p-12 border border-border space-y-8">
          <section>
            <h2 className="text-2xl font-light text-black mb-4">1. Escrow System</h2>
            <p className="font-light text-muted-foreground leading-relaxed">
              All gifts purchased on KithLy are held in secure escrow until the recipient claims the gift using the handshake code.
              Funds are only released to merchants upon successful redemption. Unclaimed gifts after 30 days are automatically refunded.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-light text-black mb-4">2. Handshake Codes</h2>
            <p className="font-light text-muted-foreground leading-relaxed">
              Each gift is protected by a unique 8-character handshake code. This code must be presented to the merchant for redemption.
              Do not share codes with unauthorized parties. Lost codes can be recovered through your dashboard.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-light text-black mb-4">3. Refund Policy</h2>
            <p className="font-light text-muted-foreground leading-relaxed">
              Refunds are available for unclaimed gifts within the 30-day validity period. Once a gift is claimed, refunds are not available unless
              the merchant failed to honor the code. Disputes must be filed within 48 hours of the incident.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-light text-black mb-4">4. User Conduct</h2>
            <p className="font-light text-muted-foreground leading-relaxed">
              Users must provide accurate information and maintain the security of their accounts. Fraudulent activity, code sharing schemes,
              or attempts to manipulate the escrow system will result in immediate account suspension and legal action.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-light text-black mb-4">5. Liability</h2>
            <p className="font-light text-muted-foreground leading-relaxed">
              KithLy acts as an escrow intermediary. While we verify all merchants, we are not responsible for the quality of goods or services.
              Disputes should be resolved through our dispute resolution system. Our liability is limited to the transaction amount.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
