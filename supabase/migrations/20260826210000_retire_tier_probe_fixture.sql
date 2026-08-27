-- =============================================================================
-- Take the tiered-pricing probe shop out of the storefront
--
-- 20260809170000 verifies that price_basket_zmw and checkout_init_atomic agree
-- on a basket that crosses a price tier. To do that it builds a real shop, a
-- real item with a quantity break, and runs a real checkout.
--
-- It could not clean up after itself: the checkout writes transaction_events,
-- which are append-only, so the transaction and the shop_order hanging off that
-- shop cannot be deleted. The shop was therefore left behind -- is_active true,
-- visible in the storefront, indistinguishable to a shopper from a real
-- merchant.
--
-- That is a fixture leaking into production, and it recurs: the probe runs on
-- every replay of the chain, so a fresh deploy would create another one.
--
-- Deactivating rather than deleting, because deleting is not available. The
-- rows stay for referential integrity and the audit trail; they simply stop
-- being merchandise.
--
-- The real lesson is that a verification block which creates permanent data is
-- the wrong shape. A probe should assert against a transaction it rolls back,
-- or against fixtures it can remove. Where neither is possible -- as here,
-- because the thing being verified IS the write path -- it must at least retire
-- what it made.
-- =============================================================================

DO $$
DECLARE
  v_shops INT := 0;
  v_items INT := 0;
BEGIN
  UPDATE public.items
  SET is_available = false
  WHERE shop_id IN (SELECT id FROM public.shops WHERE name = 'Tier Probe')
    AND is_available IS DISTINCT FROM false;
  GET DIAGNOSTICS v_items = ROW_COUNT;

  UPDATE public.shops
  SET is_active = false
  WHERE name = 'Tier Probe'
    AND is_active IS DISTINCT FROM false;
  GET DIAGNOSTICS v_shops = ROW_COUNT;

  IF v_shops = 0 AND v_items = 0 THEN
    RAISE NOTICE 'no Tier Probe fixture to retire';
  ELSE
    RAISE NOTICE 'retired % probe shop(s) and % probe item(s) from the storefront', v_shops, v_items;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.shops WHERE name = 'Tier Probe' AND is_active) THEN
    RAISE EXCEPTION 'a Tier Probe shop is still active in the storefront';
  END IF;
  RAISE NOTICE 'verified: no probe fixture is publicly visible';
END $$;
