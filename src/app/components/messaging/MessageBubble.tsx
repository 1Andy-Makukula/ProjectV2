import { ShieldCheck } from 'lucide-react';
import { clockTime } from '../../../utils/relativeTime';
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
          <img
            src={message.image_url}
            alt="Shared attachment"
            className="max-h-72 w-full rounded-xl object-cover"
          />
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
