import React, { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import { useAuth } from '../../../utils/auth/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { ScrollArea } from '../ui/scroll-area';
import { formatZMW } from '../../../utils/currencyHelpers';
import { formatDistanceToNow } from 'date-fns';
import { ArrowDownLeft, ArrowUpRight, Clock, Wallet } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface LedgerEntry {
  id: string;
  amount: number;
  description: string | null;
  created_at: string;
}

export function WalletLedgerView() {
  const { user } = useAuth();
  const [balance, setBalance] = useState<number>(0);
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user?.id) return;

    const fetchWalletData = async () => {
      try {
        // Fetch balance from cache
        const { data: walletData, error: walletError } = await supabase
          .from('kithly_wallets')
          .select('id, balance')
          .eq('user_id', user.id)
          .single();

        if (walletError && walletError.code !== 'PGRST116') {
          console.error('Error fetching wallet:', walletError);
          return;
        }

        if (walletData) {
          setBalance(walletData.balance);

          // Fetch ledger history
          const { data: ledgerData, error: ledgerError } = await supabase
            .from('wallet_ledger')
            .select('id, amount, description, created_at')
            .eq('wallet_id', walletData.id)
            .order('created_at', { ascending: false });

          if (ledgerError) throw ledgerError;
          if (ledgerData) setLedger(ledgerData);
        }
      } catch (err) {
        console.error('Failed to load wallet ledger:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchWalletData();
  }, [user]);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-orange-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Balance Card - Glassmorphism */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <Card className="overflow-hidden border-white/20 bg-white/40 backdrop-blur-xl shadow-lg ring-1 ring-black/5 rounded-3xl relative">
          <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-orange-300 via-orange-400 to-orange-300 opacity-80" />
          <CardContent className="p-8">
            <div className="flex items-center gap-4 text-slate-500 mb-2">
              <Wallet className="h-5 w-5 text-orange-500" />
              <span className="font-medium uppercase tracking-wider text-sm">Available Balance</span>
            </div>
            <div className="text-4xl sm:text-5xl font-light tracking-tight text-slate-900">
              {formatZMW(balance)}
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* Ledger History */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.1 }}
      >
        <Card className="border-white/20 bg-white/40 backdrop-blur-xl shadow-sm ring-1 ring-black/5 rounded-3xl overflow-hidden">
          <CardHeader className="border-b border-slate-100/50 bg-white/30 px-6 py-5">
            <CardTitle className="text-lg font-medium text-slate-800 flex items-center gap-2">
              <Clock className="h-4 w-4 text-slate-400" />
              Recent Transactions
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="h-[400px]">
              {ledger.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-48 text-slate-400">
                  <Wallet className="h-8 w-8 mb-3 opacity-20" />
                  <p>No transactions yet</p>
                </div>
              ) : (
                <div className="divide-y divide-slate-100/50">
                  <AnimatePresence>
                    {ledger.map((entry, index) => {
                      const isCredit = entry.amount > 0;
                      return (
                        <motion.div
                          key={entry.id}
                          initial={{ opacity: 0, x: -10 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: index * 0.05 }}
                          className="flex items-center justify-between p-6 hover:bg-white/50 transition-colors"
                        >
                          <div className="flex items-center gap-4">
                            <div className={`flex h-10 w-10 items-center justify-center rounded-full ${isCredit ? 'bg-emerald-100/50 text-emerald-600' : 'bg-rose-100/50 text-rose-600'}`}>
                              {isCredit ? <ArrowDownLeft className="h-5 w-5" /> : <ArrowUpRight className="h-5 w-5" />}
                            </div>
                            <div>
                              <p className="font-medium text-slate-900">
                                {entry.description || (isCredit ? 'Received' : 'Sent')}
                              </p>
                              <p className="text-sm text-slate-500">
                                {formatDistanceToNow(new Date(entry.created_at), { addSuffix: true })}
                              </p>
                            </div>
                          </div>
                          <div className={`font-medium ${isCredit ? 'text-emerald-600' : 'text-slate-900'}`}>
                            {isCredit ? '+' : ''}{formatZMW(entry.amount)}
                          </div>
                        </motion.div>
                      );
                    })}
                  </AnimatePresence>
                </div>
              )}
            </ScrollArea>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
