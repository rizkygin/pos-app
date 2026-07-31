  -- The "bisa diantar kurir?" question is now asked only for the two categories
-- that can plausibly contain something a courier can't carry: mart and bahan
-- bangunan. Everywhere else the answer is always yes, and the toggle is gone
-- from the product form.
--
-- Until now the toggle appeared for every for-sale non-jasa product, so an owner
-- could have set `false` on a makanan or minuman item. Left alone, such a row
-- would keep pushing its orders down the no-courier flow with nothing in the UI
-- to explain why — the toggle that set it no longer renders for that category.
--
-- Data-only and idempotent: re-running is a no-op once the rows are normalised.

UPDATE products
SET courier_deliverable = true
WHERE courier_deliverable = false
  AND category NOT IN ('mart', 'bahan bangunan');
