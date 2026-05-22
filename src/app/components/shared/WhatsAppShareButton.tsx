import { Share } from 'lucide-react';
import { Button } from '../ui/button';

export interface WhatsAppShareButtonProps {
  claimCode: string;
  shopName: string;
  amount?: number;
}

export function WhatsAppShareButton({ claimCode, shopName, amount }: WhatsAppShareButtonProps) {
  const handleShare = () => {
    // Professional escrow notification template
    const text = `Hello. I have purchased a gift for you from ${shopName} via KithLy Escrow. Your secure claim code is: ${claimCode}. Present this code to the cashier to collect your items.`;
    const url = `https://wa.me/?text=${encodeURIComponent(text)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  return (
    <Button
      variant="outline"
      onClick={handleShare}
      className="flex w-full items-center justify-center gap-2 rounded-lg border-emerald-700 text-emerald-800 hover:bg-emerald-50 py-5 text-sm font-medium transition-colors"
    >
      <Share className="h-4 w-4" />
      Share via WhatsApp
    </Button>
  );
}
