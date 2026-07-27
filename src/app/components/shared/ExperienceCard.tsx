import { Sparkles, Store, CalendarClock, Shield } from 'lucide-react';
import { formatCurrency } from '../../../utils/currency';
import {
  experienceTotal,
  experienceIsAvailable,
  experienceHasLapsed,
  participatingShops,
  type Experience,
} from '../../types/experiences';

interface ExperienceCardProps {
  experience: Experience;
  onOpen: () => void;
}

export function ExperienceCard({ experience, onOpen }: ExperienceCardProps) {
  const total = experienceTotal(experience);
  const shops = participatingShops(experience);
  const available = experienceIsAvailable(experience) && !experienceHasLapsed(experience);
  const itemCount = (experience.experience_items ?? []).reduce((n, l) => n + l.quantity, 0);

  return (
    <article
      onClick={onOpen}
      className="group relative flex cursor-pointer flex-col overflow-hidden rounded-2xl border border-slate-100
                 bg-white transition-all duration-300 hover:border-slate-200 hover:shadow-md"
    >
      <div className="relative aspect-[4/3] w-full shrink-0 overflow-hidden bg-slate-50">
        {experience.image_url ? (
          <img
            src={experience.image_url}
            alt={experience.name}
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-primary-tint via-white to-primary-tint">
            <Sparkles className="h-10 w-10 text-primary/30" strokeWidth={1} />
          </div>
        )}

        <div className="absolute left-2.5 top-2.5 flex items-center gap-1 rounded-full border border-primary/20 bg-white/90 px-2 py-0.5 shadow-sm backdrop-blur-sm">
          <Sparkles className="h-2.5 w-2.5 shrink-0 text-primary" strokeWidth={2} />
          <span className="text-[9px] font-bold uppercase tracking-wide text-primary">
            Experience
          </span>
        </div>

        {!available && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/70 backdrop-blur-[1px]">
            <span className="rounded-full bg-slate-900/80 px-3 py-1 text-[10px] font-bold uppercase tracking-wide text-white">
              {experienceHasLapsed(experience) ? 'Ended' : 'Unavailable'}
            </span>
          </div>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-1 px-4 py-3">
        <h3 className="truncate text-sm font-semibold leading-snug text-slate-900">
          {experience.name}
        </h3>

        {experience.tagline && (
          <p className="line-clamp-1 text-[11px] leading-snug text-slate-400">
            {experience.tagline}
          </p>
        )}

        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-slate-500">
          <span className="flex items-center gap-1">
            <Store className="h-3 w-3 shrink-0 text-slate-400" strokeWidth={2} />
            {shops.length} {shops.length === 1 ? 'shop' : 'shops'}
          </span>
          <span>
            {itemCount} {itemCount === 1 ? 'item' : 'items'}
          </span>
          {experience.expires_at && (
            <span className="flex items-center gap-1">
              <CalendarClock className="h-3 w-3 shrink-0 text-slate-400" strokeWidth={2} />
              {new Date(experience.expires_at).toLocaleDateString('en-US', {
                day: 'numeric',
                month: 'short',
              })}
            </span>
          )}
        </div>

        <p className="mt-2 text-sm font-semibold text-slate-900">
          {formatCurrency(total, 'ZMW')}
        </p>

        <div className="mt-2.5 flex items-center gap-1 text-[10px] text-slate-400">
          <Shield className="h-3 w-3 shrink-0 text-orange-500" strokeWidth={2} />
          Escrow protected
        </div>
      </div>
    </article>
  );
}
