-- outlets.features stops being an owner-maintained checklist and becomes derived
-- from the outlet's own products (see src/lib/outlet-features.ts).
--
-- The hand-ticked array drifted from reality in both directions: outlets kept
-- advertising a category long after they stopped selling it, so customers tapped
-- into an empty outlet; and outlets sold products in categories they had never
-- ticked, so those products never appeared in browse at all.
--
-- This backfill brings every existing outlet in line with the same rule the
-- application now applies on every product create/update/delete: a feature is
-- present when the outlet has at least one product in that feature's category
-- that is for sale and not soft-deleted. `is_available` is deliberately NOT
-- considered — it means "sold out right now", and letting it drop a feature
-- would make outlets flicker in and out of the marketplace through the day.
--
-- Data-only and idempotent: re-running recomputes the same values.

WITH m(category, slug) AS (VALUES
  ('makanan', 'food'),
  ('minuman', 'drink'),
  ('jasa', 'service'),
  ('mart', 'mart'),
  ('antar', 'delivery'),
  ('kecantikan', 'beauty'),
  ('sewa kendaraan', 'ride'),
  ('hiburan', 'entertainment'),
  ('bahan bangunan', 'building-materials')
)
UPDATE outlets o
SET features = COALESCE(
  ARRAY(
    SELECT DISTINCT m.slug
    FROM products p
    JOIN m ON m.category = p.category
    WHERE p.outlet_id = o.id
      AND p.is_for_sale
      AND p.deleted_at IS NULL
    ORDER BY m.slug
  ),
  '{}'
);
