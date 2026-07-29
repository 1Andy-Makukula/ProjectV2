// ExperienceDetail — one curated offering, shown as what it actually is:
// several shops' work sold together under a single deadline.

import { useParams, useNavigate } from 'react-router';
import { motion } from 'motion/react';
import {
  ArrowLeft,
  Sparkles,
  Store,
  CalendarClock,
  Shield,
  Package,
  Ticket,
} from 'lucide-react';
import { Button } from '../../components/ui/button';
import { useAuth } from '../../../utils/auth/AuthContext';
import { useCart, toProduct } from '../../hooks/useCart';
import { useSendFlowStore } from '../../../utils/sendFlowStore';
import { useExperience } from '../../hooks/useExperiences';
import { formatCurrency } from '../../../utils/currency';
import { toast } from 'sonner';
import {
  experienceTotal,
  experienceIsAvailable,
  experienceHasLapsed,
  groupByShop,
  participatingShops,
  type Experience,
} from '../../types/experiences';

function DeadlineNote({ experience }: { experience: Experience }) {
  if (!experience.expires_at) return null;
  const lapsed = experienceHasLapsed(experience);
  return (
    <div
      className={`mt-4 flex items-start gap-2 rounded-xl border px-3 py-2.5 ${
        lapsed
          ? 'border-slate-200 bg-slate-50 text-slate-500'
          : 'border-amber-200 bg-amber-50 text-amber-800'
      }`}
    >
      <CalendarClock className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2} />
      <p className="text-xs leading-relaxed">
        {lapsed ? 'This experience ended on ' : 'Every part of this must be claimed by '}
        <span className="font-semibold">
          {new Date(experience.expires_at).toLocaleDateString('en-US', {
            day: 'numeric',
            month: 'long',
            year: 'numeric',
          })}
        </span>
        {lapsed ? '.' : ', whichever shop it comes from.'}
      </p>
    </div>
  );
}

export function ExperienceDetail() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { experience, loading } = useExperience(slug);
  const { addToCart, clearCart } = useCart();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-12 w-12 animate-spin rounded-full border-b-2 border-primary" />
      </div>
    );
  }

  if (!experience) {
    return (
      <div className="flex min-h-screen items-center justify-center px-6">
        <div className="max-w-md text-center">
          <Sparkles className="mx-auto mb-4 h-10 w-10 text-slate-300" strokeWidth={1} />
          <h2 className="mb-2 text-2xl font-medium">Experience not found</h2>
          <p className="mb-6 text-muted-foreground">
            This experience is no longer available, or the link has expired.
          </p>
          <Button onClick={() => navigate('/')}>Back to storefront</Button>
        </div>
      </div>
    );
  }

  const total = experienceTotal(experience);
  const shops = participatingShops(experience);
  const groups = groupByShop(experience);
  const lapsed = experienceHasLapsed(experience);
  const available = experienceIsAvailable(experience) && !lapsed;

  const handleGift = () => {
    if (!profile) {
      navigate('/signup');
      return;
    }

    // Every item goes into the cart; checkout already groups a cart by shop and
    // issues one claim code per merchant, so nothing bespoke happens here.
    clearCart();
    for (const line of experience.experience_items ?? []) {
      if (!line.item) continue;
      const product = toProduct({
        id: line.item.id,
        shop_id: line.item.shop?.id ?? '',
        name: line.item.name,
        description: line.item.description,
        price_zmw: line.item.price_zmw,
        image_url: line.item.image_url,
        is_available: line.item.is_available,
      });
      addToCart(product, line.quantity);
    }

    // Carried through checkout so every resulting order shares one deadline.
    useSendFlowStore.getState().setExperience(experience.id);

    toast.success(`${experience.name} added — complete checkout to send it.`);
    navigate('/checkout');
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="sticky top-0 z-10 border-b bg-white">
        <div className="mx-auto flex max-w-4xl items-center gap-3 px-4 py-4 md:px-6">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-xl font-semibold">Experience</h1>
        </div>
      </div>

      <div className="mx-auto max-w-4xl px-4 py-6 md:px-6 md:py-8">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="grid grid-cols-1 gap-6 md:grid-cols-2 md:gap-8"
        >
          {/* Hero */}
          <div className="relative aspect-[4/3] overflow-hidden rounded-2xl border border-slate-100 bg-white">
            {experience.image_url ? (
              <img
                src={experience.image_url}
                alt={experience.name}
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-primary-tint via-white to-primary-tint">
                <Sparkles className="h-14 w-14 text-primary/30" strokeWidth={1} />
              </div>
            )}
            <div className="absolute left-3 top-3 flex items-center gap-1.5 rounded-full border border-primary/20 bg-white/90 px-2.5 py-1 shadow-sm backdrop-blur-sm">
              <Sparkles className="h-3 w-3 text-primary" strokeWidth={2} />
              <span className="text-[10px] font-bold uppercase tracking-wide text-primary">
                Curated by KithLy
              </span>
            </div>
          </div>

          {/* Summary */}
          <div className="flex flex-col">
            <h2 className="text-2xl font-semibold tracking-tight text-slate-900">
              {experience.name}
            </h2>
            {experience.tagline && (
              <p className="mt-1 text-sm text-slate-500">{experience.tagline}</p>
            )}
            {experience.description && (
              <p className="mt-3 text-sm leading-relaxed text-slate-500">
                {experience.description}
              </p>
            )}

            <div className="mt-5 flex items-baseline gap-2">
              <span className="text-3xl font-light tracking-tight text-slate-900">
                {formatCurrency(total, 'ZMW')}
              </span>
              <span className="text-xs text-slate-400">for everything below</span>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-slate-500">
              <span className="flex items-center gap-1.5">
                <Store className="h-3.5 w-3.5 shrink-0 text-slate-400" strokeWidth={2} />
                {shops.length} {shops.length === 1 ? 'shop' : 'shops'}
              </span>
              <span className="flex items-center gap-1.5">
                <Ticket className="h-3.5 w-3.5 shrink-0 text-slate-400" strokeWidth={2} />
                {shops.length} {shops.length === 1 ? 'claim code' : 'separate claim codes'}
              </span>
            </div>

            <DeadlineNote experience={experience} />

            <div className="mt-4 flex items-center gap-2 text-xs text-slate-500">
              <Shield className="h-3.5 w-3.5 shrink-0 text-orange-500" strokeWidth={2} />
              Every part held in escrow until it is collected.
            </div>

            <div className="mt-6">
              <Button onClick={handleGift} disabled={!available} className="w-full">
                {lapsed
                  ? 'This experience has ended'
                  : available
                    ? 'Gift this experience'
                    : 'Currently unavailable'}
              </Button>
              {available && shops.length > 1 && (
                <p className="mt-2.5 text-xs font-light leading-relaxed text-slate-500">
                  Your recipient gets one claim code per shop, so they can collect each part
                  whenever suits them.
                </p>
              )}
            </div>
          </div>
        </motion.div>

        {/* Contents, grouped the way they will be collected */}
        <div className="mt-8 space-y-4">
          <h3 className="text-[11px] font-bold uppercase tracking-widest text-slate-400">
            What is included
          </h3>

          {groups.map(({ shop, lines }) => (
            <div
              key={shop.id}
              className="overflow-hidden rounded-2xl border border-slate-100 bg-white"
            >
              <button
                onClick={() => navigate(`/shop/${shop.id}`)}
                className="flex w-full items-center gap-2 border-b border-slate-50 bg-slate-50/60 px-4 py-2.5 text-left transition-colors hover:bg-slate-100/60"
              >
                <Store className="h-3.5 w-3.5 shrink-0 text-slate-400" strokeWidth={2} />
                <span className="text-xs font-semibold text-slate-700">{shop.name}</span>
              </button>

              <div className="divide-y divide-slate-50">
                {lines.map((line) => (
                  <div key={line.id} className="flex items-start gap-3 px-4 py-3">
                    <div className="h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-slate-50">
                      {line.item?.image_url ? (
                        <img
                          src={line.item.image_url}
                          alt={line.item.name}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center">
                          <Package className="h-4 w-4 text-slate-300" strokeWidth={1.5} />
                        </div>
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-slate-900">
                        {line.item?.name ?? 'Item'}
                        {line.quantity > 1 && (
                          <span className="ml-1.5 text-xs font-normal text-slate-400">
                            × {line.quantity}
                          </span>
                        )}
                      </p>
                      {line.note && (
                        <p className="mt-0.5 text-xs text-slate-400">{line.note}</p>
                      )}
                      {line.item?.is_available === false && (
                        <p className="mt-0.5 text-xs font-medium text-amber-600">
                          Currently out of stock
                        </p>
                      )}
                    </div>

                    <p className="shrink-0 text-sm tabular-nums text-slate-600">
                      {formatCurrency((line.item?.price_zmw ?? 0) * line.quantity, 'ZMW')}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
