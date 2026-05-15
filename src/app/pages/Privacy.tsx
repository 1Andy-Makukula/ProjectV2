// Privacy Policy

import { Shield, Phone, Database, Eye, Lock, Trash2 } from 'lucide-react';
import { Link } from 'react-router';

const EFFECTIVE_DATE = 'May 15, 2026';

interface SectionProps {
  icon: React.ElementType;
  title: string;
  children: React.ReactNode;
}

function Section({ icon: Icon, title, children }: SectionProps) {
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl bg-orange-50 flex items-center justify-center shrink-0">
          <Icon className="w-5 h-5 text-[#F97316]" strokeWidth={1.5} />
        </div>
        <h2 className="text-xl font-semibold text-black">{title}</h2>
      </div>
      <div className="pl-12 font-light text-muted-foreground leading-relaxed space-y-3">
        {children}
      </div>
    </section>
  );
}

export function Privacy() {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="container mx-auto px-4 md:px-6 py-16 max-w-4xl">

        {/* Hero */}
        <div className="text-center mb-12">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-[#F97316] to-[#FB923C] flex items-center justify-center shadow-md">
            <Shield className="w-8 h-8 text-white" strokeWidth={1.5} />
          </div>
          <h1 className="text-3xl font-light text-black mb-2">Privacy Policy</h1>
          <p className="text-sm font-light text-muted-foreground">Effective: {EFFECTIVE_DATE} · Jurisdiction: Republic of Zambia</p>
        </div>

        <div className="bg-white rounded-[1.5rem] p-8 md:p-12 border border-border space-y-10">

          {/* Intro */}
          <p className="font-light text-muted-foreground leading-relaxed border-l-4 border-[#F97316] pl-4">
            KithLy ("we", "our", "us") is committed to protecting your personal information. This policy explains
            exactly what data we collect, why we collect it, who we share it with, and how long we keep it.
          </p>

          <Section icon={Database} title="1. Data We Collect">
            <p>We collect only what is necessary to provide and secure our service:</p>
            <div className="space-y-3">
              <div className="rounded-xl border border-gray-100 p-4 space-y-1">
                <p className="font-semibold text-black text-sm">Account Data</p>
                <p className="text-sm">Full name, email address, phone number, and hashed password (via Supabase Auth).</p>
              </div>
              <div className="rounded-xl border border-gray-100 p-4 space-y-1">
                <p className="font-semibold text-black text-sm">Transaction Data</p>
                <p className="text-sm">Gift orders, item selections, amounts (in ZMW/Ngwee), claim codes, fulfillment timestamps, and Flutterwave transaction references.</p>
              </div>
              <div className="rounded-xl border border-gray-100 p-4 space-y-1">
                <p className="font-semibold text-black text-sm">Recipient Data</p>
                <p className="text-sm">Recipient name and phone number — provided by the sender at the time of purchase for notification delivery.</p>
              </div>
              <div className="rounded-xl border border-gray-100 p-4 space-y-1">
                <p className="font-semibold text-black text-sm">Merchant Data</p>
                <p className="text-sm">Shop name, physical location, business hours, payout account details (mobile money number or bank account), and inventory listings.</p>
              </div>
            </div>
          </Section>

          <Section icon={Phone} title="2. Phone Numbers &amp; WhatsApp Notifications">
            <p>
              Phone numbers are the most sensitive piece of PII we handle. Here is precisely how we use them:
            </p>
            <ul className="list-disc list-inside space-y-2 pl-2">
              <li>
                <strong>WhatsApp Gift Notification (Recipient):</strong> The recipient's phone number is passed to
                the <strong>Twilio API</strong> (via our Supabase Edge Function) to send a single WhatsApp message
                containing: the gift claim code, the merchant shop name, and the pickup location. Twilio does not
                retain this number beyond the message delivery window.
              </li>
              <li>
                <strong>Mobile Money Payment (Sender):</strong> The sender's mobile money number is sanitized
                to the Zambian 12-digit format (260XXXXXXXXX) and transmitted to <strong>Flutterwave's</strong>{' '}
                PCI-DSS compliant payment API to initiate a hosted checkout session. We do not store your mobile
                money PIN or raw payment credentials.
              </li>
              <li>
                <strong>Account Identity:</strong> Used for authentication, account recovery, and support
                verification only.
              </li>
            </ul>
            <p className="text-sm bg-orange-50 border border-orange-100 rounded-xl p-3">
              📵 We do <strong>not</strong> use phone numbers for marketing SMS, cold calls, or resale.
              You will only receive transactional messages directly related to your KithLy activity.
            </p>
          </Section>

          <Section icon={Eye} title="3. How We Use Your Data">
            <ul className="list-disc list-inside space-y-2 pl-2">
              <li>Process and escrow gift transactions</li>
              <li>Deliver WhatsApp claim code notifications to recipients</li>
              <li>Authenticate and secure user accounts</li>
              <li>Calculate and credit merchant payouts (95/5 split) upon redemption</li>
              <li>Generate transaction receipts and audit ledgers</li>
              <li>Detect and prevent fraud, duplicate settlement, and code abuse</li>
              <li>Provide customer support and dispute resolution</li>
            </ul>
          </Section>

          <Section icon={Lock} title="4. Data Security &amp; Storage">
            <p>
              All data is stored in <strong>Supabase</strong>, hosted on AWS infrastructure in the EU (Ireland)
              region, certified to ISO 27001 and SOC 2 Type II. Data at rest is encrypted with AES-256.
              Data in transit uses TLS 1.3.
            </p>
            <p>
              Our backend runs exclusively as Supabase <strong>Edge Functions</strong> (Deno runtime), minimising
              attack surface. Sensitive actions (payout settlement, withdrawal requests) require authenticated
              service-role keys that are never exposed to the client.
            </p>
            <p>
              We conduct quarterly security reviews and will notify affected users within <strong>72 hours</strong>{' '}
              of any confirmed data breach, in line with Zambia's Data Protection Act.
            </p>
          </Section>

          <Section icon={Shield} title="5. Third-Party Processors">
            <div className="space-y-2">
              {[
                { name: 'Flutterwave', role: 'Payment processing (mobile money, hosted checkout)', link: 'https://flutterwave.com/zm/privacy-policy' },
                { name: 'Twilio', role: 'WhatsApp recipient notifications', link: 'https://www.twilio.com/en-us/legal/privacy' },
                { name: 'Supabase', role: 'Database, authentication, edge computing', link: 'https://supabase.com/privacy' },
              ].map(p => (
                <div key={p.name} className="flex items-start justify-between gap-4 rounded-xl border border-gray-100 p-4">
                  <div>
                    <p className="font-semibold text-black text-sm">{p.name}</p>
                    <p className="text-sm">{p.role}</p>
                  </div>
                  <a href={p.link} target="_blank" rel="noopener noreferrer" className="text-xs text-[#F97316] whitespace-nowrap hover:underline">
                    Privacy Policy ↗
                  </a>
                </div>
              ))}
            </div>
          </Section>

          <Section icon={Trash2} title="6. Your Rights &amp; Data Deletion">
            <p>Under Zambian and GDPR-aligned data protection principles, you have the right to:</p>
            <ul className="list-disc list-inside space-y-1 pl-2">
              <li><strong>Access</strong> — request a copy of all data we hold about you</li>
              <li><strong>Rectify</strong> — correct inaccurate personal information</li>
              <li><strong>Erase</strong> — request deletion of your account and associated data</li>
              <li><strong>Portability</strong> — receive your transaction history in CSV format</li>
              <li><strong>Object</strong> — opt out of any non-essential data processing</li>
            </ul>
            <p>
              To exercise any of these rights, email <strong>privacy@kithly.zm</strong>. Requests are processed
              within <strong>7 business days</strong>. Account deletion is irreversible and will void any
              unclaimed gift codes associated with the account.
            </p>
          </Section>

          {/* Footer CTA */}
          <div className="pt-6 border-t border-gray-100 flex flex-col sm:flex-row items-center justify-between gap-4">
            <p className="text-sm font-light text-muted-foreground">
              Also see our{' '}
              <Link to="/terms" className="text-[#F97316] hover:underline">Terms of Service</Link>{' '}
              or contact{' '}
              <a href="mailto:privacy@kithly.zm" className="text-[#F97316] hover:underline">privacy@kithly.zm</a>.
            </p>
            <Link
              to="/support"
              className="text-sm font-medium text-[#F97316] hover:underline whitespace-nowrap"
            >
              Visit Support Centre →
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
