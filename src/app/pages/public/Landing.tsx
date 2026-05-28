import { useNavigate } from 'react-router';
import { useAuth } from '../../../utils/auth/AuthContext';
import { useEffect } from 'react';
import { Gift, Send, Package, Star, ArrowRight, Store, Shield } from 'lucide-react';
import { motion } from 'motion/react';
import { Button } from '../../components/ui/button';

// HD Unsplash photo — diverse group of friends laughing outdoors at golden hour
const HERO_BG =
  'https://images.unsplash.com/photo-1528605248644-14dd04022da1?w=1920&q=90&fit=crop';

export function Landing() {
  const navigate = useNavigate();
  const { user, profile, loading } = useAuth();

  useEffect(() => {
    if (!loading && user && profile) {
      if (profile.role === 'admin') navigate('/admin');
      else if (profile.role === 'merchant') navigate('/merchant');
      else navigate('/');
    }
  }, [loading, user, profile, navigate]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-white">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">

      {/* ══════════════════════════════════════
          HERO — full-screen background image
      ══════════════════════════════════════ */}
      <section className="relative min-h-screen flex flex-col items-center justify-center overflow-hidden">

        {/* Background image */}
        <div className="absolute inset-0">
          <img
            src={HERO_BG}
            alt="Friends celebrating together"
            className="w-full h-full object-cover object-center"
          />
          {/* Dark overlay for readability */}
          <div className="absolute inset-0 bg-gradient-to-b from-black/55 via-black/35 to-black/65" />
          {/* Orange–red brand colour wash */}
          <div className="absolute inset-0 bg-gradient-to-br from-orange-900/50 via-red-900/20 to-orange-800/40" />
        </div>

        {/* ── Top nav ── */}
        <nav className="absolute top-0 left-0 right-0 z-20 flex items-center justify-between px-8 py-6">
          <motion.span
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            className="text-2xl font-bold text-white tracking-tight"
          >
            KithLy
          </motion.span>

          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            className="flex items-center gap-3"
          >
            {user && profile ? (
              <button
                onClick={() => navigate('/dashboard')}
                className="bg-white text-slate-900 text-sm font-semibold px-5 py-2 rounded-full hover:bg-white/90 transition-all shadow-lg"
              >
                Go to Dashboard
              </button>
            ) : (
              <>
                <button
                  onClick={() => navigate('/login')}
                  className="text-white/90 hover:text-white text-sm font-medium transition-colors px-4 py-2 rounded-full hover:bg-white/10"
                >
                  Sign in
                </button>
                <button
                  onClick={() => navigate('/signup')}
                  className="bg-white text-orange-700 text-sm font-semibold px-5 py-2 rounded-full hover:bg-white/90 transition-all shadow-lg"
                >
                  Get Started
                </button>
              </>
            )}
          </motion.div>
        </nav>

        {/* ── Hero content ── */}
        <div className="relative z-10 text-center px-6 max-w-4xl mx-auto">

          {/* Badge */}
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="inline-flex items-center gap-2 bg-white/10 backdrop-blur-sm border border-white/20 rounded-full px-4 py-1.5 mb-8"
          >
            <Star className="w-4 h-4 text-yellow-300 fill-yellow-300" />
            <span className="text-white/90 text-sm font-medium">The #1 gifting app in Zambia</span>
          </motion.div>

          {/* Headline */}
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2, duration: 0.7 }}
            className="text-5xl md:text-7xl font-extrabold text-white leading-tight mb-6 tracking-tight"
          >
            Send real gifts to
            <br />
            <span className="bg-gradient-to-r from-orange-300 via-red-300 to-amber-300 bg-clip-text text-transparent">
              people you love
            </span>
          </motion.h1>

          {/* Subheadline */}
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.4 }}
            className="text-lg md:text-xl text-white/80 mb-10 max-w-2xl mx-auto leading-relaxed"
          >
            Pick from curated local shops, add a personal message, and let your
            recipient collect it in person — anywhere in Zambia.
          </motion.p>

          {/* ── Primary CTA buttons (senders) ── */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.55 }}
            className="flex flex-col sm:flex-row gap-4 justify-center"
          >
            <Button
              onClick={() => navigate('/signup')}
              className="px-8 py-6 text-lg rounded-full bg-gradient-to-r from-orange-500 to-red-500 hover:from-orange-600 hover:to-red-600 border-0 shadow-2xl hover:shadow-orange-500/30 transition-all group"
            >
              Start gifting free
              <ArrowRight className="w-5 h-5 ml-2 group-hover:translate-x-1 transition-transform" />
            </Button>
            <Button
              onClick={() => navigate('/login')}
              variant="outline"
              className="px-8 py-6 text-lg rounded-full bg-white/10 backdrop-blur-sm border-white/30 text-white hover:bg-white/20 hover:text-white transition-all"
            >
              I already have an account
            </Button>
          </motion.div>

          {/* ── Merchant sign-up link ── */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.7 }}
            className="mt-6"
          >
            <button
              onClick={() => navigate('/signup')}
              className="inline-flex items-center gap-2 text-white/70 hover:text-white text-sm transition-colors group"
            >
              <Store className="w-4 h-4 text-orange-300 group-hover:text-orange-200" />
              Own a shop?
              <span className="underline underline-offset-2 font-medium">
                Register as a merchant
              </span>
              <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
            </button>
            <p className="text-white/40 text-xs mt-1">
              Sign up first, then register your shop from your account dashboard.
            </p>
          </motion.div>

          {/* Social proof */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.85 }}
            className="flex items-center justify-center gap-4 mt-10"
          >
            <div className="flex -space-x-2">
              {[2, 6, 8, 15, 20].map((i) => (
                <img
                  key={i}
                  src={`https://i.pravatar.cc/40?img=${i}`}
                  alt="User"
                  className="w-9 h-9 rounded-full border-2 border-white object-cover"
                />
              ))}
            </div>
            <p className="text-white/80 text-sm">
              <span className="font-bold text-white">2,400+</span> gifts sent this month
            </p>
          </motion.div>
        </div>

        {/* Scroll indicator */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, y: [0, 8, 0] }}
          transition={{ delay: 1.2, duration: 1.5, repeat: Infinity }}
          className="absolute bottom-8 left-1/2 -translate-x-1/2 z-10"
        >
          <div className="w-6 h-10 rounded-full border-2 border-white/40 flex items-start justify-center pt-2">
            <div className="w-1.5 h-3 rounded-full bg-white/60" />
          </div>
        </motion.div>
      </section>

      {/* ══════════════════════════════════════
          ESCROW TRUST BANNER
      ══════════════════════════════════════ */}
      <section className="bg-white pt-20 px-6">
        <div className="max-w-5xl mx-auto">
          <div className="bg-gradient-to-r from-orange-500 to-red-600 rounded-xl shadow-2xl p-8 flex flex-col md:flex-row items-center gap-6 md:gap-8 transition-transform hover:scale-[1.01]">
            <div className="flex-shrink-0 bg-white/10 p-5 rounded-2xl backdrop-blur-sm border border-white/20">
              <Shield className="w-12 h-12 text-yellow-300" />
            </div>
            <div className="text-center md:text-left">
              <h2 className="text-2xl md:text-3xl font-extrabold text-white mb-2">
                100% Escrow Protected
              </h2>
              <p className="text-orange-50 text-lg">
                Every Kwacha is safely locked in the KithLy vault until the gift is physically collected.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════
          HOW IT WORKS — feature cards
      ══════════════════════════════════════ */}
      <section className="bg-white pt-20 pb-24 px-6">
        <div className="max-w-5xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-16"
          >
            <span className="text-sm font-semibold text-orange-600 uppercase tracking-widest">
              How KithLy works
            </span>
            <h2 className="text-4xl md:text-5xl font-bold text-gray-900 mt-3 mb-4">
              Three simple steps
            </h2>
            <p className="text-gray-500 text-lg max-w-xl mx-auto">
              No logistics. No delivery delays. Just pure joy.
            </p>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {[
              {
                icon: Gift,
                color: 'from-orange-500 to-red-500',
                bg: 'bg-orange-50',
                step: '01',
                title: 'Choose a Gift',
                desc: 'Browse curated items from local shops near your recipient.',
              },
              {
                icon: Send,
                color: 'from-red-500 to-rose-600',
                bg: 'bg-red-50',
                step: '02',
                title: 'Send It',
                desc: 'Add a heartfelt message and share the gift link via WhatsApp.',
              },
              {
                icon: Package,
                color: 'from-amber-500 to-orange-500',
                bg: 'bg-amber-50',
                step: '03',
                title: 'They Collect',
                desc: 'Your recipient walks in, shows the QR code, and picks it up.',
              },
            ].map(({ icon: Icon, color, bg, step, title, desc }, i) => (
              <motion.div
                key={step}
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.15 }}
                className={`${bg} rounded-3xl p-8 flex flex-col items-center text-center relative overflow-hidden group hover:shadow-xl transition-shadow`}
              >
                <span className="absolute top-4 right-5 text-6xl font-black text-black/5 select-none">
                  {step}
                </span>
                <div
                  className={`w-16 h-16 rounded-2xl bg-gradient-to-br ${color} flex items-center justify-center mb-6 shadow-lg group-hover:scale-110 transition-transform`}
                >
                  <Icon className="w-8 h-8 text-white" />
                </div>
                <h3 className="text-xl font-bold text-gray-900 mb-3">{title}</h3>
                <p className="text-gray-500 leading-relaxed">{desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════
          MERCHANT CTA SECTION
      ══════════════════════════════════════ */}
      <section className="bg-gray-50 border-t border-gray-100 py-20 px-6">
        <div className="max-w-4xl mx-auto grid md:grid-cols-2 gap-12 items-center">
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
          >
            <span className="text-sm font-semibold text-orange-600 uppercase tracking-widest">
              For shop owners
            </span>
            <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mt-3 mb-4 leading-snug">
              Grow your shop with KithLy gifts
            </h2>
            <p className="text-gray-500 leading-relaxed mb-6">
              List your products, receive gift orders from senders across Zambia,
              and let customers redeem them in-store. Zero delivery. Zero hassle.
            </p>
            <Button
              onClick={() => navigate('/signup')}
              className="bg-gradient-to-r from-orange-500 to-red-500 hover:opacity-90 transition-all shadow-md rounded-xl px-7 py-5 text-base group"
            >
              <Store className="w-5 h-5 mr-2" />
              Register your shop
              <ArrowRight className="w-4 h-4 ml-2 group-hover:translate-x-1 transition-transform" />
            </Button>
            <p className="text-xs text-gray-400 mt-3">
              Create an account, then register your shop from your dashboard.
            </p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, x: 20 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            className="grid grid-cols-2 gap-4"
          >
            {[
              { label: 'Zero delivery costs', desc: 'Customers collect in-store' },
              { label: 'Instant notifications', desc: 'Know when a gift is claimed' },
              { label: 'Trusted payments', desc: 'Settled via mobile money' },
              { label: 'Full dashboard', desc: 'Manage orders and inventory' },
            ].map(({ label, desc }) => (
              <div key={label} className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm">
                <div className="w-2 h-2 rounded-full bg-gradient-to-r from-orange-500 to-red-500 mb-3" />
                <p className="text-sm font-semibold text-gray-800">{label}</p>
                <p className="text-xs text-gray-400 mt-1">{desc}</p>
              </div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* ══════════════════════════════════════
          BOTTOM CTA BANNER
      ══════════════════════════════════════ */}
      <section className="bg-gradient-to-r from-orange-600 via-red-500 to-orange-500 py-20 px-6 text-white text-center">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="max-w-2xl mx-auto"
        >
          <h2 className="text-4xl md:text-5xl font-extrabold mb-4 leading-tight">
            Make someone's day.
            <br />
            Right now.
          </h2>
          <p className="text-white/80 text-lg mb-8">
            It takes less than 2 minutes to send a gift that lasts a lifetime.
          </p>
          <Button
            onClick={() => navigate('/signup')}
            className="px-10 py-6 text-lg rounded-full bg-white text-orange-700 hover:bg-white/90 font-bold shadow-2xl transition-all hover:scale-105"
          >
            Get started — it&apos;s free
          </Button>
        </motion.div>
      </section>

      {/* Footer */}
      <footer className="bg-gray-950 text-gray-500 py-8 text-center text-sm">
        <p>KithLy &copy; 2026 &middot; Send experiences, not just gifts</p>
      </footer>
    </div>
  );
}
