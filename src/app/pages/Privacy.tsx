// Privacy Policy

import { Shield } from 'lucide-react';

export function Privacy() {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="container mx-auto px-4 md:px-6 py-16 max-w-4xl">
        <div className="text-center mb-12">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-[#F97316] to-[#FB923C] flex items-center justify-center">
            <Shield className="w-8 h-8 text-white" strokeWidth={1.5} />
          </div>
          <h1 className="text-3xl font-light text-black mb-2">Privacy Policy</h1>
          <p className="text-sm font-light text-muted-foreground">Last updated: April 18, 2026</p>
        </div>

        <div className="bg-white rounded-[1.5rem] p-8 md:p-12 border border-border space-y-8">
          <section>
            <h2 className="text-2xl font-light text-black mb-4">Data We Collect</h2>
            <p className="font-light text-muted-foreground leading-relaxed mb-4">
              We collect information necessary to provide our services:
            </p>
            <ul className="list-disc list-inside space-y-2 font-light text-muted-foreground">
              <li>Personal details: Name, phone number, NRC/TPIN for verification</li>
              <li>Transaction history: Purchases, gifts sent/received</li>
              <li>Location data: District information for merchant matching</li>
              <li>Payment information: Mobile money numbers (encrypted)</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-light text-black mb-4">How We Use Your Data</h2>
            <p className="font-light text-muted-foreground leading-relaxed">
              Your data powers the KithLy experience: processing transactions, verifying identities, preventing fraud,
              matching you with local merchants, and providing customer support. We never sell your personal information.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-light text-black mb-4">Data Security</h2>
            <p className="font-light text-muted-foreground leading-relaxed">
              All sensitive data is encrypted using industry-standard protocols. Payment information is processed through
              secure gateways. We conduct regular security audits and comply with Zambian data protection regulations.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-light text-black mb-4">Your Rights</h2>
            <p className="font-light text-muted-foreground leading-relaxed">
              You have the right to access, correct, or delete your personal data. Contact support@kithly.zm to exercise
              these rights. Account deletion requests are processed within 7 business days.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
