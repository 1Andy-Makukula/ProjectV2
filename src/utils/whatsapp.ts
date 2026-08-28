/**
 * Sharing a gift over WhatsApp.
 *
 * DECISION, 2026-08-09: the claim code in these links is a BEARER INSTRUMENT.
 * Whoever holds the link can collect the gift. That is deliberate, and it is
 * the same model as a paper gift voucher or a cinema ticket -- the sender picks
 * a contact in WhatsApp, and the recipient may not have a KithLy account at
 * all. Requiring one before collection would break the entire gifting flow,
 * which is the product.
 *
 * What follows from that, and must not be quietly eroded:
 *
 *   - A claim code IS a credential. It is not an identifier that happens to be
 *     secret. Anything that would be wrong to do with a password is wrong to do
 *     with a claim code: do not log it, do not put it in analytics events, do
 *     not include it in error reports, do not send it anywhere it was not
 *     explicitly meant to go.
 *
 *   - Codes are 8 characters from gen_claim_code. That is fine against a person
 *     guessing and thin against a machine enumerating, so any endpoint that
 *     resolves one needs rate limiting. Worth checking before launch.
 *
 *   - Bearer credentials in URLs leak through Referer headers. If the gift page
 *     ever loads a third-party script, font or image, that party receives the
 *     URL -- and therefore the code. Keep /gift/:code free of external
 *     resources, or set a referrer policy that stops it.
 *
 * If the answer ever changes to "recipients must authenticate", it changes
 * here, in the redemption path, and in the sender's expectations -- not by
 * tightening one of them alone.
 */
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

/**
 * The message a sender shares with their recipient.
 *
 * It carries the LINK ONLY, never the claim code. This lives here rather than
 * in the button so it sits next to the decision block above and so the rule is
 * testable: see tests/claim-code.test.ts, which asserts the code never appears
 * in the output. A WhatsApp message is forwarded, cloud-backed and
 * screenshotted; the link resolves to /gift/:code, where the code is revealed
 * on a page we control.
 *
 * Kept short on purpose — WhatsApp renders a preview card for the gift link,
 * and a wall of instructions competes with it.
 */
export function createGiftShareMessage(
  giftPageUrl: string,
  shopName: string,
  recipientName?: string,
  senderName?: string,
): string {
  const greeting = recipientName ? `Hi ${recipientName}, ` : 'Hi, ';
  const fromLine = senderName ? `${senderName} sent you something` : 'someone sent you something';

  return [
    `${greeting}${fromLine} from ${shopName} on KithLy. 🎁`,
    '',
    'Open it here:',
    giftPageUrl,
  ].join('\n');
}

export function getGiftPageUrl(code: string): string {
  const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';
  return `${baseUrl}/gift/${code}`;
}
