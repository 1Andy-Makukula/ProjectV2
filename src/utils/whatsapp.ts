export function createWhatsAppShareLink(
  recipientName: string,
  senderName: string,
  shopName: string,
  giftPageUrl: string
): string {
  const message = `Hi ${recipientName}, ${senderName} has sent you a gift from ${shopName}. Tap the link to see what you have received and collect it in person: ${giftPageUrl}`;

  const encodedMessage = encodeURIComponent(message);
  return `https://wa.me/?text=${encodedMessage}`;
}

export function getGiftPageUrl(code: string): string {
  const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';
  return `${baseUrl}/gift/${code}`;
}
