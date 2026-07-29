// Messages — one page, three roles.
//
// Buyer, merchant and admin all read the same threads through the same
// components; RLS decides which rows come back. The only role-specific
// behaviour is who may send a quotation, which lives in ThreadView.

import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { ArrowLeft, MessageSquare } from 'lucide-react';
import { useAuth } from '../../utils/auth/AuthContext';
import { useConversations } from '../hooks/useConversations';
import { ConversationList } from '../components/messaging/ConversationList';
import { ThreadView } from '../components/messaging/ThreadView';
import { NotificationBell } from '../components/shared/NotificationBell';
import type { ViewerRole } from '../types/messaging';

function roleFor(profileRole?: string): ViewerRole {
  if (profileRole === 'admin') return 'admin';
  if (profileRole === 'merchant') return 'merchant';
  return 'buyer';
}

export function Messages() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const viewerRole = roleFor(profile?.role);
  const { conversations, loading } = useConversations(viewerRole);

  const [searchParams, setSearchParams] = useSearchParams();
  const selectedId = searchParams.get('c') ?? undefined;

  // Mobile shows one pane at a time; desktop shows both.
  const [showThreadOnMobile, setShowThreadOnMobile] = useState(Boolean(selectedId));

  useEffect(() => {
    if (selectedId) setShowThreadOnMobile(true);
  }, [selectedId]);

  const select = (id: string) => {
    setSearchParams({ c: id });
    setShowThreadOnMobile(true);
  };

  const backToList = () => {
    setShowThreadOnMobile(false);
    setSearchParams({});
  };

  const homeFor =
    viewerRole === 'admin' ? '/admin' : viewerRole === 'merchant' ? '/merchant' : '/dashboard';

  return (
    <div className="flex min-h-screen flex-col bg-white">
      {/* Page header */}
      <div className="border-b border-slate-100 bg-white">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-4 md:px-6">
          <button
            onClick={() => navigate(homeFor)}
            className="rounded-full p-1.5 text-slate-500 transition-colors hover:bg-slate-100"
            aria-label="Back"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="flex flex-1 items-center gap-2">
            <MessageSquare className="h-5 w-5 text-primary" strokeWidth={1.75} />
            <h1 className="text-xl font-semibold tracking-tight text-slate-900">Messages</h1>
          </div>
          <NotificationBell />
        </div>
      </div>

      {/* Panes */}
      <div className="mx-auto flex w-full max-w-6xl flex-1 overflow-hidden md:px-6 md:py-6">
        <div className="flex w-full overflow-hidden rounded-none border-slate-200 md:rounded-2xl md:border">
          {/* Thread list */}
          <aside
            className={`w-full overflow-y-auto border-slate-100 md:w-80 md:shrink-0 md:border-r ${
              showThreadOnMobile ? 'hidden md:block' : 'block'
            }`}
          >
            <ConversationList
              conversations={conversations}
              loading={loading}
              viewerRole={viewerRole}
              selectedId={selectedId}
              onSelect={select}
            />
          </aside>

          {/* Open thread */}
          <main
            className={`min-w-0 flex-1 ${showThreadOnMobile ? 'block' : 'hidden md:block'}`}
            style={{ minHeight: '60vh' }}
          >
            <ThreadView
              conversationId={selectedId}
              viewerRole={viewerRole}
              onBack={backToList}
            />
          </main>
        </div>
      </div>
    </div>
  );
}
