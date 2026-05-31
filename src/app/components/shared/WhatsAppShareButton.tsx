import { Share } from 'lucide-react';
import { Button } from '../ui/button';
import { getGiftPageUrl } from '../../../utils/whatsapp';

export interface WhatsAppShareButtonProps {
  claimCode: string;
  shopName: string;
  recipientName?: string;
  senderName?: string;
  amount?: number;
}

export function WhatsAppShareButton({ claimCode, shopName, recipientName, senderName, amount }: WhatsAppShareButtonProps) {
  const handleShare = () => {
    const giftLink = getGiftPageUrl(claimCode);
    const greeting = recipientName ? `Hi ${recipientName}, ` : 'Hi, ';
    const fromLine = senderName ? `you've received a gift from ${senderName}` : `you've received a gift`;

    const text = [
      `${greeting}${fromLine} on KithLy! 🎁`,
      ``,
      `Your claim code is: *${claimCode}*`,
      `Shop: ${shopName}`,
      ``,
      `Show the code to the cashier at the shop to collect your gift.`,
      ``,
      `Or tap the link below to view your gift details & QR code:`,
      giftLink,
    ].join('\n');

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
