-- Record WHICH ORDER LINE each sale movement came from.
--
-- 0062 gave a movement its order, which is what makes a cashier cancellation a
-- ledger replay instead of a recipe re-expansion. It does not say which ITEM in
-- that order moved the goods, and for a composition it cannot be inferred: the
-- movements are written against the recipe's INGREDIENTS, so the product on the
-- row is not the product that was sold. Three kilos of beras left the shelf;
-- nothing on the row says it was the Nasi Goreng line that took them.
--
-- Because of that, lib/cogs.ts had to decide which lines the ledger covered by
-- re-reading products.track_stock and recipe_items AS THEY STAND TODAY. That
-- describes a sale that happened months ago using configuration the owner can
-- change tomorrow, and when they do, the answer silently changes with it:
--
--   * a product sold while track_stock = true, later flipped to false with no
--     recipe, is counted TWICE — once from the movement still in the ledger,
--     once from the fallback that now matches the line;
--   * flipped the other way, the line matches neither half and its cost
--     DISAPPEARS (in a mixed order — a single-kind order falls back wholesale);
--   * the same two, in both directions, for adding or deleting a recipe.
--
-- Every one of them rewrites a month that was already closed, and none of them
-- is visible to anyone reading the report.
--
-- With the line on the movement, the question stops being "what kind of product
-- is this?" and becomes "what did this line actually do?" — which is history,
-- and cannot be edited after the fact. A line with tagged movements is costed
-- from them; a line with none never moved anything and is costed from the price
-- frozen on it by 0065. products.track_stock and recipe_items are not read at
-- all. It also settles the case the old predicate got silently wrong in the
-- other direction: a composition whose recipe expands to no stock-tracking
-- ingredient moves nothing, yet HAS recipe rows, so the guess excluded it from
-- the fallback and it cost zero. It now falls back like anything else that
-- moved nothing.
--
-- NOT BACKFILLED, and it cannot be. For a track_stock line you could match a
-- movement on (order_id, product_id), but that is already ambiguous when one
-- order lists the same product on two lines — and for a composition there is
-- nothing to match on at all, which is the entire reason this column exists.
-- Guessing here would manufacture exactly the kind of retroactive fiction the
-- column was added to prevent. Orders written before this migration keep the
-- pre-0066 expression in lib/cogs.ts, selected by whether the order has any
-- tagged movement, so old and new never mix and no data has to move.

ALTER TABLE "stock_movements"
  ADD COLUMN IF NOT EXISTS "order_detail_id" integer;
--> statement-breakpoint

-- NOT VALID skips the full-table scan that validating against existing rows
-- would take: every row present is NULL, so there is nothing for it to find.
-- New rows are checked from the moment it is added.
DO $$
BEGIN
  ALTER TABLE "stock_movements"
    ADD CONSTRAINT "stock_movements_order_detail_id_fk"
    FOREIGN KEY ("order_detail_id") REFERENCES "orderDetails"("id") NOT VALID;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

-- Serves the per-line cost lookup, which runs once per line of every order on a
-- report page. Partial: only tagged rows are ever looked up this way, and they
-- are a small and slow-growing minority of the table for a long while.
CREATE INDEX IF NOT EXISTS "stock_movements_order_detail_idx"
  ON "stock_movements" ("order_detail_id")
  WHERE "order_detail_id" IS NOT NULL;
