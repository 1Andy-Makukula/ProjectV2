// Shared vocabulary for conversations, messages and quotations.

export type ConversationKind = 'buyer_merchant' | 'admin_buyer' | 'admin_shop';
export type SenderRole = 'buyer' | 'merchant' | 'admin' | 'system';
export type MessageType = 'text' | 'image' | 'quotation' | 'system';
export type QuotationStatus = 'pending' | 'accepted' | 'declined' | 'withdrawn' | 'expired';

/** Who the signed-in user is inside a given thread. */
export type ViewerRole = Exclude<SenderRole, 'system'>;

export interface QuotationLineItem {
  id: string;
  description: string;
  quantity: number;
  unit_price_zmw: number;
  sort_order: number;
}

export interface Quotation {
  id: string;
  conversation_id: string;
  shop_id: string;
  buyer_id: string;
  status: QuotationStatus;
  total_amount: number;
  notes: string | null;
  valid_until: string | null;
  target_execution_date: string | null;
  fulfillment_item_id: string | null;
  created_at: string;
  decline_reason: string | null;
  quotation_line_items?: QuotationLineItem[];
}

export interface Message {
  id: string;
  conversation_id: string;
  sender_id: string | null;
  sender_role: SenderRole;
  message_type: MessageType;
  body: string | null;
  image_url: string | null;
  quotation_id: string | null;
  created_at: string;
  quotation?: Quotation | null;
}

export interface Conversation {
  id: string;
  kind: ConversationKind;
  buyer_id: string | null;
  shop_id: string | null;
  item_id: string | null;
  subject: string | null;
  is_closed: boolean;
  last_message_at: string;
  created_at: string;
  shop?: { id: string; name: string; logo_url?: string | null } | null;
  buyer?: { id: string; name: string | null } | null;
  item?: { id: string; name: string } | null;
  unread_count?: number;
}

/**
 * An admin is always presented as the platform, never as the person who typed
 * the message. The same rule applies wherever a sender is named.
 */
export function displayNameForSender(
  role: SenderRole,
  conversation: Pick<Conversation, 'shop' | 'buyer'>,
): string {
  switch (role) {
    case 'admin':
      return 'KithLy';
    case 'merchant':
      return conversation.shop?.name ?? 'The shop';
    case 'buyer':
      return conversation.buyer?.name ?? 'Customer';
    default:
      return 'KithLy';
  }
}

/** What the viewer should see as the other party's name in a thread list. */
export function counterpartyName(
  conversation: Conversation,
  viewerRole: ViewerRole,
): string {
  if (conversation.kind !== 'buyer_merchant') {
    // One side of an admin thread is always the platform.
    return viewerRole === 'admin'
      ? conversation.shop?.name ?? conversation.buyer?.name ?? 'Unknown'
      : 'KithLy';
  }
  return viewerRole === 'buyer'
    ? conversation.shop?.name ?? 'Shop'
    : conversation.buyer?.name ?? 'Customer';
}

export const QUOTATION_STATUS_LABELS: Record<QuotationStatus, string> = {
  pending: 'Awaiting response',
  accepted: 'Accepted',
  declined: 'Declined',
  withdrawn: 'Withdrawn',
  expired: 'Expired',
};
