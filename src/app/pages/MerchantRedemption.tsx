// KithLy Merchant Redemption - Handshake Terminal

import { useState } from 'react';
import { Store, TrendingUp, Clock } from 'lucide-react';
import { HandshakeTerminal } from '../components/shared/HandshakeTerminal';
import { mockTransactions } from '../data/mock-data';
import { formatZMW, formatRelativeTime } from '../utils/formatters';
import { Card } from '../components/ui/card';

export function MerchantRedemption() {
  const [recentRedemptions, setRecentRedemptions] = useState(
    mockTransactions.filter(t => t.status === 'completed')
  );

  const handleVerifyCode = async (code: string): Promise<boolean> => {
    // Mock verification - In production, this calls the backend
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    // Simulate 80% success rate
    const success = Math.random() > 0.2;
    
    if (success) {
      // Add to recent redemptions
      const mockRedemption = mockTransactions[0];
      setRecentRedemptions(prev => [mockRedemption, ...prev]);
    }
    
    return success;
  };

  const todayEarnings = recentRedemptions.reduce((sum, t) => sum + t.amount_zmw, 0);

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="container mx-auto px-4 md:px-6 py-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-12 h-12 rounded-full bg-gradient-to-br from-[#F97316] to-[#FB923C] flex items-center justify-center">
              <Store className="w-6 h-6 text-white" strokeWidth={1.5} />
            </div>
            <div>
              <h1 className="font-light text-black">Merchant Terminal</h1>
              <p className="text-sm font-light text-muted-foreground">
                Verify customer gift codes
              </p>
            </div>
          </div>
        </div>

        <div className="grid lg:grid-cols-2 gap-8">
          {/* Left: Handshake Terminal */}
          <div>
            <Card className="p-8 border-none shadow-sm">
              <HandshakeTerminal
                mode="merchant"
                onVerify={handleVerifyCode}
              />
            </Card>

            {/* Stats Cards */}
            <div className="grid grid-cols-2 gap-4 mt-6">
              <Card className="p-4 border-none shadow-sm">
                <div className="flex items-center gap-2 mb-2">
                  <TrendingUp className="w-4 h-4 text-[#F97316]" strokeWidth={1.5} />
                  <span className="text-xs font-light text-muted-foreground">
                    Today's Earnings
                  </span>
                </div>
                <p className="text-2xl font-light bg-gradient-to-r from-[#F97316] to-[#FB923C] bg-clip-text text-transparent">
                  {formatZMW(todayEarnings)}
                </p>
              </Card>

              <Card className="p-4 border-none shadow-sm">
                <div className="flex items-center gap-2 mb-2">
                  <Clock className="w-4 h-4 text-[#F97316]" strokeWidth={1.5} />
                  <span className="text-xs font-light text-muted-foreground">
                    Transactions
                  </span>
                </div>
                <p className="text-2xl font-light text-black">
                  {recentRedemptions.length}
                </p>
              </Card>
            </div>
          </div>

          {/* Right: Recent Redemptions */}
          <div>
            <h2 className="font-light text-black mb-4">Recent Redemptions</h2>
            <div className="space-y-3 max-h-[600px] overflow-y-auto">
              {recentRedemptions.length > 0 ? (
                recentRedemptions.map((transaction) => (
                  <Card key={transaction.id} className="p-4 border-none shadow-sm">
                    <div className="flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        <h3 className="font-light text-black truncate">
                          {transaction.product?.title}
                        </h3>
                        <p className="text-sm font-light text-muted-foreground">
                          Code: {transaction.claim_code}
                        </p>
                      </div>
                      <div className="text-right ml-4">
                        <p className="font-medium text-[#F97316]">
                          {formatZMW(transaction.amount_zmw)}
                        </p>
                        <p className="text-xs font-light text-muted-foreground">
                          {formatRelativeTime(transaction.completed_at || transaction.created_at)}
                        </p>
                      </div>
                    </div>
                  </Card>
                ))
              ) : (
                <div className="text-center py-12">
                  <Clock className="w-12 h-12 mx-auto mb-3 text-muted-foreground" strokeWidth={1.5} />
                  <p className="font-light text-muted-foreground">
                    No redemptions yet today
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}