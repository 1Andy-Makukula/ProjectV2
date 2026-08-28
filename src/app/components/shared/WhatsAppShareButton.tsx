import { Share } from 'lucide-react';
import { Button } from '../ui/button';
import { createGiftShareMessage, getGiftPageUrl } from '../../../utils/whatsapp';

export interface WhatsAppShareButtonProps {
  claimCode: string;
  shopName: string;
  recipientName?: string;
  senderName?: string;
  amount?: number;
}

/**
 * Share a gift over WhatsApp.
 *
 * The message carries the LINK ONLY. It used to carry the claim code in
 * plaintext as well, which contradicted the decision block at the top of
 * utils/whatsapp.ts: a claim code is a credential, and a WhatsApp message is
 * forwarded, cloud-backed and screenshotted. The link resolves to /gift/:code,
 * which reveals the code on a page we control — same reach for the recipient,
 * far less spill.
 */
export function WhatsAppShareButton({ claimCode, shopName, recipientName, senderName }: WhatsAppShareButtonProps) {
  const handleShare = () => {
    const giftLink = getGiftPageUrl(claimCode);
    const text = createGiftShareMessage(giftLink, shopName, recipientName, senderName);
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
