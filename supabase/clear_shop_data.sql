-- =============================================================================
-- KithLy V2 - Data Reset & Shop Clearance Script
-- Description: Clears all shop, product, transaction, order, and conversation data
--              so that shops and listings can be re-registered properly.
-- Preserved:   User accounts (roles reset to 'sender'), Categories,
--              Platform Settings, Bank Codes, and Trust Tiers.
-- =============================================================================

BEGIN;

-- 1. Truncate dependent order & transaction child tables
TRUNCATE TABLE public.order_items CASCADE;
TRUNCATE TABLE public.transaction_events CASCADE;
TRUNCATE TABLE public.claim_status_feed CASCADE;
TRUNCATE TABLE public.payment_webhook_idempotency CASCADE;
TRUNCATE TABLE public.wallet_ledger CASCADE;

-- 2. Truncate merchant financial & ledger tables
TRUNCATE TABLE public.merchant_withdrawals CASCADE;
TRUNCATE TABLE public.merchant_float_ledger CASCADE;
TRUNCATE TABLE public.payout_ledger CASCADE;

-- 3. Truncate communications, quotes & social posts
TRUNCATE TABLE public.quotation_line_items CASCADE;
TRUNCATE TABLE public.messages CASCADE;
TRUNCATE TABLE public.quotations CASCADE;
TRUNCATE TABLE public.conversation_reads CASCADE;
TRUNCATE TABLE public.conversations CASCADE;
TRUNCATE TABLE public.social_posts CASCADE;

-- 4. Truncate experience links & notifications
TRUNCATE TABLE public.experience_items CASCADE;
TRUNCATE TABLE public.notifications CASCADE;

-- 5. Truncate core transactional & commerce entities
TRUNCATE TABLE public.shop_orders CASCADE;
TRUNCATE TABLE public.transactions CASCADE;
TRUNCATE TABLE public.merchant_shops CASCADE;
TRUNCATE TABLE public.items CASCADE;
TRUNCATE TABLE public.shops CASCADE;

-- 6. Reset merchant roles back to 'sender' so users can re-register shops from scratch
UPDATE public.users 
SET role = 'sender' 
WHERE role = 'merchant';

-- 7. Reset user wallet balances to 0
UPDATE public.kithly_wallets 
SET balance = 0, updated_at = now();

COMMIT;

-- Verification summary
SELECT 'Shops count' AS table_name, count(*) AS count FROM public.shops
UNION ALL
SELECT 'Items count', count(*) FROM public.items
UNION ALL
SELECT 'Transactions count', count(*) FROM public.transactions
UNION ALL
SELECT 'Shop orders count', count(*) FROM public.shop_orders
UNION ALL
SELECT 'Users count (preserved)', count(*) FROM public.users
UNION ALL
SELECT 'Categories count (preserved)', count(*) FROM public.categories;
