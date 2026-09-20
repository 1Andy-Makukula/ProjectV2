-- =============================================================================
-- Art and ordering for the Welcome mosaic
--
-- `categories` has carried image_url and ui_order_index since it was created
-- and nothing has ever written either one. The seed set is_featured on
-- twenty-five rows, which Admin > Merchandising describes as choosing what
-- "display[s] in the storefront matrix" -- but with no art and no order, the
-- matrix could only ever have been a wall of identical name blocks sorted
-- alphabetically, which is how you get Bakery, Barbering, Birthday Parties
-- and Cake Design as the first four things a new customer sees.
--
-- This gives nine categories a photograph and an explicit position. They are
-- the nine the platform actually has art for, chosen by what is in the
-- picture rather than by what the file was named: two of the supplied images
-- were dropped outright, one carrying a visible iStock watermark and one
-- being an advert for another company.
--
-- ui_order_index sorts nulls last, so these nine lead the mosaic and the
-- other sixteen featured categories keep their flag and fall in behind them.
-- Nothing is unfeatured here and nothing is deleted.
--
-- image_url is a root-relative path into the app's own public/ directory, not
-- a storage URL. These are platform furniture shipped with the build -- the
-- same decision public/vectors made -- where a shop's cover or an item's
-- photograph is user content and belongs in storage. An admin who later
-- uploads a real one simply overwrites this value and nothing here has to
-- change.
--
-- Idempotent: it matches on slug, sets three columns, and re-running it sets
-- them to the same values. A slug that does not exist updates nothing rather
-- than failing.
-- =============================================================================

UPDATE public.categories AS c
SET
  image_url      = v.image_url,
  ui_order_index = v.ui_order_index,
  is_featured    = true
FROM (VALUES
  -- A paper bag of shopping on a kitchen counter. The single most literal
  -- picture of what this product does, so it leads.
  ('groceries',             '/categories/groceries.jpg',       1),
  -- People eating together in a restaurant.
  ('catering',              '/categories/catering.jpg',        2),
  -- A rack of knitwear and coats.
  ('womenswear',            '/categories/womenswear.jpg',      3),
  -- A furnished sitting room.
  ('furniture',             '/categories/furniture.jpg',       4),
  -- A pharmacist with two customers at the shelves.
  ('pharmacy',              '/categories/pharmacy.jpg',        5),
  -- Fridge, washing machine, television, laptop.
  ('home-appliances',       '/categories/home-appliances.jpg', 6),
  -- Hand tools laid out on a workbench.
  ('tools-hardware',        '/categories/tools-hardware.jpg',  7),
  -- A row of industrial washing machines.
  ('laundry-dry-cleaning',  '/categories/laundry.jpg',         8),
  -- A braai platter.
  ('meat-poultry',          '/categories/meat-poultry.jpg',    9)
) AS v(slug, image_url, ui_order_index)
WHERE c.slug = v.slug;
