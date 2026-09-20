-- =============================================================================
-- Fixing the order the mosaic reads categories in, and adding art to more
--
-- WHAT WAS WRONG
-- --------------
-- 20260919000000 set ui_order_index 1..9 on the nine categories it gave art
-- to, and its comment claimed "ui_order_index sorts nulls last, so these nine
-- lead the mosaic". That was false. The column is not null on existing rows --
-- it is ZERO. So the nine curated categories sorted AFTER the sixteen that had
-- never been touched, and the front door rendered the nine alphabetically
-- first instead: bakery-cakes, barbering, birthday-parties, cake-design,
-- cleaning-services, decor-styling, event-planning, flowers, gift-hampers.
--
-- None of them had an image_url, so every tile in the browse mosaic drew the
-- ink-block fallback. The page looked like nine black rectangles. Nothing
-- errored; the ordering was simply wrong and the fallback did its job.
--
-- WHAT THIS DOES
-- --------------
-- 1. Pushes every featured category to 100, clearing the zeros.
-- 2. Sets 1..14 on the categories that now have art, in the order the mosaic
--    should show them. The first nine are shaped to the spans they will land
--    in -- wide, narrow, narrow, wide, band, wide, narrow, narrow, wide --
--    because each image is cropped at source to its slot. Reordering these
--    without re-cropping will put a 3.48:1 band image in a 1.25 square.
-- 3. Four images replace low-resolution scaffolding ones: pharmacy,
--    home-appliances, meat-poultry and furniture were 2.2x to 3.3x short of
--    the pixels their slot needs and would have been visibly soft.
--
-- The frontend also sorts categories that HAVE art ahead of those that do
-- not, so this ordering is belt and braces rather than the only thing
-- standing between the page and a black tile. See Welcome.tsx.
--
-- BLAST RADIUS: 🟢 Local. Presentation columns on `categories`. No RLS, no
-- money path, nothing reads ui_order_index except the mosaic.
-- =============================================================================

-- 1. Clear the zeros, so a curated index of 1 actually means "first".
UPDATE public.categories
SET ui_order_index = 100
WHERE is_featured = true
  AND COALESCE(ui_order_index, 0) < 100;

-- 2. The curated order, with art cropped to each slot's shape.
UPDATE public.categories AS c
SET image_url      = v.image_url,
    ui_order_index = v.ui_order_index,
    is_featured    = true
FROM (VALUES
  -- the nine the mosaic shows, shaped to their spans
  ('groceries',            '/categories/groceries.jpg',        1),   -- wide
  ('catering',             '/categories/catering.jpg',         2),   -- narrow
  ('bakery-cakes',         '/categories/bakery-cakes.webp',    3),   -- narrow
  ('pharmacy',             '/categories/pharmacy.webp',        4),   -- wide
  ('home-appliances',      '/categories/home-appliances.webp', 5),   -- band
  ('furniture',            '/categories/furniture.webp',       6),   -- wide
  ('womenswear',           '/categories/womenswear.jpg',       7),   -- narrow
  ('flowers',              '/categories/flowers.webp',         8),   -- narrow
  ('meat-poultry',         '/categories/meat-poultry.webp',    9),   -- wide
  -- art in hand, behind the fold
  ('tools-hardware',       '/categories/tools-hardware.jpg',  10),
  ('laundry-dry-cleaning', '/categories/laundry.jpg',         11),
  ('barbering',            '/categories/barbering.webp',      12),
  ('gift-hampers',         '/categories/gift-hampers.webp',   13),
  ('decor-styling',        '/categories/event-decor.webp',    14)
) AS v(slug, image_url, ui_order_index)
WHERE c.slug = v.slug;
