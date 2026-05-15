// Terms of Service

import { FileText, Shield, Clock, AlertTriangle, Scale, Phone } from 'lucide-react';
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

export function Terms() {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="container mx-auto px-4 md:px-6 py-16 max-w-4xl">

        {/* Hero */}
        <div className="text-center mb-12">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-[#F97316] to-[#FB923C] flex items-center justify-center shadow-md">
            <FileText className="w-8 h-8 text-white" strokeWidth={1.5} />
          </div>
          <h1 className="text-3xl font-light text-black mb-2">Terms of Service</h1>
          <p className="text-sm font-light text-muted-foreground">Effective: {EFFECTIVE_DATE} · Jurisdiction: Republic of Zambia</p>
        </div>

        <div className="bg-white rounded-[1.5rem] p-8 md:p-12 border border-border space-y-10">

          {/* Intro */}
          <p className="font-light text-muted-foreground leading-relaxed border-l-4 border-[#F97316] pl-4">
            By creating an account or making a purchase on KithLy, you agree to these Terms of Service.
            Please read them carefully. If you do not agree, do not use our platform.
          </p>

          <Section icon={Shield} title="1. Escrow Payment System">
            <p>
              KithLy operates as an <strong>escrow intermediary</strong>. When a sender purchases a gift, the full
              transaction amount is held in escrow by KithLy until the gift is physically claimed by the recipient.
            </p>
            <p>
              Funds are released to the merchant <strong>only upon successful redemption</strong> of the unique
              6-character claim code at the point of sale. At that moment, 95% of the transaction value is credited
              to the merchant's KithLy balance, and 5% is retained by KithLy as a platform commission.
            </p>
            <p>
              <strong>Unclaimed gifts:</strong> If a gift code is not redeemed within <strong>30 days</strong> of
              purchase, the sender is entitled to a full refund of the transaction amount. KithLy will initiate the
              refund within 5 business days of the expiry date.
            </p>
          </Section>

          <Section icon={Clock} title="2. Claim Codes &amp; Redemption">
            <p>
              Each gift generates a unique <strong>6-character alphanumeric claim code</strong>. This code is the
              sole proof of entitlement to the gift item. The code is:
            </p>
            <ul className="list-disc list-inside space-y-1 pl-2">
              <li>Sent to the sender's confirmation screen immediately after payment</li>
              <li>Forwarded to the recipient via WhatsApp notification</li>
              <li>Valid for 30 days from the date of purchase</li>
              <li>Single-use — once redeemed, it cannot be reused</li>
            </ul>
            <p>
              KithLy is not liable for codes shared with unauthorised parties. If a code is suspected compromised,
              contact support immediately at <strong>support@kithly.zm</strong>.
            </p>
          </Section>

          <Section icon={Phone} title="3. Mobile Number &amp; PII Usage">
            <p>
              KithLy collects phone numbers for the following <strong>specific, limited purposes</strong>:
            </p>
            <ul className="list-disc list-inside space-y-1 pl-2">
              <li><strong>Recipient notification:</strong> The recipient's phone number is used to send a WhatsApp message containing the claim code, shop name, and pickup location via the Twilio platform.</li>
              <li><strong>Payment processing:</strong> The sender's mobile money number (MTN, Airtel, or Zamtel) is transmitted to Flutterwave's secure API to initiate mobile money payment. KithLy does not store raw card or PIN data.</li>
              <li><strong>Account identity:</strong> Your phone number may be used for two-factor authentication and account recovery.</li>
            </ul>
            <p>
              Phone numbers are <strong>never sold</strong> to third parties or used for unsolicited marketing.
              All numbers are stored encrypted at rest in our Supabase database, hosted in ISO-27001 certified
              infrastructure.
            </p>
          </Section>

          <Section icon={AlertTriangle} title="4. Refund &amp; Dispute Policy">
            <p>
              Refunds are available under the following conditions:
            </p>
            <ul className="list-disc list-inside space-y-1 pl-2">
              <li>Gift code unused after 30-day validity period — <strong>full refund</strong></li>
              <li>Merchant refuses to honour a valid code — <strong>full refund after investigation</strong></li>
              <li>Duplicate payment charged by payment provider — <strong>full refund within 48 hours</strong></li>
            </ul>
            <p>
              Refunds are <strong>not available</strong> once a gift code has been successfully redeemed at the
              merchant's point of sale. Disputes must be raised within <strong>48 hours</strong> of the incident
              by emailing support@kithly.zm with your order reference.
            </p>
          </Section>

          <Section icon={Scale} title="5. Merchant Obligations">
            <p>
              Merchants listed on KithLy agree to:
            </p>
            <ul className="list-disc list-inside space-y-1 pl-2">
              <li>Honour all valid, unexpired 6-character claim codes presented by recipients</li>
              <li>Maintain accurate inventory and pricing on their KithLy storefront</li>
              <li>Process redemptions within normal business hours as listed on their profile</li>
              <li>Not collude with senders or recipients to fraudulently generate payout events</li>
            </ul>
            <p>
              KithLy reserves the right to suspend merchant accounts, withhold payouts, and pursue legal remedies
              in cases of fraudulent activity.
            </p>
          </Section>

          <Section icon={FileText} title="6. Governing Law">
            <p>
              These Terms are governed by the laws of the <strong>Republic of Zambia</strong>. Any disputes
              arising shall be resolved in the courts of Lusaka, Zambia. KithLy operates in compliance with the
              Electronic Communications and Transactions Act and the Bank of Zambia's e-money regulations.
            </p>
          </Section>

          {/* Footer CTA */}
          <div className="pt-6 border-t border-gray-100 flex flex-col sm:flex-row items-center justify-between gap-4">
            <p className="text-sm font-light text-muted-foreground">
              Questions? Read our{' '}
              <Link to="/privacy" className="text-[#F97316] hover:underline">Privacy Policy</Link>{' '}
              or contact{' '}
              <a href="mailto:support@kithly.zm" className="text-[#F97316] hover:underline">support@kithly.zm</a>.
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
