-- =============================================================================
-- The launch shelf: twelve bundles behind four tiles
--
-- WHAT THIS IS FOR
-- ----------------
-- The front door derives its tiles from what is curated, so with nothing
-- curated there are no tiles. This seeds the four named as the launch set --
-- school, groceries, medicine and gifting -- with three bundles each, because
-- OccasionTile cycles its photographs and two of anything reads as a glitch
-- rather than a rotation.
--
-- Run it in the SQL editor. It is not a migration: what it produces depends
-- entirely on the live catalogue, and a migration that reads whatever stock
-- happens to exist is a migration that does something different on every
-- database it touches.
--
-- HOW ITEMS ARE CHOSEN
-- --------------------
-- By category first and item name second. Category is the real signal --
-- `kithly_reco.kind_category` already encodes which shelves suit which
-- occasion -- and the keywords are there to catch the mis-filed, which in a
-- young catalogue is most of it. Category matches sort ahead of keyword
-- matches, so a correctly filed shop wins over a lucky substring.
--
-- Priciest first within a match, which is not greed: a 25kg bag of mealie meal
-- is what somebody means by "the monthly shop", and a 500g bag of salt matching
-- the same category should not become the picture of it.
--
-- WHAT IT WILL NOT DO
-- -------------------
--   * It never activates an empty bundle. A tile leading to a page with
--     nothing on it is worse than no tile, so is_active is set from the item
--     count and a bundle that matched nothing stays dark until stock exists.
--   * It never touches image_url. Re-running after you have added photographs
--     keeps them -- the copy is refreshed, the pictures are yours.
--   * It never includes quote-only or unavailable items.
--
-- AFTERWARDS: THE PHOTOGRAPHS
-- ---------------------------
-- Every bundle needs one, and the tile cycles the three belonging to it. They
-- have to be Zambian. A stock photograph of an American kitchen undoes the
-- entire premise of the tile it sits behind, and people can tell instantly.
-- The closing NOTICE lists every live bundle still missing one.
--
--   UPDATE public.experiences SET image_url = '<url>' WHERE slug = '<slug>';
--
-- The earlier placeholder set, if it is still around, is removed with:
--
--   DELETE FROM public.experiences WHERE slug LIKE 'placeholder-%';
-- =============================================================================

DO $$
DECLARE
  b        RECORD;
  v_id     uuid;
  v_items  int;
  v_ready  int := 0;
  v_dark   int := 0;
  v_names  text := '';
BEGIN
  FOR b IN
    SELECT * FROM (VALUES
      -- ---- Monthly Essentials -------------------------------------------
      ('monthly-basket', 'The Monthly Basket',
       'The staples for a month, from a shop they already use.',
       'groceries', 10,
       ARRAY['groceries','fresh-produce'],
       ARRAY['mealie','cooking oil','rice','sugar','beans','salt'], 6),

      ('small-household', 'Small Household',
       'The same shop, sized for one or two people rather than a family.',
       'groceries', 11,
       ARRAY['groceries'],
       ARRAY['mealie','oil','rice','kapenta','sugar'], 5),

      ('fridge-and-fresh', 'Fridge & Fresh',
       'Meat, eggs and vegetables, collected the day they are bought.',
       'groceries', 12,
       ARRAY['fresh-produce','meat-poultry','dairy-eggs','frozen-foods'],
       ARRAY['chicken','egg','milk','tomato','onion','cabbage'], 6),

      -- ---- School & Term Prep -------------------------------------------
      ('term-one-starter', 'Term Starter',
       'Books, pens and a bag, sorted before the first morning.',
       'school_fees', 20,
       ARRAY['school-supplies'],
       ARRAY['exercise book','pen','pencil','maths set','ruler'], 6),

      ('uniform-and-shoes', 'Uniform & Shoes',
       'The part of term prep that never fits from last year.',
       'school_fees', 21,
       ARRAY['childrenswear','shoes'],
       ARRAY['uniform','shirt','shoe','sock','jersey'], 5),

      ('boarding-trunk', 'Boarding Trunk',
       'Bedding, washing soap and a padlock. The list the school sends.',
       'school_fees', 22,
       ARRAY['bags-luggage','cleaning-supplies','home-decor'],
       ARRAY['trunk','blanket','sheet','soap','padlock','bucket'], 6),

      -- ---- Health & Care ------------------------------------------------
      ('chronic-care-refill', 'Chronic Care Refill',
       'The monthly consumables for blood pressure and diabetes.',
       'medical', 30,
       ARRAY['medical-supplies','pharmacy'],
       ARRAY['monitor','glucose','test strip','blood pressure','lancet'], 5),

      ('home-medicine-cabinet', 'Home Medicine Cabinet',
       'What a house should have before somebody needs it at night.',
       'medical', 31,
       ARRAY['pharmacy','vitamins-supplements'],
       ARRAY['paracetamol','antiseptic','plaster','thermometer','bandage'], 6),

      ('elder-care-monthly', 'Elder Care Monthly',
       'The consumables nobody wants to ask a neighbour to buy.',
       'medical', 32,
       ARRAY['personal-care','mobility-aids'],
       ARRAY['adult nappies','wipes','barrier cream','walking'], 5),

      -- ---- Celebrations -------------------------------------------------
      ('birthday-parcel', 'Birthday Parcel',
       'A cake, something to drink, and enough to share.',
       'birthday', 40,
       ARRAY['bakery-cakes','beverages','snacks-confectionery'],
       ARRAY['cake','juice','chocolate','crisps'], 5),

      ('graduation-gift', 'Graduation Gift',
       'Years of school fees behind it. Send something that reads that way.',
       'graduation', 41,
       ARRAY['bags-luggage','watches','menswear','womenswear'],
       ARRAY['bag','watch','shirt','shoe'], 4),

      ('new-baby-box', 'New Baby Box',
       'What a new mother runs out of first, from a shop close to her.',
       'new_baby', 42,
       ARRAY['baby-clothing','nappies-wipes','baby-food'],
       ARRAY['baby','nappies','wipes','blanket'], 5)
    ) AS t(slug, name, tagline, kind, sort_order, cats, keywords, target)
  LOOP
    INSERT INTO public.experiences (slug, name, tagline, occasion_kind, sort_order, is_active)
    VALUES (b.slug, b.name, b.tagline, b.kind, b.sort_order, false)
    ON CONFLICT (slug) DO UPDATE
      SET name          = EXCLUDED.name,
          tagline       = EXCLUDED.tagline,
          occasion_kind = EXCLUDED.occasion_kind,
          sort_order    = EXCLUDED.sort_order,
          updated_at    = now()
    RETURNING id INTO v_id;

    -- Rebuilt rather than merged, so a bundle reflects today's catalogue
    -- instead of accumulating everything that ever matched it.
    DELETE FROM public.experience_items WHERE experience_id = v_id;

    INSERT INTO public.experience_items (experience_id, item_id, quantity, sort_order)
    SELECT v_id, s.id, 1, s.rn
    FROM (
      SELECT i.id,
             row_number() OVER (
               ORDER BY COALESCE(c.slug = ANY(b.cats), false) DESC, i.price_zmw DESC
             ) AS rn
      FROM public.items i
      LEFT JOIN public.categories c ON c.id = i.category_id
      WHERE i.is_available = true
        AND i.is_quote_only = false
        AND (
          COALESCE(c.slug = ANY(b.cats), false)
          OR i.name ILIKE ANY (ARRAY(SELECT '%' || k || '%' FROM unnest(b.keywords) AS k))
        )
      ORDER BY COALESCE(c.slug = ANY(b.cats), false) DESC, i.price_zmw DESC
      LIMIT b.target
    ) s;

    GET DIAGNOSTICS v_items = ROW_COUNT;

    -- The only thing that decides whether a tile may lead here.
    UPDATE public.experiences
       SET is_active = (v_items > 0), updated_at = now()
     WHERE id = v_id;

    IF v_items > 0 THEN
      v_ready := v_ready + 1;
      RAISE NOTICE '  % -> % items, live', rpad(b.slug, 24), v_items;
    ELSE
      v_dark := v_dark + 1;
      RAISE NOTICE '  % -> nothing matched, left dark', rpad(b.slug, 24);
    END IF;
  END LOOP;

  SELECT string_agg(slug, ', ' ORDER BY sort_order) INTO v_names
  FROM public.experiences
  WHERE occasion_kind IS NOT NULL AND is_active = true AND image_url IS NULL;

  RAISE NOTICE '';
  RAISE NOTICE '% live, % dark.', v_ready, v_dark;
  IF v_names IS NOT NULL THEN
    RAISE NOTICE 'Still need a photograph: %', v_names;
  ELSE
    RAISE NOTICE 'Every live bundle has a photograph.';
  END IF;
END $$;
