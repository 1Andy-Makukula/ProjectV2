import { useEffect, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { clockTime } from '../../../utils/relativeTime';
import { resolveChatImageSrc } from '../../../utils/uploadImage';
import { QuotationCard } from './QuotationCard';
import {
  displayNameForSender,
  type Conversation,
  type Message,
  type ViewerRole,
  type Quotation,
} from '../../types/messaging';

interface MessageBubbleProps {
  message: Message;
  conversation: Conversation;
  viewerRole: ViewerRole;
  isOwn: boolean;
  /** First of a run from the same sender — only that one carries the name. */
  showSender: boolean;
  onQuotationChanged?: (q: Quotation) => void;
}

export function MessageBubble({
  message,
  conversation,
  viewerRole,
  isOwn,
  showSender,
  onQuotationChanged,
}: MessageBubbleProps) {
  // Attachments are private now (migration 20260903020000): messages.image_url
  // holds a storage path in the `chat-attachments` bucket, and a viewable URL
  // has to be signed per render. Legacy rows still hold an absolute public URL
  // and resolveChatImageSrc passes those straight through.
  //
  // Declared above the early returns below, because a hook cannot sit after
  // one. `stored` is read rather than the whole message so the effect does not
  // re-run on every unrelated re-render of the row.
  const stored = message.message_type === 'image' ? message.image_url : null;
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [imageError, setImageError] = useState(false);

  useEffect(() => {
    if (!stored) {
      setImageSrc(null);
      setImageError(false);
      return;
    }

    // A signed URL arriving after the row has scrolled out of the list would
    // set state on an unmounted component; `cancelled` drops the late result.
    let cancelled = false;
    setImageError(false);

    resolveChatImageSrc(stored).then((src) => {
      if (cancelled) return;
      setImageSrc(src);
      setImageError(src === null);
    });

    return () => {
      cancelled = true;
    };
  }, [stored]);

  // System lines are the thread narrating itself — centred, not attributed.
  if (message.message_type === 'system') {
    return (
      <div className="flex justify-center py-1">
        <span className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-medium text-slate-500">
          {message.body}
        </span>
      </div>
    );
  }

  const isPlatform = message.sender_role === 'admin';
  const senderName = displayNameForSender(message.sender_role, conversation);

  if (message.message_type === 'quotation' && message.quotation) {
    return (
      <div className={`flex flex-col gap-1 ${isOwn ? 'items-end' : 'items-start'}`}>
        {showSender && (
          <span className="px-1 text-[11px] font-semibold text-slate-400">{senderName}</span>
        )}
        <QuotationCard
          quotation={message.quotation}
          viewerRole={viewerRole}
          shopName={conversation.shop?.name}
          onChanged={onQuotationChanged}
        />
        <span className="px-1 text-[10px] tabular-nums text-slate-300">
          {clockTime(message.created_at)}
        </span>
      </div>
    );
  }

  return (
    <div className={`flex flex-col gap-1 ${isOwn ? 'items-end' : 'items-start'}`}>
      {showSender && (
        <span className="flex items-center gap-1 px-1 text-[11px] font-semibold text-slate-400">
          {isPlatform && <ShieldCheck className="h-3 w-3 text-primary" strokeWidth={2} />}
          {senderName}
        </span>
      )}

      <div
        className={`max-w-[min(32rem,80%)] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed
                    ${
                      isOwn
                        ? 'rounded-br-md bg-primary text-primary-foreground'
                        : isPlatform
                          ? 'rounded-bl-md border border-primary/20 bg-primary-tint text-slate-800'
                          : 'rounded-bl-md border border-slate-200 bg-white text-slate-800'
                    }`}
      >
        {message.message_type === 'image' && message.image_url ? (
          imageSrc ? (
            <img
              src={imageSrc}
              alt="Shared attachment"
              className="max-h-72 w-full rounded-xl object-cover"
            />
          ) : (
            <div className="flex h-32 w-full items-center justify-center rounded-xl bg-slate-100 text-xs text-slate-400">
              {imageError ? 'Attachment unavailable' : 'Loading attachment…'}
            </div>
          )
        ) : (
          <p className="whitespace-pre-wrap break-words">{message.body}</p>
        )}
      </div>

      <span className="px-1 text-[10px] tabular-nums text-slate-300">
        {clockTime(message.created_at)}
      </span>
    </div>
  );
}
