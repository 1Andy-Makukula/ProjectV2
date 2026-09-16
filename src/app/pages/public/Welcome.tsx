// The front door: the first thing you see after logging in.
//
// Not a marketing page — pages/public/Landing.tsx is that, and it is a signup
// funnel with a different job. This is orientation: who we are, what happens
// to your money, and which of the two doors you want.
//
// It asks the two-market question once, out loud, instead of guessing. A
// diaspora sender and a Lusaka shopper want almost nothing in common from a
// front page, and the six mode chips on the storefront were never a fork —
// six equal options is what not choosing looks like. Both doors lead to the
// same storefront with the mode already set, so neither answer is a trap.

import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router';
import { motion } from 'motion/react';
import { ArrowRight, Shield, ScanLine, Coins, MessageCircle, Mail } from 'lucide-react';
import { useStorefrontMode } from '../../hooks/useStorefrontMode';
import { markWelcomeSeen } from './welcomeSeen';
import { WELCOME_VIDEO, WELCOME_POSTER } from './welcomeMedia';

const PROMISES = [
  {
    icon: Coins,
    title: 'The rate you see is the rate you pay',
    body: 'Your kwacha total is locked before you pay, and held for fifteen minutes. No spread hidden in the conversion.',
  },
  {
    icon: Shield,
    title: 'Your money waits in escrow',
    body: 'The shop is not paid when you are. It is paid once your person has collected what you sent.',
  },
  {
    icon: ScanLine,
    title: 'You are told the moment it is handed over',
    body: 'The code is scanned at the counter and you hear about it there and then — not the next day, and not from us guessing.',
  },
];

export function Welcome() {
  const navigate = useNavigate();
  const { setMode } = useStorefrontMode();
  const [videoFailed, setVideoFailed] = useState(false);

  const enter = useCallback(
    (mode: 'gifting' | 'shopping') => {
      markWelcomeSeen();
      setMode(mode);
      navigate('/', { replace: true });
    },
    [navigate, setMode],
  );

  return (
    <div className="min-h-screen bg-background">
      {/* The wash. A touch of home before a single word of product. */}
      <section className="kl-gradient-brand-br relative overflow-hidden px-6 py-16 text-white md:py-24">
        <div className="container mx-auto max-w-3xl">
          <motion.p
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-white/80"
          >
            A touch of home
          </motion.p>
          <motion.h1
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.06 }}
            className="text-3xl font-semibold leading-tight tracking-tight md:text-5xl"
          >
            KithLy
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.12 }}
            className="mt-4 max-w-xl text-base font-light leading-relaxed text-white/90 md:text-lg"
          >
            Send the thing itself, not the money for it. Groceries, a cake, a
            prescription — bought here, collected by the person you sent it to,
            at a shop in Zambia you can see before you pay.
          </motion.p>
        </div>
      </section>

      <div className="container mx-auto max-w-3xl px-6 py-12 md:py-16">
        {/* Who is behind this. The point is a face, not a production. */}
        <div className="kl-stage mb-4 bg-black">
          {videoFailed ? (
            <div className="flex aspect-video w-full items-center justify-center bg-slate-900 px-6 text-center">
              <p className="text-sm font-light text-white/70">
                The welcome film could not load. Everything below still applies.
              </p>
            </div>
          ) : (
            <video
              className="aspect-video w-full"
              src={WELCOME_VIDEO}
              poster={WELCOME_POSTER || undefined}
              controls
              playsInline
              preload="none"
              onError={() => setVideoFailed(true)}
            >
              Your browser cannot play this video.
            </video>
          )}
        </div>
        <p className="mb-14 text-xs font-light text-muted-foreground">
          Placeholder film. The real one is a minute of us saying who we are and
          how to reach us directly.
        </p>

        {/* What we are promising, in the order people worry about it. */}
        <h2 className="mb-6 text-xl font-semibold tracking-tight text-slate-900">
          We are new, and we would rather say so
        </h2>
        <p className="mb-8 max-w-xl text-sm font-light leading-relaxed text-muted-foreground">
          You have probably been burned by a transfer that arrived short, or a
          relative who never quite got what you paid for. So here is exactly what
          happens to your money, before you give us any.
        </p>

        <div className="mb-14 grid gap-4">
          {PROMISES.map((promise, i) => (
            <motion.div
              key={promise.title}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.05 * i }}
              className="kl-tile kl-rim flex items-start gap-4 p-5"
            >
              <div className="kl-gradient-brand-br flex h-10 w-10 shrink-0 items-center justify-center rounded-xl">
                <promise.icon className="h-4.5 w-4.5 text-white" strokeWidth={1.5} />
              </div>
              <div className="min-w-0">
                <h3 className="mb-1 text-sm font-semibold text-slate-900">{promise.title}</h3>
                <p className="text-sm font-light leading-relaxed text-muted-foreground">
                  {promise.body}
                </p>
              </div>
            </motion.div>
          ))}
        </div>

        {/* The two doors. This is the whole two-market question, asked once. */}
        <h2 className="mb-6 text-xl font-semibold tracking-tight text-slate-900">
          Which brings you here?
        </h2>

        <div className="grid gap-4 sm:grid-cols-2">
          <button
            onClick={() => enter('gifting')}
            className="kl-tile kl-rim kl-lift group p-6 text-left"
          >
            <span className="mb-1.5 block text-base font-semibold text-slate-900">
              Send home
            </span>
            <span className="mb-4 block text-sm font-light leading-relaxed text-muted-foreground">
              Somebody in Zambia is collecting it — groceries for the month, a
              birthday, a pharmacy run. You pay here, they collect there.
            </span>
            <span className="flex items-center gap-1.5 text-sm font-medium text-primary">
              Start sending
              <ArrowRight
                className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5"
                strokeWidth={2}
              />
            </span>
          </button>

          <button
            onClick={() => enter('shopping')}
            className="kl-tile kl-rim kl-lift group p-6 text-left"
          >
            <span className="mb-1.5 block text-base font-semibold text-slate-900">
              I am Zambian
            </span>
            <span className="mb-4 block text-sm font-light leading-relaxed text-muted-foreground">
              You are here and shopping for yourself. Straight into the
              catalogue: every shop, every item, nothing in the way.
            </span>
            <span className="flex items-center gap-1.5 text-sm font-medium text-primary">
              Browse the shops
              <ArrowRight
                className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5"
                strokeWidth={2}
              />
            </span>
          </button>
        </div>

        {/* Reachable by a person, which is most of what trust is early on. */}
        <div className="mt-12 flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-border pt-8">
          <span className="text-sm font-light text-muted-foreground">
            Something wrong, or just want to ask first?
          </span>
          <a
            href="https://wa.me/260977000000"
            className="flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
          >
            <MessageCircle className="h-3.5 w-3.5" strokeWidth={2} />
            WhatsApp
          </a>
          <a
            href="mailto:support@kithly.zm"
            className="flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
          >
            <Mail className="h-3.5 w-3.5" strokeWidth={2} />
            support@kithly.zm
          </a>
        </div>
      </div>
    </div>
  );
}
