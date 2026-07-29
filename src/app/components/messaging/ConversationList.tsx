import { MessageSquare, ShieldCheck, Store, User } from 'lucide-react';
import { relativeTime } from '../../../utils/relativeTime';
import { counterpartyName, type Conversation, type ViewerRole } from '../../types/messaging';

interface ConversationListProps {
  conversations: Conversation[];
  loading: boolean;
  viewerRole: ViewerRole;
  selectedId?: string;
  onSelect: (id: string) => void;
}

export function ConversationList({
  conversations,
  loading,
  viewerRole,
  selectedId,
  onSelect,
}: ConversationListProps) {
  if (loading) {
    return (
      <div className="flex flex-col gap-3 p-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="flex animate-pulse gap-3">
            <div className="h-10 w-10 shrink-0 rounded-full bg-slate-100" />
            <div className="flex-1 space-y-2 py-1">
              <div className="h-3 w-1/2 rounded bg-slate-100" />
              <div className="h-2.5 w-3/4 rounded bg-slate-100" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (conversations.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-center">
        <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-slate-50 shadow-inner">
          <MessageSquare className="h-6 w-6 text-slate-300" strokeWidth={1.5} />
        </div>
        <p className="text-sm font-semibold text-slate-900">No conversations yet</p>
        <p className="mt-1 text-sm text-slate-400">
          {viewerRole === 'merchant'
            ? 'Customer enquiries will appear here.'
            : viewerRole === 'admin'
              ? 'Threads you open or join will appear here.'
              : 'Ask a shop about a service to start one.'}
        </p>
      </div>
    );
  }

  return (
    <div className="divide-y divide-slate-100">
      {conversations.map((conversation) => {
        const isSelected = conversation.id === selectedId;
        const unread = conversation.unread_count ?? 0;
        const isPlatformThread = conversation.kind !== 'buyer_merchant';
        const name = counterpartyName(conversation, viewerRole);

        return (
          <button
            key={conversation.id}
            onClick={() => onSelect(conversation.id)}
            className={`flex w-full gap-3 px-4 py-3.5 text-left transition-colors ${
              isSelected
                ? 'bg-primary-tint'
                : unread > 0
                  ? 'bg-orange-50/50 hover:bg-orange-50'
                  : 'hover:bg-slate-50'
            }`}
          >
            <div
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
                isPlatformThread ? 'bg-primary-tint-mid' : 'bg-slate-100'
              }`}
            >
              {isPlatformThread && viewerRole !== 'admin' ? (
                <ShieldCheck className="h-4 w-4 text-primary" strokeWidth={2} />
              ) : viewerRole === 'buyer' ? (
                <Store className="h-4 w-4 text-slate-500" strokeWidth={2} />
              ) : (
                <User className="h-4 w-4 text-slate-500" strokeWidth={2} />
              )}
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <p
                  className={`truncate text-sm ${
                    unread > 0 ? 'font-semibold text-slate-900' : 'font-medium text-slate-700'
                  }`}
                >
                  {name}
                </p>
                <span className="shrink-0 text-[10px] tabular-nums text-slate-400">
                  {relativeTime(conversation.last_message_at)}
                </span>
              </div>

              <div className="mt-0.5 flex items-center justify-between gap-2">
                <p className="truncate text-xs text-slate-400">
                  {conversation.item?.name ?? conversation.subject ?? 'General enquiry'}
                </p>
                {unread > 0 && (
                  <span className="flex h-4 min-w-[16px] shrink-0 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-white">
                    {unread > 9 ? '9+' : unread}
                  </span>
                )}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
