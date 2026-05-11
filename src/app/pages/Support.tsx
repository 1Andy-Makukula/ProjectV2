// Support & Help Page

import { useState } from 'react';
import { MessageCircle, HelpCircle, FileText, Mail, Phone } from 'lucide-react';
import { motion } from 'motion/react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { toast } from 'sonner';

const faqs = [
  {
    q: 'How does the handshake code system work?',
    a: 'When you purchase a gift, you receive a unique 8-character code. The recipient uses this code to claim the gift at the merchant location.',
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
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-[#F97316] to-[#FB923C] flex items-center justify-center">
            <HelpCircle className="w-8 h-8 text-white" strokeWidth={1.5} />
          </div>
          <h1 className="text-3xl font-light text-black mb-2">Help & Support</h1>
          <p className="text-sm font-light text-muted-foreground">We're here to help you</p>
        </div>

        <Tabs defaultValue="faq" className="space-y-6">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="faq" className="font-light">FAQ</TabsTrigger>
            <TabsTrigger value="ticket" className="font-light">Submit Ticket</TabsTrigger>
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
                      className="text-[#F97316]"
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
              <h3 className="text-xl font-light text-black mb-6">Submit a Support Ticket</h3>
              <form onSubmit={handleSubmitTicket} className="space-y-6">
                <div>
                  <label className="text-sm font-light text-muted-foreground mb-2 block">Subject</label>
                  <input
                    type="text"
                    value={ticketSubject}
                    onChange={(e) => setTicketSubject(e.target.value)}
                    placeholder="Brief description of your issue"
                    className="w-full px-4 py-3 border border-border rounded-full font-light focus:outline-none focus:border-[#F97316]"
                    required
                  />
                </div>
                <div>
                  <label className="text-sm font-light text-muted-foreground mb-2 block">Message</label>
                  <textarea
                    value={ticketMessage}
                    onChange={(e) => setTicketMessage(e.target.value)}
                    placeholder="Describe your issue in detail..."
                    rows={6}
                    className="w-full px-4 py-3 border border-border rounded-2xl font-light focus:outline-none focus:border-[#F97316] resize-none"
                    required
                  />
                </div>
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  type="submit"
                  className="w-full py-4 bg-gradient-to-r from-[#F97316] to-[#FB923C] text-white rounded-full font-light shadow-lg"
                >
                  Submit Ticket
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
                    className="w-full px-4 py-3 border border-border rounded-full font-light font-mono focus:outline-none focus:border-[#F97316]"
                  />
                </div>
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={handleTrackOrder}
                  className="w-full py-4 bg-gradient-to-r from-[#F97316] to-[#FB923C] text-white rounded-full font-light shadow-lg"
                >
                  Track Order
                </motion.button>
              </div>
            </div>
          </TabsContent>
        </Tabs>

        {/* Contact Info */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-12">
          <div className="bg-white rounded-[1rem] p-6 border border-border text-center">
            <Mail className="w-6 h-6 mx-auto mb-3 text-[#F97316]" strokeWidth={1.5} />
            <p className="text-sm font-light text-black mb-1">Email</p>
            <p className="text-xs font-light text-muted-foreground">support@kithly.zm</p>
          </div>
          <div className="bg-white rounded-[1rem] p-6 border border-border text-center">
            <Phone className="w-6 h-6 mx-auto mb-3 text-[#F97316]" strokeWidth={1.5} />
            <p className="text-sm font-light text-black mb-1">Phone</p>
            <p className="text-xs font-light text-muted-foreground">+260 977 000 000</p>
          </div>
          <div className="bg-white rounded-[1rem] p-6 border border-border text-center">
            <MessageCircle className="w-6 h-6 mx-auto mb-3 text-[#F97316]" strokeWidth={1.5} />
            <p className="text-sm font-light text-black mb-1">WhatsApp</p>
            <p className="text-xs font-light text-muted-foreground">+260 977 000 000</p>
          </div>
        </div>
      </div>
    </div>
  );
}
