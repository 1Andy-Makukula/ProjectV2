// About KithLy - Vision & Mission

import { Heart, Target, Lightbulb, Users } from 'lucide-react';
import { motion } from 'motion/react';

export function About() {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="container mx-auto px-4 md:px-6 py-16 max-w-4xl">
        {/* Hero */}
        <div className="text-center mb-16">
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: 'spring' }}
            className="w-20 h-20 mx-auto mb-6 rounded-2xl bg-gradient-to-br from-[#F97316] to-[#FB923C] flex items-center justify-center"
          >
            <Heart className="w-10 h-10 text-white" strokeWidth={1.5} />
          </motion.div>
          <h1 className="text-4xl font-light text-black mb-4">About KithLy</h1>
          <p className="text-lg font-light text-muted-foreground max-w-2xl mx-auto">
            Zambia's trusted gift marketplace, connecting hearts through meaningful gifts
          </p>
        </div>

        {/* Vision & Mission */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-16">
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            className="bg-white rounded-[1.5rem] p-8 border border-border"
          >
            <div className="w-14 h-14 mb-4 rounded-xl bg-blue-100 flex items-center justify-center">
              <Target className="w-7 h-7 text-blue-600" strokeWidth={1.5} />
            </div>
            <h2 className="text-2xl font-light text-black mb-4">Our Vision</h2>
            <p className="font-light text-muted-foreground leading-relaxed">
              To become Africa's leading gift marketplace, making it effortless for anyone to send love,
              appreciation, and support to their friends and family, no matter the distance.
            </p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            className="bg-white rounded-[1.5rem] p-8 border border-border"
          >
            <div className="w-14 h-14 mb-4 rounded-xl bg-orange-100 flex items-center justify-center">
              <Lightbulb className="w-7 h-7 text-[#F97316]" strokeWidth={1.5} />
            </div>
            <h2 className="text-2xl font-light text-black mb-4">Our Mission</h2>
            <p className="font-light text-muted-foreground leading-relaxed">
              To empower Zambians with a secure, transparent platform where gifts are protected in escrow,
              local merchants thrive, and every transaction brings joy to both giver and receiver.
            </p>
          </motion.div>
        </div>

        {/* Story */}
        <div className="bg-white rounded-[1.5rem] p-8 md:p-12 border border-border mb-16">
          <h2 className="text-3xl font-light text-black mb-6">Our Story</h2>
          <div className="space-y-4 font-light text-muted-foreground leading-relaxed">
            <p>
              KithLy was born from a simple frustration: sending gifts to loved ones in Zambia was difficult,
              unreliable, and often disappointing. We saw family members abroad struggle to show their love,
              and local merchants losing business because there was no trusted platform to connect them with customers.
            </p>
            <p>
              We built KithLy with three core principles: <strong className="text-black">security</strong> (through escrow),
              <strong className="text-black"> transparency</strong> (with our unique handshake code system),
              and <strong className="text-black">community</strong> (supporting local Zambian businesses).
            </p>
            <p>
              Today, KithLy serves thousands of customers across all 10 provinces, partnering with verified merchants
              from Lusaka to Livingstone, ensuring that every gift purchased brings joy and supports our local economy.
            </p>
          </div>
        </div>

        {/* Values */}
        <div className="mb-16">
          <h2 className="text-3xl font-light text-black mb-8 text-center">Our Values</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              { icon: Heart, title: 'Trust', desc: 'Every transaction protected by escrow until gift is received' },
              { icon: Users, title: 'Community', desc: 'Supporting local Zambian merchants and businesses' },
              { icon: Lightbulb, title: 'Innovation', desc: 'Using technology to solve real Zambian challenges' },
            ].map((value, idx) => (
              <motion.div
                key={idx}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.1 }}
                className="bg-white rounded-[1.5rem] p-6 border border-border text-center"
              >
                <div className="w-12 h-12 mx-auto mb-4 rounded-xl bg-gray-100 flex items-center justify-center">
                  <value.icon className="w-6 h-6 text-[#F97316]" strokeWidth={1.5} />
                </div>
                <h3 className="font-medium text-black mb-2">{value.title}</h3>
                <p className="text-sm font-light text-muted-foreground">{value.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>

        {/* CTA */}
        <div className="bg-gradient-to-r from-[#F97316] to-[#FB923C] rounded-[1.5rem] p-12 text-center text-white">
          <h2 className="text-3xl font-light mb-4">Join the KithLy Family</h2>
          <p className="font-light mb-8 max-w-2xl mx-auto">
            Whether you're sending gifts or building your business, KithLy is here to help you succeed.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <button className="px-8 py-3 bg-white text-[#F97316] rounded-full font-light hover:shadow-lg transition-shadow">
              Start Shopping
            </button>
            <button className="px-8 py-3 border-2 border-white text-white rounded-full font-light hover:bg-white/10 transition-colors">
              Become a Merchant
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
