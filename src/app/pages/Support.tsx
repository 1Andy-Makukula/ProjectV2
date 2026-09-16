// Support & Help Page

import { useState } from 'react';
import { MessageCircle, HelpCircle, Mail, Phone, PackageSearch } from 'lucide-react';
import { motion } from 'motion/react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { toast } from 'sonner';
import { useConciergeThread } from '../hooks/useConciergeThread';

const faqs = [
  {
    q: 'How does the KithLy Escrow System work?',
    a: 'When you purchase a gift, KithLy securely holds your payment in escrow. The merchant only receives the funds after the recipient successfully claims the gift using their unique handshake code. If the code is never claimed or expires, your money is automatically refunded.',
  },
  {
    q: 'How does the handshake code system work?',
    a: 'When you purchase a gift, you receive a unique 8-character code. The recipient uses this code to claim the gift at the merchant location. The merchant verifies it to release the escrow funds.',
  },
  {
    q: 'How long is my gift code valid?',
    a: 'Gift codes are valid for 30 days from the date of purchase. You can check expiry dates in your Gift Vault.',
  },
  {
    q: 'Can I track my gift order?',
    a: 'Yes! Visit your dashboard to see real-time status: Paid → Awaiting Collection → Claimed.',
  },
  {
    q: 'What if the merchant doesn\'t honor my code?',
    a: 'Open a dispute ticket through the Support tab. Our team will investigate and resolve within 24 hours.',
  },
  {
    q: 'How do refunds work?',
    a: 'Refunds are processed automatically if a gift code expires unclaimed. Funds return to your wallet within 3-5 business days.',
  },
];

export function Support() {
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [ticketSubject, setTicketSubject] = useState('');
  const [ticketMessage, setTicketMessage] = useState('');
  const [trackingCode, setTrackingCode] = useState('');
  const [askSubject, setAskSubject] = useState('');

  const { askKithly, opening } = useConciergeThread();

  const handleSubmitTicket = (e: React.FormEvent) => {
    e.preventDefault();
    toast.success('Support ticket submitted. We\'ll respond within 24 hours.');
    setTicketSubject('');
    setTicketMessage('');
  };

  const handleTrackOrder = () => {
    if (trackingCode) {
      toast.info('Order tracking feature coming soon!');
    }
  };


  return (
    <div className="min-h-screen bg-gray-50">
      <div className="container mx-auto px-4 md:px-6 py-8 max-w-5xl">
        <div className="text-center mb-12">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl kl-gradient-brand-br flex items-center justify-center">
            <HelpCircle className="w-8 h-8 text-white" strokeWidth={1.5} />
          </div>
          <h1 className="text-3xl font-light text-black mb-2">Help & Support</h1>
          <p className="text-sm font-light text-muted-foreground">We're here to help you</p>
        </div>

        <Tabs defaultValue="faq" className="space-y-6">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="faq" className="font-light">FAQ</TabsTrigger>
            <TabsTrigger value="ticket" className="font-light">Dispute</TabsTrigger>
            <TabsTrigger value="track" className="font-light">Track Order</TabsTrigger>
          </TabsList>

          <TabsContent value="faq">
            <div className="space-y-3">
              {faqs.map((faq, idx) => (
                <motion.div
                  key={idx}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: idx * 0.05 }}
                  className="bg-white rounded-[1rem] border border-border overflow-hidden"
                >
                  <button
                    onClick={() => setOpenFaq(openFaq === idx ? null : idx)}
                    className="w-full px-6 py-4 text-left flex items-center justify-between hover:bg-gray-50 transition-colors"
                  >
                    <span className="font-light text-black">{faq.q}</span>
                    <motion.div
                      animate={{ rotate: openFaq === idx ? 180 : 0 }}
                      className="text-primary"
                    >
                      ▼
                    </motion.div>
                  </button>
                  {openFaq === idx && (
                    <motion.div
                      initial={{ height: 0 }}
                      animate={{ height: 'auto' }}
                      className="px-6 pb-4 text-sm font-light text-muted-foreground"
                    >
                      {faq.a}
                    </motion.div>
                  )}
                </motion.div>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="ticket">
            <div className="bg-white rounded-[1.5rem] p-8 border border-border">
              <h3 className="text-xl font-light text-black mb-6">Dispute a Transaction</h3>
              <form onSubmit={handleSubmitTicket} className="space-y-6">
                <div>
                  <label className="text-sm font-light text-muted-foreground mb-2 block">Order Reference</label>
                  <input
                    type="text"
                    value={ticketSubject}
                    onChange={(e) => setTicketSubject(e.target.value)}
                    placeholder="e.g. KL-12345678"
                    className="w-full px-4 py-3 border border-border rounded-full font-light focus:outline-none focus:border-primary"
                    required
                  />
                </div>
                <div>
                  <label className="text-sm font-light text-muted-foreground mb-2 block">Reason for Dispute</label>
                  <select
                    className="w-full px-4 py-3 border border-border rounded-full font-light focus:outline-none focus:border-primary bg-white"
                    required
                  >
                    <option value="">Select a reason...</option>
                    <option value="merchant_refused">Merchant refused to honor code</option>
                    <option value="item_unavailable">Item was out of stock/unavailable</option>
                    <option value="wrong_item">Recipient received the wrong item</option>
                    <option value="other">Other issue</option>
                  </select>
                </div>
                <div>
                  <label className="text-sm font-light text-muted-foreground mb-2 block">Additional Details</label>
                  <textarea
                    value={ticketMessage}
                    onChange={(e) => setTicketMessage(e.target.value)}
                    placeholder="Describe your issue in detail..."
                    rows={4}
                    className="w-full px-4 py-3 border border-border rounded-2xl font-light focus:outline-none focus:border-primary resize-none"
                    required
                  />
                </div>
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  type="submit"
                  className="w-full py-4 kl-gradient-brand text-white rounded-full font-light shadow-lg"
                >
                  Submit Dispute
                </motion.button>
              </form>
            </div>
          </TabsContent>

          <TabsContent value="track">
            <div className="bg-white rounded-[1.5rem] p-8 border border-border">
              <h3 className="text-xl font-light text-black mb-6">Track Your Order</h3>
              <div className="space-y-6">
                <div>
                  <label className="text-sm font-light text-muted-foreground mb-2 block">Handshake Code</label>
                  <input
                    type="text"
                    value={trackingCode}
                    onChange={(e) => setTrackingCode(e.target.value.toUpperCase())}
                    placeholder="KL-ABC123"
                    className="w-full px-4 py-3 border border-border rounded-full font-light font-mono focus:outline-none focus:border-primary"
                  />
                </div>
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={handleTrackOrder}
                  className="w-full py-4 kl-gradient-brand text-white rounded-full font-light shadow-lg"
                >
                  Track Order
                </motion.button>
              </div>
            </div>
          </TabsContent>
        </Tabs>

        {/* Ask KithLy to source something we do not list yet. */}
        <div className="kl-tile kl-rim mt-12 p-8">
          <div className="flex items-start gap-4">
            <div className="kl-gradient-brand-br flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl">
              <PackageSearch className="h-5 w-5 text-white" strokeWidth={1.5} />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="mb-1 text-xl font-light text-black">
                Looking for something we don’t stock?
              </h3>
              <p className="mb-5 max-w-xl text-sm font-light text-muted-foreground">
                Tell us what you need and we’ll find it in Lusaka, send you a price to
                approve, and hold the money in escrow until your person collects it —
                exactly as we do for every other order.
              </p>

              <div className="flex flex-col gap-3 sm:flex-row">
                <input
                  type="text"
                  value={askSubject}
                  onChange={(e) => setAskSubject(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !opening) askKithly(askSubject); }}
                  placeholder="A blood pressure monitor, school shoes, a birthday cake…"
                  aria-label="What you are looking for"
                  className="min-w-0 flex-1 rounded-full border border-border px-4 py-3 text-sm font-light focus:border-primary focus:outline-none"
                />
                <motion.button
                  whileHover={{ scale: opening ? 1 : 1.02 }}
                  whileTap={{ scale: opening ? 1 : 0.98 }}
                  onClick={() => askKithly(askSubject)}
                  disabled={opening}
                  className="kl-gradient-brand shrink-0 rounded-full px-8 py-3 text-sm font-light text-white shadow-lg disabled:opacity-60"
                >
                  {opening ? 'Opening…' : 'Ask KithLy'}
                </motion.button>
              </div>
            </div>
          </div>
        </div>

        {/* Contact Info */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-12">
          <div className="bg-white rounded-[1rem] p-6 border border-border text-center">
            <Mail className="w-6 h-6 mx-auto mb-3 text-primary" strokeWidth={1.5} />
            <p className="text-sm font-light text-black mb-1">Email</p>
            <p className="text-xs font-light text-muted-foreground">support@kithly.zm</p>
          </div>
          <div className="bg-white rounded-[1rem] p-6 border border-border text-center">
            <Phone className="w-6 h-6 mx-auto mb-3 text-primary" strokeWidth={1.5} />
            <p className="text-sm font-light text-black mb-1">Phone</p>
            <p className="text-xs font-light text-muted-foreground">+260 977 000 000</p>
          </div>
          <div className="bg-white rounded-[1rem] p-6 border border-border text-center">
            <MessageCircle className="w-6 h-6 mx-auto mb-3 text-primary" strokeWidth={1.5} />
            <p className="text-sm font-light text-black mb-1">WhatsApp</p>
            <p className="text-xs font-light text-muted-foreground">+260 977 000 000</p>
          </div>
        </div>
      </div>
    </div>
  );
}
