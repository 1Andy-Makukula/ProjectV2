// KithLy Customer Dashboard - Gift Vault & Profile

import { Package, Clock, CheckCircle, AlertCircle } from 'lucide-react';
import { motion } from 'motion/react';
import { mockTransactions } from '../data/mock-data';
import { formatZMW, daysUntilExpiry, formatRelativeTime } from '../utils/formatters';
import { Badge } from '../components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { ImageWithFallback } from '../components/figma/ImageWithFallback';
import type { Transaction } from '../types';

export function CustomerDashboard() {
  const activeGifts = mockTransactions.filter(t => t.status === 'in_escrow');
  const completedGifts = mockTransactions.filter(t => t.status === 'completed');

  const getStatusColor = (status: Transaction['status']) => {
    switch (status) {
      case 'in_escrow':
        return 'bg-blue-100 text-blue-700';
      case 'completed':
        return 'bg-green-100 text-green-700';
      case 'disputed':
        return 'bg-red-100 text-red-700';
      default:
        return 'bg-gray-100 text-gray-700';
    }
  };

  const getStatusIcon = (status: Transaction['status']) => {
    switch (status) {
      case 'in_escrow':
        return <Clock className="w-4 h-4" strokeWidth={1.5} />;
      case 'completed':
        return <CheckCircle className="w-4 h-4" strokeWidth={1.5} />;
      case 'disputed':
        return <AlertCircle className="w-4 h-4" strokeWidth={1.5} />;
      default:
        return <Package className="w-4 h-4" strokeWidth={1.5} />;
    }
  };

  const TransactionCard = ({ transaction }: { transaction: Transaction }) => {
    const daysLeft = daysUntilExpiry(transaction.expires_at);
    const isExpiringSoon = daysLeft <= 2;

    return (
      <motion.div
        whileHover={{ y: -2 }}
        className="bg-white rounded-[1rem] border border-border overflow-hidden hover:shadow-md transition-shadow"
      >
        <div className="flex gap-4 p-4">
          {/* Product Image */}
          <div className="w-24 h-24 rounded-lg overflow-hidden bg-gray-100 flex-shrink-0">
            <ImageWithFallback
              src={transaction.product?.images[0] || ''}
              alt={transaction.product?.title || 'Product'}
              className="w-full h-full object-cover"
            />
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0 space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <h3 className="font-light text-black truncate">
                  {transaction.product?.title}
                </h3>
                <p className="text-sm font-light text-muted-foreground">
                  {transaction.shop?.business_name}
                </p>
              </div>
              <Badge className={`${getStatusColor(transaction.status)} font-light flex items-center gap-1`}>
                {getStatusIcon(transaction.status)}
                {transaction.status}
              </Badge>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-lg font-medium bg-gradient-to-r from-[#F97316] to-[#FB923C] bg-clip-text text-transparent">
                {formatZMW(transaction.amount_zmw)}
              </span>
              <span className="text-xs font-light text-muted-foreground">
                {formatRelativeTime(transaction.created_at)}
              </span>
            </div>

            {/* Claim Code (for active gifts) */}
            {transaction.status === 'in_escrow' && (
              <div className="space-y-2">
                <div className="bg-gray-50 rounded-lg p-3 border border-border">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-light text-muted-foreground">
                      Claim Code
                    </span>
                    {isExpiringSoon && (
                      <Badge className="bg-red-100 text-red-700 font-light text-xs">
                        {daysLeft}d left
                      </Badge>
                    )}
                  </div>
                  <div className="text-xl font-mono tracking-wider">
                    {transaction.claim_code}
                  </div>
                </div>
                <button className="w-full py-2 bg-gradient-to-r from-[#F97316] to-[#FB923C] text-white rounded-full font-light text-sm">
                  Show QR Code
                </button>
              </div>
            )}
          </div>
        </div>
      </motion.div>
    );
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="container mx-auto px-4 md:px-6 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="font-light text-black mb-2">My Gift Vault</h1>
          <p className="font-light text-muted-foreground">
            Manage your purchased gifts and redemption codes
          </p>
        </div>

        {/* Tabs */}
        <Tabs defaultValue="active" className="space-y-6">
          <TabsList className="grid w-full max-w-md grid-cols-2">
            <TabsTrigger value="active" className="font-light">
              Active Gifts ({activeGifts.length})
            </TabsTrigger>
            <TabsTrigger value="completed" className="font-light">
              Completed ({completedGifts.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="active" className="space-y-4">
            {activeGifts.length > 0 ? (
              activeGifts.map(transaction => (
                <TransactionCard key={transaction.id} transaction={transaction} />
              ))
            ) : (
              <div className="text-center py-20">
                <Package className="w-16 h-16 mx-auto mb-4 text-muted-foreground" strokeWidth={1.5} />
                <h3 className="font-light text-black mb-2">No active gifts</h3>
                <p className="text-sm font-light text-muted-foreground mb-6">
                  Start shopping to send gifts to your loved ones
                </p>
                <button className="px-6 py-3 bg-gradient-to-r from-[#F97316] to-[#FB923C] text-white rounded-full font-light">
                  Browse Marketplace
                </button>
              </div>
            )}
          </TabsContent>

          <TabsContent value="completed" className="space-y-4">
            {completedGifts.length > 0 ? (
              completedGifts.map(transaction => (
                <TransactionCard key={transaction.id} transaction={transaction} />
              ))
            ) : (
              <div className="text-center py-20">
                <CheckCircle className="w-16 h-16 mx-auto mb-4 text-muted-foreground" strokeWidth={1.5} />
                <h3 className="font-light text-black mb-2">No completed gifts yet</h3>
                <p className="text-sm font-light text-muted-foreground">
                  Your redeemed gifts will appear here
                </p>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}