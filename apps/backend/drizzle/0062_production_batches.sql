-- Multi-level recipes, part 2 of 2: columns.
--
-- 1. products.yield_qty — how many stock units ONE production batch makes
--    ("satu kali masak sambal jadi 2.5 kg"). This is a convenience default for
--    the production form ONLY. recipe_items.qty keeps its existing meaning
--    everywhere: consumed per ONE output unit, never per batch. That uniformity
--    is what lets lib/stock.ts expand a recipe without caring whether the thing
--    it is expanding is a menu item or an in-house batch.
--
-- 2. stock_movements.order_id — the POS order that caused a movement, mirroring
--    the invoice_id column next to it. With it, cancelling a cashier order can
--    reverse the LEDGER (read back what actually left, flip the sign) instead of
--    re-expanding the recipe as it stands today. That matters much more once
--    recipes nest: an edit three levels down would otherwise silently change how
--    much a cancellation puts back.
--
--    Nullable and unbackfilled by design. Movements written before this
--    migration have no order_id, so the cancellation path must keep the
--    re-expansion fallback for them (see applySaleStockReturn).

ALTER TABLE "products"
  ADD COLUMN IF NOT EXISTS "yield_qty" numeric(12, 3) DEFAULT '1' NOT NULL;
--> statement-breakpoint
ALTER TABLE "stock_movements"
  ADD COLUMN IF NOT EXISTS "order_id" text;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "stock_movements"
    ADD CONSTRAINT "stock_movements_order_id_orders_id_fk"
    FOREIGN KEY ("order_id") REFERENCES "orders"("id")
    ON DELETE no action ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
-- Serves the cancellation replay: "the sales movements of THIS order".
CREATE INDEX IF NOT EXISTS "stock_movements_order_idx"
  ON "stock_movements" ("order_id");
