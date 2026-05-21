import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ShieldCheck, Ticket, Bell, CheckCircle2, Clock } from 'lucide-react';

// 1. Define the KithLy Notification Types
type NotificationType = 'ESCROW_RELEASED' | 'CLAIM_CODE' | 'SYSTEM';

interface KithLyNotification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  timestamp: string;
  read: boolean;
  actionText?: string;
  claimCode?: string;
}

// 2. Realistic Mock Data for the Engine
const MOCK_NOTIFICATIONS: KithLyNotification[] = [
  {
    id: 'n1',
    type: 'CLAIM_CODE',
    title: 'Your Gift is Ready!',
    message: 'The recipient has been notified via SMS. Your 8-character claim code is ready for the shop.',
    timestamp: 'Just now • 16:12',
    read: false,
    claimCode: 'X7B9-MQ2A',
  },
  {
    id: 'n2',
    type: 'ESCROW_RELEASED',
    title: 'Funds Released',
    message: 'The driver scanned the code. Escrow has been successfully released to the merchant.',
    timestamp: '2 hours ago • 14:12',
    read: false,
    actionText: 'View Receipt',
  },
  {
    id: 'n3',
    type: 'SYSTEM',
    title: 'Welcome to KithLy',
    message: 'Your account is fully verified and ready to secure transactions.',
    timestamp: 'Oct 24 • 14:30',
    read: true,
  }
];

export function Notifications() {
  const [notifications, setNotifications] = useState(MOCK_NOTIFICATIONS);

  const markAsRead = (id: string) => {
    setNotifications(prev => 
      prev.map(n => n.id === id ? { ...n, read: true } : n)
    );
  };

  // Helper function to pick the right icon and color based on the event
  const getIconConfig = (type: NotificationType) => {
    switch (type) {
      case 'ESCROW_RELEASED':
        return { icon: ShieldCheck, color: 'text-green-500', bg: 'bg-green-50' };
      case 'CLAIM_CODE':
        return { icon: Ticket, color: 'text-orange-500', bg: 'bg-orange-50' };
      default:
        return { icon: Bell, color: 'text-blue-500', bg: 'bg-blue-50' };
    }
  };

  return (
    <div className="w-full max-w-md mx-auto p-4 bg-gray-50 min-h-screen">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-extrabold tracking-tight bg-gradient-to-r from-orange-500 to-red-500 bg-clip-text text-transparent">
          Notifications
        </h2>
        <span className="text-sm font-medium text-gray-500 bg-gray-200 px-3 py-1 rounded-full">
          {notifications.filter(n => !n.read).length} New
        </span>
      </div>

      <ul className="space-y-4">
        <AnimatePresence>
          {notifications.map((note) => {
            const { icon: Icon, color, bg } = getIconConfig(note.type);
            
            return (
              <motion.li
                key={note.id}
                layout
                initial={{ opacity: 0, y: 20, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                whileHover={{ scale: 1.02 }}
                transition={{ duration: 0.2, ease: "easeOut" }}
                onClick={() => markAsRead(note.id)}
                className={`relative p-4 rounded-2xl shadow-sm border cursor-pointer overflow-hidden transition-colors ${
                  note.read 
                    ? 'bg-white border-gray-100' 
                    : 'bg-orange-50/30 border-orange-100'
                }`}
              >
                {/* The Unread Gradient Indicator Line */}
                {!note.read && (
                  <div className="absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b from-orange-500 to-red-500" />
                )}

                <div className="flex items-start gap-4">
                  {/* Icon Avatar with internal stagger */}
                  <motion.div 
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    className={`p-3 rounded-full shrink-0 ${bg}`}
                  >
                    <Icon className={`w-6 h-6 ${color}`} />
                  </motion.div>

                  {/* Content Area */}
                  <div className="flex-1 min-w-0">
                    {/* Header Stack with internal delay stagger */}
                    <motion.div
                      initial={{ y: 8, opacity: 0 }}
                      animate={{ y: 0, opacity: 1 }}
                      transition={{ delay: 0.1 }}
                    >
                      <div className="flex justify-between items-start mb-1">
                        <h4 className={`text-base truncate ${note.read ? 'font-medium text-gray-800' : 'font-bold text-gray-900'}`}>
                          {note.title}
                        </h4>
                        <div className="flex items-center gap-1 text-xs font-medium text-gray-400 shrink-0 mt-1">
                          <Clock className="w-3 h-3" />
                          {note.timestamp}
                        </div>
                      </div>
                      
                      <p className="text-sm text-gray-600 leading-relaxed mb-3">
                        {note.message}
                      </p>
                    </motion.div>

                    {/* Interactive Elements (staggered from the left track) */}
                    {(note.claimCode || note.actionText) && (
                      <motion.div 
                        initial={{ x: -10, opacity: 0 }}
                        animate={{ x: 0, opacity: 1 }}
                        transition={{ delay: 0.15 }}
                        className="flex items-center gap-2 mt-2"
                      >
                        {note.claimCode && (
                          <div className="bg-gray-100 border border-gray-200 px-3 py-1.5 rounded-lg text-sm font-mono font-bold tracking-widest text-gray-800 flex items-center gap-2">
                            {note.claimCode}
                            <CheckCircle2 className="w-4 h-4 text-green-500" />
                          </div>
                        )}
                        {note.actionText && (
                          <button className="text-sm font-semibold text-orange-600 hover:text-red-600 transition-colors">
                            {note.actionText} &rarr;
                          </button>
                        )}
                      </motion.div>
                    )}
                  </div>
                </div>
              </motion.li>
            );
          })}
        </AnimatePresence>
      </ul>
    </div>
  );
}
