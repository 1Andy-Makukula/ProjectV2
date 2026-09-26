-- =============================================================================
-- Filing the existing bundles under their occasions
--
-- WHY
-- ---
-- On 26 Sep the Send Home door was repointed at the catalogue -- /catalogue,
-- with a shelf per occasion at /catalogue/:kind underneath it. A check of the
-- data before doing so found five active experiences and not one of them
-- filed under an occasion. Every shelf would have opened on "nothing put
-- together for this yet", which is worse than the storefront the door used to
-- lead to.
--
-- They map almost one-to-one onto the taxonomy, so they are filed here.
-- Care Package Home is the exception: by Andy's call it belongs to the
-- catalogue as a whole rather than to any one shelf, so it stays unfiled
-- (occasion_kind NULL is documented as exactly that state) and is featured,
-- which is what puts it on the hub.
--
-- Content, not schema. Done as a migration rather than by hand so the state is
-- reproducible and reviewable, and idempotent -- matched on slug, so re-running
-- sets the same values and an admin's later edits to anything else survive.
--
-- The admin experiences editor gains an occasion picker and a featured toggle
-- in the same change, so everything after this is filed through the UI rather
-- than through SQL.
--
-- BLAST RADIUS: Local. Two presentation columns on five rows. `occasion_kind`
-- is a foreign key to occasion_lead_times(kind); every value below exists
-- there.
-- =============================================================================

UPDATE public.experiences AS e
SET occasion_kind = v.kind
FROM (VALUES
  ('the-birthday-package', 'birthday'),
  ('new-home-starter',     'rent'),      -- the Home shelf; see types/occasions.ts
  ('wedding-season',       'wedding'),
  ('stock-up-month',       'groceries')  -- Monthly Essentials
) AS v(slug, kind)
WHERE e.slug = v.slug;

UPDATE public.experiences
SET is_featured = true
WHERE slug = 'care-package-home';
