import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowLeft, Send, FileText, MessageSquare, Store, ShieldCheck, Image as ImageIcon, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useConversation } from '../../hooks/useConversation';
import { MessageBubble } from './MessageBubble';
import { QuotationBuilder } from './QuotationBuilder';
import { dayLabel } from '../../../utils/relativeTime';
import { counterpartyName, type ViewerRole } from '../../types/messaging';
import { Button } from '../ui/button';

interface ThreadViewProps {
  conversationId?: string;
  viewerRole: ViewerRole;
  /** Mobile: the list and thread share one column. */
  onBack?: () => void;
}

export function ThreadView({ conversationId, viewerRole, onBack }: ThreadViewProps) {
  const {
    conversation,
    messages,
    loading,
    sending,
    uploadingImage,
    userId,
    sendMessage,
    sendImageMessage,
    refreshQuotation,
  } = useConversation(conversationId);
  const [draft, setDraft] = useState('');
  const [builderOpen, setBuilderOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  if (!conversationId) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-12 text-center">
        <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-slate-50 shadow-inner">
          <MessageSquare className="h-6 w-6 text-slate-300" strokeWidth={1.5} />
        </div>
        <p className="text-sm font-semibold text-slate-900">No conversation selected</p>
        <p className="mt-1 text-sm text-slate-400">Pick a thread to read it here.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex h-full flex-col gap-4 p-6">
        {[1, 2, 3].map((i) => (
          <div key={i} className={`flex animate-pulse ${i % 2 ? 'justify-start' : 'justify-end'}`}>
            <div className="h-12 w-52 rounded-2xl bg-slate-100" />
          </div>
        ))}
      </div>
    );
  }

  if (!conversation) {
    return (
      <div className="flex h-full items-center justify-center p-12 text-center">
        <p className="text-sm text-slate-400">This conversation is no longer available.</p>
      </div>
    );
  }

  const title = counterpartyName(conversation, viewerRole);
  const isPlatformThread = conversation.kind !== 'buyer_merchant';
  const canQuote = viewerRole === 'merchant' && conversation.kind === 'buyer_merchant';

  const handleSend = async () => {
    const body = draft.trim();
    if (!body) return;
    setDraft('');
    const ok = await sendMessage(body);
    if (!ok) setDraft(body);
  };

  const handleImageSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error('Please choose an image file.');
      return;
    }
    await sendImageMessage(file);
  };

  let lastDay = '';
  let lastSender = '';

  return (
    <div className="flex h-full flex-col bg-slate-50/60">
      {/* Thread header */}
      <div className="flex items-center gap-3 border-b border-slate-100 bg-white px-4 py-3">
        {onBack && (
          <button
            onClick={onBack}
            className="rounded-full p-1.5 text-slate-500 transition-colors hover:bg-slate-100 md:hidden"
            aria-label="Back to conversations"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
        )}
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary-tint">
          {isPlatformThread && viewerRole !== 'admin' ? (
            <ShieldCheck className="h-4 w-4 text-primary" strokeWidth={2} />
          ) : (
            <Store className="h-4 w-4 text-primary" strokeWidth={2} />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-slate-900">{title}</p>
          {(conversation.item?.name || conversation.subject) && (
            <p className="truncate text-xs text-slate-400">
              {conversation.item?.name ?? conversation.subject}
            </p>
          )}
        </div>
        {canQuote && !builderOpen && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setBuilderOpen(true)}
            className="gap-1.5"
          >
            <FileText className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Quote</span>
          </Button>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 space-y-2 overflow-y-auto px-4 py-4">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <MessageSquare className="mb-3 h-8 w-8 text-slate-200" strokeWidth={1.5} />
            <p className="text-sm text-slate-400">
              No messages yet. Say hello to get things started.
            </p>
          </div>
        )}

        <AnimatePresence initial={false}>
          {messages.map((message) => {
            const day = dayLabel(message.created_at);
            const showDay = day !== lastDay;
            if (showDay) lastDay = day;

            const senderKey = `${message.sender_role}:${message.sender_id}`;
            const showSender = senderKey !== lastSender || showDay;
            lastSender = senderKey;

            return (
              <div key={message.id}>
                {showDay && (
                  <div className="flex justify-center py-3">
                    <span className="rounded-full bg-white px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-slate-400 shadow-sm">
                      {day}
                    </span>
                  </div>
                )}
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.18 }}
                >
                  <MessageBubble
                    message={message}
                    conversation={conversation}
                    viewerRole={viewerRole}
                    isOwn={message.sender_id === userId}
                    showSender={showSender}
                    onQuotationChanged={refreshQuotation}
                  />
                </motion.div>
              </div>
            );
          })}
        </AnimatePresence>
        <div ref={bottomRef} />
      </div>

      {/* Quotation builder */}
      {builderOpen && conversationId && (
        <QuotationBuilder conversationId={conversationId} onClose={() => setBuilderOpen(false)} />
      )}

      {/* Composer */}
      {conversation.is_closed ? (
        <div className="border-t border-slate-100 bg-white px-4 py-4 text-center">
          <p className="text-xs text-slate-400">This conversation is closed.</p>
        </div>
      ) : (
        <div className="border-t border-slate-100 bg-white px-4 py-3">
          <div className="flex items-end gap-2">
            <input
              ref={imageInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleImageSelected}
            />
            <button
              onClick={() => imageInputRef.current?.click()}
              disabled={uploadingImage}
              className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-xl border border-slate-200 text-slate-500
                         transition-all duration-200 hover:bg-slate-50 active:scale-[0.97]
                         disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="Attach an image"
            >
              {uploadingImage ? (
                <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
              ) : (
                <ImageIcon className="h-4 w-4" strokeWidth={2} />
              )}
            </button>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              rows={1}
              placeholder="Write a message…"
              className="max-h-32 min-h-[42px] flex-1 resize-none rounded-xl border border-slate-200 bg-slate-50/70 px-3.5 py-2.5 text-sm
                         placeholder:text-slate-400 focus:border-primary/50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/15"
            />
            <button
              onClick={handleSend}
              disabled={sending || !draft.trim()}
              className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground
                         transition-all duration-200 hover:opacity-90 active:scale-[0.97]
                         disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="Send message"
            >
              <Send className="h-4 w-4" strokeWidth={2} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
