// Status enums for KithLy domain models
// These are the single source of truth for status values used throughout the application

// Transaction status - matches transactions.status column
export type TransactionStatus = 
  | 'GATEWAY_PROCESSING'
  | 'SUCCESS'
  | 'SUCCESSFUL'
  | 'FAILED'
  | 'CANCELLED'
  | 'EXPIRED';

// Shop order claim status - matches shop_orders.claim_status column
export type ClaimStatus = 
  | 'PENDING_PAYMENT'
  | 'PENDING'
  | 'PROCESSING_FULFILLMENT'
  | 'PARTIAL_FULFILLMENT'
  | 'FULFILLED'
  | 'REDEEMED'
  | 'CANCELLED'
  | 'EXPIRED';

// Shop order payout status - matches shop_orders.payout_status column
export type PayoutStatus = 
  | 'UNFUNDED'
  | 'PENDING_BATCH'
  | 'SETTLED';

// Checkout intent - matches shop_orders.checkout_intent column
export type CheckoutIntent = 
  | 'self'
  | 'friends'
  | 'donate';

// Origin type - matches transactions.origin_type column
export type OriginType = 
  | 'LOCAL'
  | 'INTERNATIONAL';

// Fulfillment status - matches order_items.fulfillment_status column
export type FulfillmentStatus = 
  | 'PENDING'
  | 'COLLECTED'
  | 'MISSING'
  | 'FLOATING'
  | 'CONVERTED'
  | 'EXPIRED';

// Ledger type - matches payout_ledger.ledger_type column
export type LedgerType = 
  | 'FULFILLMENT_CREDIT'
  | 'SETTLEMENT'
  | 'WITHDRAWAL_REQUEST'
  | 'REFUND';

// Event type for transaction_events
export type TransactionEventType = 
  | 'WEBHOOK_RECEIVED'
  | 'CLAIM_VERIFIED'
  | 'PAYOUT_BATCHED'
  | 'FULFILLMENT_CREDIT'
  | 'SETTLEMENT'
  | 'WITHDRAWAL_REQUEST'
  | 'REFUND';

// User role - matches users.role column
export type UserRole = 
  | 'sender'
  | 'merchant'
  | 'admin';

// Shop verification status
export type ShopVerificationStatus = 
  | 'pending'
  | 'approved'
  | 'rejected';

// Shop verification tier
export type ShopVerificationTier = 
  | 'tier_1'
  | 'tier_2'
  | 'tier_3';

// Shop application status
export type ShopApplicationStatus = 
  | 'DRAFT'
  | 'PENDING_REVIEW'
  | 'APPROVED'
  | 'REJECTED';

// Notification type
export type NotificationType = 
  | 'payment'
  | 'payout'
  | 'order'
  | 'system'
  | 'marketing';

// Payout method
export type PayoutMethod = 
  | 'airtel'
  | 'mtn'
  | 'bank';

// Item type
export type ItemType = 
  | 'product'
  | 'service';