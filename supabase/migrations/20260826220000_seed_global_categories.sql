-- =============================================================================
-- A working category taxonomy
--
-- The categories table has been empty since it was created, so every item on
-- the platform is uncategorised and the category-filtered surfaces render
-- nothing. The path to create them was never broken -- Admin > Merchandising
-- has full CRUD -- there was simply nothing in it.
--
-- This seeds a broad starting taxonomy covering goods and services. It is
-- deliberately generic rather than Zambia-specific: a merchant selling
-- something unanticipated should find a reasonable home for it, and anything
-- genuinely missing is one click away through the picker's add button.
--
-- Slugs are derived rather than typed, so a name and its slug cannot disagree.
-- ON CONFLICT on slug makes this idempotent: re-running adds nothing, and a
-- category an admin has since renamed or featured is left exactly as it is.
-- =============================================================================

INSERT INTO public.categories (name, slug, is_featured)
SELECT
  name,
  trim(both '-' from regexp_replace(lower(name), '[^a-z0-9]+', '-', 'g')) AS slug,
  featured
FROM (VALUES
  -- Food and drink
  ('Bakery & Cakes', true), ('Groceries', true), ('Fresh Produce', false),
  ('Meat & Poultry', false), ('Fish & Seafood', false), ('Dairy & Eggs', false),
  ('Beverages', false), ('Coffee & Tea', false), ('Snacks & Confectionery', false),
  ('Spices & Condiments', false), ('Frozen Foods', false), ('Health Foods', false),
  ('Catering', true), ('Meal Prep & Delivery', false),

  -- Fashion
  ('Womenswear', true), ('Menswear', false), ('Childrenswear', false),
  ('Shoes', false), ('Bags & Luggage', false), ('Jewellery', false),
  ('Watches', false), ('Traditional Attire', true), ('Sportswear', false),
  ('Fabric & Textiles', false), ('Fashion Accessories', false),
  ('Tailoring & Alterations', true),

  -- Beauty and grooming
  ('Hair Salon', true), ('Barbering', true), ('Hair Care Products', false),
  ('Skin Care', false), ('Cosmetics', false), ('Fragrances', false),
  ('Nail Care', false), ('Spa & Massage', true), ('Makeup Artistry', false),
  ('Braiding & Extensions', false),

  -- Electronics
  ('Mobile Phones', true), ('Computers & Laptops', false), ('Phone Accessories', false),
  ('Audio & Headphones', false), ('Televisions', false), ('Cameras', false),
  ('Gaming', false), ('Home Appliances', false), ('Kitchen Appliances', false),
  ('Solar & Power', true), ('Electronics Repair', false),

  -- Home and living
  ('Furniture', true), ('Bedding & Linen', false), ('Kitchenware', false),
  ('Home Decor', false), ('Cleaning Supplies', false), ('Storage & Organisation', false),
  ('Lighting', false), ('Curtains & Blinds', false), ('Rugs & Carpets', false),
  ('Tools & Hardware', false), ('Paint & Building Supplies', false),
  ('Garden & Outdoor', false),

  -- Baby and children
  ('Baby Clothing', false), ('Nappies & Wipes', false), ('Baby Food', false),
  ('Toys & Games', true), ('School Supplies', false), ('Prams & Car Seats', false),
  ('Nursery Furniture', false), ('Childcare', false),

  -- Health
  ('Pharmacy', true), ('Vitamins & Supplements', false), ('Medical Supplies', false),
  ('Fitness Equipment', false), ('Optical', false), ('Mobility Aids', false),
  ('Personal Care', false),

  -- Events
  ('Event Planning', true), ('Birthday Parties', true), ('Weddings', true),
  ('Corporate Events', false), ('Decor & Styling', true), ('Photography', true),
  ('Videography', false), ('DJ & Live Music', false), ('Venue Hire', false),
  ('Marquee & Tent Hire', false), ('Event Furniture Hire', false),
  ('Event Staffing', false), ('Funeral Services', false), ('Cake Design', true),
  ('Balloon & Backdrop', false),

  -- Home services
  ('Cleaning Services', true), ('Laundry & Dry Cleaning', false), ('Plumbing', false),
  ('Electrical Services', false), ('Carpentry', false), ('Painting & Decorating', false),
  ('Pest Control', false), ('Gardening & Landscaping', false),
  ('Moving & Removals', false), ('Security Services', false), ('Appliance Repair', false),

  -- Professional services
  ('Tutoring', true), ('Translation', false), ('Accounting', false),
  ('Legal Services', false), ('IT Support', false), ('Web Design', false),
  ('Graphic Design', false), ('Printing & Signage', false), ('Marketing', false),
  ('Business Consulting', false), ('Recruitment', false),

  -- Personal services
  ('Fitness Training', false), ('Nutrition Coaching', false), ('Driving Lessons', false),
  ('Music Lessons', false), ('Elder Care', false), ('Shoe Repair', false),

  -- Automotive
  ('Car Parts', false), ('Tyres', false), ('Car Servicing', false),
  ('Car Wash', false), ('Motorcycles & Parts', false), ('Vehicle Hire', false),

  -- Everything else
  ('Pet Supplies', false), ('Pet Grooming', false), ('Veterinary', false),
  ('Books & Stationery', false), ('Art & Craft', false), ('Musical Instruments', false),
  ('Sports & Outdoor', false), ('Travel & Tours', false), ('Gift Hampers', true),
  ('Flowers', true), ('Religious Items', false), ('Agriculture & Farming', false),
  ('Livestock & Poultry', false), ('Seeds & Fertiliser', false),
  ('Courier & Delivery', false), ('Airtime & Mobile Money', false),
  ('Wholesale & Bulk', true)
) AS seed(name, featured)
ON CONFLICT (slug) DO NOTHING;

DO $$
DECLARE
  v_total INT;
  v_featured INT;
BEGIN
  SELECT count(*), count(*) FILTER (WHERE is_featured) INTO v_total, v_featured
  FROM public.categories;

  IF v_total < 100 THEN
    RAISE EXCEPTION 'Expected at least 100 categories after seeding, found %', v_total;
  END IF;

  -- Slug and name must never disagree, since the slug is what URLs are built
  -- from and the name is what people read.
  IF EXISTS (
    SELECT 1 FROM public.categories
    WHERE slug <> trim(both '-' from regexp_replace(lower(name), '[^a-z0-9]+', '-', 'g'))
  ) THEN
    RAISE WARNING 'some categories have a slug that no longer matches their name (renamed by hand?)';
  END IF;

  RAISE NOTICE 'categories seeded: % total, % featured', v_total, v_featured;
END $$;
