import { CheckCircle2 } from 'lucide-react';

interface TelemetryEvent {
  id: string;
  event_type: string;
  payload: any;
  created_at: string;
}

interface TelemetryTimelineProps {
  events: TelemetryEvent[];
}

export function TelemetryTimeline({ events }: TelemetryTimelineProps) {
  const parsePayload = (payload: any) => {
    if (!payload) return {};
    if (typeof payload === 'string') {
      try {
        return JSON.parse(payload);
      } catch {
        return {};
      }
    }
    return payload;
  };

  if (!events || events.length === 0) {
    return (
      <p className="text-xs text-slate-400 italic">
        No activities logged yet. Order is pending collection.
      </p>
    );
  }

  return (
    <div className="relative border-l-2 border-slate-100 ml-3 pl-6 space-y-6 pt-1">
      {events.map((event, idx) => {
        const parsed = parsePayload(event.payload);
        const isFulfillment = event.event_type === 'FULFILLMENT_PROCESSED';
        const timestamp = new Date(event.created_at).toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: true,
        }) + ' - ' + new Date(event.created_at).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
        });

        let title = event.event_type;
        let desc = '';

        if (isFulfillment) {
          title = 'Fulfillment Processed';
          desc = `Items physically verified and handed over at ${parsed.shop_name || 'Partner Shop'}. Count: ${parsed.present_count || 0} items collected.${parsed.missing_count > 0 ? ` ${parsed.missing_count} item(s) marked out of stock (moved to vault/wallet).` : ' Full bundle completed successfully!'}`;
        } else if (event.event_type === 'CLAIM_VERIFIED') {
          title = 'Code Verified';
          desc = 'Escrow code successfully verified at partner terminal. Processing inventory handover...';
        }

        return (
          <div key={event.id || idx} className="relative group flex flex-col gap-1">
            {/* Left aligned intersecting black/green dot */}
            <div className="absolute -left-[31px] top-4 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-white border border-slate-200">
              {isFulfillment ? (
                <div className="h-2 w-2 rounded-full bg-emerald-500" />
              ) : (
                <div className="h-2 w-2 rounded-full bg-black" />
              )}
            </div>

            <div className={`flex flex-col gap-1.5 p-3 rounded-xl transition-all duration-200 ${
              isFulfillment 
                ? 'bg-emerald-50/50 border border-emerald-100/50 shadow-sm' 
                : 'hover:bg-slate-50'
            }`}>
              <div className="flex items-center justify-between gap-4">
                <h4 className={`text-xs font-semibold leading-snug flex items-center gap-1.5 uppercase tracking-wider ${
                  isFulfillment ? 'text-emerald-800' : 'text-slate-800'
                }`}>
                  {isFulfillment && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" />}
                  <span>{title}</span>
                </h4>
                <span className="text-[10px] font-mono text-slate-400 shrink-0">
                  {timestamp}
                </span>
              </div>
              <p className={`text-xs leading-relaxed ${
                isFulfillment ? 'text-emerald-700/90' : 'text-slate-600'
              }`}>
                {desc}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
