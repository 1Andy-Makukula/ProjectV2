-- Canonical KithLy V2 Database Schema
-- Updated: July 2026

CREATE TABLE public.users (
  id uuid NOT NULL,
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  phone text,
  role text NOT NULL DEFAULT 'sender'::text CHECK (role = ANY (ARRAY['sender'::text, 'merchant'::text, 'admin'::text])),
  created_at timestamp with time zone DEFAULT now(),
  location text,
  CONSTRAINT users_pkey PRIMARY KEY (id)
);

CREATE TABLE public.payout_trust_tiers (
  tier text NOT NULL,
  min_successful_deliveries integer NOT NULL,
  upfront_percentage integer NOT NULL CHECK (upfront_percentage >= 0 AND upfront_percentage <= 100),
  exposure_limit integer NOT NULL,
  sort_order integer NOT NULL,
  CONSTRAINT payout_trust_tiers_pkey PRIMARY KEY (tier)
);

CREATE TABLE public.shops (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  location text,
  address text,
  payout_method text CHECK (payout_method = ANY (ARRAY['airtel'::text, 'mtn'::text, 'bank'::text])),
  payout_details text,
  is_active boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  logo_url text,
  description text,
  image_url text,
  cover_image_url text,
  application_status text NOT NULL DEFAULT 'APPROVED'::text CHECK (application_status = ANY (ARRAY['DRAFT'::text, 'PENDING_REVIEW'::text, 'APPROVED'::text, 'REJECTED'::text])),
  pacra_document_url text,
  nrc_document_url text,
  rejection_reason text,
  nrc_url text,
  pacra_url text,
  shop_location text,
  physical_address text,
  verification_tier text DEFAULT 'tier_1'::text,
  verification_status text DEFAULT 'pending'::text CHECK (verification_status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text])),
  offers_products boolean NOT NULL DEFAULT true,
  offers_services boolean NOT NULL DEFAULT false,
  verification_reviewed_by uuid,
  verification_reviewed_at timestamp with time zone,
  payout_trust_tier text NOT NULL DEFAULT 'new'::text,
  successful_deliveries integer NOT NULL DEFAULT 0,
  upfront_payout_percentage integer NOT NULL DEFAULT 0 CHECK (upfront_payout_percentage >= 0 AND upfront_payout_percentage <= 100),
  float_exposure_limit integer NOT NULL DEFAULT 0,
  float_balance integer NOT NULL DEFAULT 0,
  active_exposure integer NOT NULL DEFAULT 0,
  owner_id uuid,
  payout_bank_name text,
  payout_account_name text,
  CONSTRAINT shops_pkey PRIMARY KEY (id),
  CONSTRAINT shops_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.users(id),
  CONSTRAINT shops_payout_trust_tier_fkey FOREIGN KEY (payout_trust_tier) REFERENCES public.payout_trust_tiers(tier),
  CONSTRAINT shops_verification_reviewed_by_fkey FOREIGN KEY (verification_reviewed_by) REFERENCES public.users(id)
);

CREATE TABLE public.categories (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  image_url text,
  is_featured boolean DEFAULT false,
  ui_order_index integer DEFAULT 0,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()),
  CONSTRAINT categories_pkey PRIMARY KEY (id)
);

CREATE TABLE public.items (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL,
  name text NOT NULL,
  description text,
  price_zmw integer NOT NULL CHECK (price_zmw > 0),
  currency text DEFAULT 'ZMW'::text,
  image_url text,
  is_available boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  is_weekly_pick boolean DEFAULT false,
  promo_badge_text text,
  category_id uuid,
  item_type text NOT NULL DEFAULT 'product'::text CHECK (item_type = ANY (ARRAY['product'::text, 'service'::text])),
  display_expires_at timestamp with time zone,
  validity_days integer,
  requires_scheduling boolean NOT NULL DEFAULT false,
  lead_time_days integer CHECK (lead_time_days IS NULL OR lead_time_days >= 0),
  fulfillment_location text CHECK (fulfillment_location IS NULL OR (fulfillment_location = ANY (ARRAY['in_store'::text, 'at_customer'::text, 'remote'::text]))),
  allow_custom_quote boolean NOT NULL DEFAULT false,
  has_expiry boolean NOT NULL DEFAULT true,
  valid_for_days integer CHECK (valid_for_days IS NULL OR valid_for_days > 0),
  is_discounted boolean NOT NULL DEFAULT false,
  original_price_zmw integer,
  is_wholesale boolean NOT NULL DEFAULT false,
  wholesale_price_zmw integer,
  minimum_order_quantity integer NOT NULL DEFAULT 1 CHECK (minimum_order_quantity >= 1),
  is_quote_only boolean NOT NULL DEFAULT false,
  CONSTRAINT items_pkey PRIMARY KEY (id),
  CONSTRAINT items_shop_id_fkey FOREIGN KEY (shop_id) REFERENCES public.shops(id),
  CONSTRAINT items_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.categories(id)
);

CREATE TABLE public.transactions (
  transaction_id uuid NOT NULL DEFAULT gen_random_uuid(),
  buyer_id uuid NOT NULL,
  gateway_tx_ref text UNIQUE,
  total_amount integer NOT NULL CHECK (total_amount >= 0),
  currency text NOT NULL DEFAULT 'ZMW'::text,
  status text NOT NULL DEFAULT 'GATEWAY_PROCESSING'::text,
  created_at timestamp with time zone DEFAULT now(),
  origin_type text DEFAULT 'LOCAL'::text,
  sender_phone text,
  platform_fee integer NOT NULL DEFAULT 0,
  items_subtotal integer,
  CONSTRAINT transactions_pkey PRIMARY KEY (transaction_id),
  CONSTRAINT transactions_sender_id_fkey FOREIGN KEY (buyer_id) REFERENCES public.users(id)
);

CREATE TABLE public.experiences (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (btrim(name) <> ''::text),
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'::text),
  tagline text,
  description text,
  image_url text,
  is_active boolean NOT NULL DEFAULT false,
  is_featured boolean NOT NULL DEFAULT false,
  expires_at timestamp with time zone,
  sort_order integer NOT NULL DEFAULT 0,
  created_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT experiences_pkey PRIMARY KEY (id),
  CONSTRAINT experiences_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id)
);

CREATE TABLE public.shop_orders (
  shop_order_id uuid NOT NULL DEFAULT gen_random_uuid(),
  transaction_id uuid NOT NULL,
  shop_id uuid NOT NULL,
  claim_code character varying NOT NULL UNIQUE,
  recipient_name text NOT NULL,
  recipient_phone text NOT NULL,
  claim_status text NOT NULL DEFAULT 'PENDING'::text CHECK (claim_status = ANY (ARRAY['PENDING_PAYMENT'::text, 'PENDING'::text, 'PROCESSING_FULFILLMENT'::text, 'PARTIAL_FULFILLMENT'::text, 'FULFILLED'::text, 'REDEEMED'::text, 'CANCELLED'::text, 'EXPIRED'::text])),
  payout_status text NOT NULL DEFAULT 'UNFUNDED'::text CHECK (payout_status = ANY (ARRAY['UNFUNDED'::text, 'PENDING_BATCH'::text, 'SETTLED'::text])),
  settlement_target_time timestamp with time zone,
  created_at timestamp with time zone DEFAULT now(),
  message text,
  fulfilled_at timestamp with time zone,
  subtotal integer NOT NULL DEFAULT 0,
  settled boolean DEFAULT false,
  checkout_intent text NOT NULL DEFAULT 'self'::text CHECK (checkout_intent = ANY (ARRAY['self'::text, 'friends'::text, 'donate'::text])),
  upfront_paid integer NOT NULL DEFAULT 0,
  target_execution_date timestamp with time zone,
  disputed_at timestamp with time zone,
  experience_id uuid,
  expires_at timestamp with time zone,
  CONSTRAINT shop_orders_pkey PRIMARY KEY (shop_order_id),
  CONSTRAINT shop_orders_transaction_id_fkey FOREIGN KEY (transaction_id) REFERENCES public.transactions(transaction_id),
  CONSTRAINT shop_orders_shop_id_fkey FOREIGN KEY (shop_id) REFERENCES public.shops(id),
  CONSTRAINT shop_orders_experience_id_fkey FOREIGN KEY (experience_id) REFERENCES public.experiences(id)
);

CREATE TABLE public.order_items (
  order_item_id uuid NOT NULL DEFAULT gen_random_uuid(),
  shop_order_id uuid NOT NULL,
  item_id uuid NOT NULL,
  allocated_price integer NOT NULL CHECK (allocated_price >= 0),
  fulfillment_status text NOT NULL DEFAULT 'PENDING'::text CHECK (fulfillment_status = ANY (ARRAY['PENDING'::text, 'COLLECTED'::text, 'MISSING'::text, 'FLOATING'::text, 'CONVERTED'::text, 'EXPIRED'::text])),
  created_at timestamp with time zone DEFAULT now(),
  fulfilled_at timestamp with time zone,
  child_claim_code character varying UNIQUE,
  CONSTRAINT order_items_pkey PRIMARY KEY (order_item_id),
  CONSTRAINT order_items_shop_order_id_fkey FOREIGN KEY (shop_order_id) REFERENCES public.shop_orders(shop_order_id),
  CONSTRAINT order_items_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.items(id)
);

CREATE TABLE public.kithly_wallets (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  balance integer NOT NULL DEFAULT 0 CHECK (balance >= 0),
  currency text NOT NULL DEFAULT 'ZMW'::text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT kithly_wallets_pkey PRIMARY KEY (id),
  CONSTRAINT kithly_wallets_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id)
);

CREATE TABLE public.transaction_events (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  shop_order_id uuid,
  event_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone DEFAULT now(),
  transaction_id uuid,
  CONSTRAINT transaction_events_pkey PRIMARY KEY (id),
  CONSTRAINT transaction_events_shop_order_id_fkey FOREIGN KEY (shop_order_id) REFERENCES public.shop_orders(shop_order_id)
);

CREATE TABLE public.marketing_campaigns (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  title text NOT NULL,
  image_url text NOT NULL,
  target_route text NOT NULL,
  is_active boolean DEFAULT true,
  sort_order integer DEFAULT 0,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()),
  CONSTRAINT marketing_campaigns_pkey PRIMARY KEY (id)
);

CREATE TABLE public.merchant_shops (
  user_id uuid NOT NULL,
  shop_id uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT merchant_shops_pkey PRIMARY KEY (user_id, shop_id),
  CONSTRAINT merchant_shops_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id),
  CONSTRAINT merchant_shops_shop_id_fkey FOREIGN KEY (shop_id) REFERENCES public.shops(id)
);

CREATE TABLE public.payout_ledger (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  shop_order_id uuid,
  shop_id uuid NOT NULL,
  credit_amount integer NOT NULL DEFAULT 0 CHECK (credit_amount >= 0),
  ledger_type text NOT NULL DEFAULT 'FULFILLMENT_CREDIT'::text,
  reference text,
  amount integer,
  commission integer,
  status text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT payout_ledger_pkey PRIMARY KEY (id),
  CONSTRAINT payout_ledger_shop_id_fkey FOREIGN KEY (shop_id) REFERENCES public.shops(id)
);

CREATE TABLE public.payment_webhook_idempotency (
  idempotency_key text NOT NULL,
  transaction_id uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT payment_webhook_idempotency_pkey PRIMARY KEY (idempotency_key)
);

CREATE TABLE public.claim_status_feed (
  claim_code text NOT NULL,
  claim_status text NOT NULL,
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT claim_status_feed_pkey PRIMARY KEY (claim_code)
);

CREATE TABLE public.wallet_ledger (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  wallet_id uuid NOT NULL,
  amount integer NOT NULL,
  transaction_id uuid,
  description text,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT wallet_ledger_pkey PRIMARY KEY (id),
  CONSTRAINT wallet_ledger_wallet_id_fkey FOREIGN KEY (wallet_id) REFERENCES public.kithly_wallets(id),
  CONSTRAINT wallet_ledger_transaction_id_fkey FOREIGN KEY (transaction_id) REFERENCES public.transactions(transaction_id)
);

CREATE TABLE public.social_posts (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL,
  media_url text NOT NULL,
  caption text,
  is_active boolean DEFAULT true,
  item_ids ARRAY NOT NULL DEFAULT '{}'::uuid[],
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT social_posts_pkey PRIMARY KEY (id),
  CONSTRAINT social_posts_shop_id_fkey FOREIGN KEY (shop_id) REFERENCES public.shops(id)
);

CREATE TABLE public.bundles (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  image_url text,
  bundle_metadata jsonb NOT NULL DEFAULT '[]'::jsonb,
  total_price_zmw integer NOT NULL CHECK (total_price_zmw > 0),
  is_active boolean DEFAULT true,
  created_by uuid,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT bundles_pkey PRIMARY KEY (id),
  CONSTRAINT bundles_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id)
);

CREATE TABLE public.platform_settings (
  id integer NOT NULL DEFAULT 1 CHECK (id = 1),
  current_usd_zmw_rate numeric NOT NULL DEFAULT 26.00,
  dispute_window_minutes integer NOT NULL DEFAULT 1440 CHECK (dispute_window_minutes >= 0),
  merchant_fee_percent numeric NOT NULL DEFAULT 2.00 CHECK (merchant_fee_percent >= 0::numeric AND merchant_fee_percent < 100::numeric),
  local_buyer_fee_percent numeric NOT NULL DEFAULT 8.00,
  international_buyer_fee_percent numeric NOT NULL DEFAULT 10.00,
  voucher_grace_days integer NOT NULL DEFAULT 60,
  expiry_sender_refund_percent integer NOT NULL DEFAULT 80,
  expiry_reminder_days integer NOT NULL DEFAULT 7,
  CONSTRAINT platform_settings_pkey PRIMARY KEY (id)
);

CREATE TABLE public.notifications (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid,
  message text NOT NULL,
  type text NOT NULL,
  is_read boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  reference_id text,
  CONSTRAINT notifications_pkey PRIMARY KEY (id),
  CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id)
);

CREATE TABLE public.merchant_float_ledger (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL,
  shop_order_id uuid,
  amount integer NOT NULL,
  entry_type text NOT NULL CHECK (entry_type = ANY (ARRAY['UPFRONT_ADVANCE'::text, 'ADVANCE_CLEARED'::text, 'ADVANCE_REVERSED'::text])),
  description text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT merchant_float_ledger_pkey PRIMARY KEY (id),
  CONSTRAINT merchant_float_ledger_shop_id_fkey FOREIGN KEY (shop_id) REFERENCES public.shops(id),
  CONSTRAINT merchant_float_ledger_shop_order_id_fkey FOREIGN KEY (shop_order_id) REFERENCES public.shop_orders(shop_order_id)
);

CREATE TABLE public.conversations (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind = ANY (ARRAY['buyer_merchant'::text, 'admin_buyer'::text, 'admin_shop'::text])),
  buyer_id uuid,
  shop_id uuid,
  item_id uuid,
  shop_order_id uuid,
  subject text,
  is_closed boolean NOT NULL DEFAULT false,
  last_message_at timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT conversations_pkey PRIMARY KEY (id),
  CONSTRAINT conversations_buyer_id_fkey FOREIGN KEY (buyer_id) REFERENCES public.users(id),
  CONSTRAINT conversations_shop_id_fkey FOREIGN KEY (shop_id) REFERENCES public.shops(id),
  CONSTRAINT conversations_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.items(id),
  CONSTRAINT conversations_shop_order_id_fkey FOREIGN KEY (shop_order_id) REFERENCES public.shop_orders(shop_order_id)
);

CREATE TABLE public.quotations (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL,
  shop_id uuid NOT NULL,
  buyer_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending'::text CHECK (status = ANY (ARRAY['pending'::text, 'accepted'::text, 'declined'::text, 'withdrawn'::text, 'expired'::text])),
  total_amount integer NOT NULL CHECK (total_amount > 0),
  notes text,
  valid_until timestamp with time zone,
  target_execution_date timestamp with time zone,
  fulfillment_item_id uuid,
  created_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  decided_at timestamp with time zone,
  decline_reason text,
  CONSTRAINT quotations_pkey PRIMARY KEY (id),
  CONSTRAINT quotations_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id),
  CONSTRAINT quotations_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id),
  CONSTRAINT quotations_shop_id_fkey FOREIGN KEY (shop_id) REFERENCES public.shops(id),
  CONSTRAINT quotations_buyer_id_fkey FOREIGN KEY (buyer_id) REFERENCES public.users(id),
  CONSTRAINT quotations_fulfillment_item_id_fkey FOREIGN KEY (fulfillment_item_id) REFERENCES public.items(id)
);

CREATE TABLE public.quotation_line_items (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  quotation_id uuid NOT NULL,
  description text NOT NULL,
  quantity integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price_zmw integer NOT NULL CHECK (unit_price_zmw >= 0),
  sort_order integer NOT NULL DEFAULT 0,
  CONSTRAINT quotation_line_items_pkey PRIMARY KEY (id),
  CONSTRAINT quotation_line_items_quotation_id_fkey FOREIGN KEY (quotation_id) REFERENCES public.quotations(id)
);

CREATE TABLE public.messages (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL,
  sender_id uuid,
  sender_role text NOT NULL CHECK (sender_role = ANY (ARRAY['buyer'::text, 'merchant'::text, 'admin'::text, 'system'::text])),
  message_type text NOT NULL DEFAULT 'text'::text CHECK (message_type = ANY (ARRAY['text'::text, 'image'::text, 'quotation'::text, 'system'::text])),
  body text,
  image_url text,
  quotation_id uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT messages_pkey PRIMARY KEY (id),
  CONSTRAINT messages_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id),
  CONSTRAINT messages_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES public.users(id),
  CONSTRAINT messages_quotation_id_fkey FOREIGN KEY (quotation_id) REFERENCES public.quotations(id)
);

CREATE TABLE public.conversation_reads (
  conversation_id uuid NOT NULL,
  user_id uuid NOT NULL,
  last_read_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT conversation_reads_pkey PRIMARY KEY (conversation_id, user_id),
  CONSTRAINT conversation_reads_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id),
  CONSTRAINT conversation_reads_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id)
);

CREATE TABLE public.experience_items (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  experience_id uuid NOT NULL,
  item_id uuid NOT NULL,
  quantity integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
  note text,
  sort_order integer NOT NULL DEFAULT 0,
  CONSTRAINT experience_items_pkey PRIMARY KEY (id),
  CONSTRAINT experience_items_experience_id_fkey FOREIGN KEY (experience_id) REFERENCES public.experiences(id),
  CONSTRAINT experience_items_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.items(id)
);

CREATE TABLE public.merchant_withdrawals (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL,
  ledger_id uuid,
  amount integer NOT NULL CHECK (amount > 0),
  status text NOT NULL DEFAULT 'pending'::text CHECK (status = ANY (ARRAY['pending'::text, 'processing'::text, 'paid'::text, 'failed'::text])),
  requested_by uuid,
  provider text NOT NULL DEFAULT 'flutterwave'::text,
  provider_reference text,
  provider_transfer_id text,
  failure_reason text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  processed_at timestamp with time zone,
  CONSTRAINT merchant_withdrawals_pkey PRIMARY KEY (id),
  CONSTRAINT merchant_withdrawals_shop_id_fkey FOREIGN KEY (shop_id) REFERENCES public.shops(id),
  CONSTRAINT merchant_withdrawals_ledger_id_fkey FOREIGN KEY (ledger_id) REFERENCES public.payout_ledger(id),
  CONSTRAINT merchant_withdrawals_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES public.users(id)
);

CREATE TABLE public.payout_bank_codes (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  method_key text NOT NULL UNIQUE,
  display_name text NOT NULL,
  category text NOT NULL CHECK (category = ANY (ARRAY['mobile_money'::text, 'bank'::text])),
  flutterwave_code text,
  is_verified boolean NOT NULL DEFAULT false,
  notes text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT payout_bank_codes_pkey PRIMARY KEY (id)
);
