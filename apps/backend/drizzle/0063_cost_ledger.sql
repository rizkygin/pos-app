-- Cost ledger: give every stock movement a money side.
--
-- Until now the only cost figure in the system was products.buying_price, joined
-- LIVE at report time (routes/reports.ts lineAgg, routes/owner.ts kpiSelect).
-- Three things were wrong with that, and recipes made all three worse:
--
--   * A composition's buying_price is whatever was typed in the form. Nothing
--     derived it from the ingredients, so a dish whose beras and telur really
--     cost 8.000 booked whatever sat in that field — usually 0, i.e. the whole
--     sale as profit.
--   * A produced intermediate (sambal, adonan) has no purchase price at all. It
--     was never bought, it was MADE. It would sit in Stok valued at zero.
--   * The join being live meant editing a price today silently rewrote the
--     profit on every sale ever made.
--
-- Why these columns live on stock_movements rather than in a cost_movements
-- table of their own: every cost event IS a stock event. There is no movement of
-- value here that is not also a movement of goods, so a second table would be a
-- row-for-row copy of this one — two ledgers to keep in step, and eventually two
-- ledgers that disagree. The money is a column on the movement, not a parallel
-- book. It also means the ledger inherits outlet_id, invoice_id, order_id,
-- reason, created_at and every index already built on them.
--
--   unit_cost   what ONE unit was worth for THIS movement. Stock coming IN
--               carries the price it came in at; stock going OUT carries the
--               weighted-average cost at that moment.
--   cost_change signed money, qty_change * unit_cost. Positive = value in,
--               negative = value out. COGS for a period is simply
--               -sum(cost_change) over reason='sales', and voids net themselves
--               out because their rows carry the opposite sign.
--
-- products.avg_cost is the running weighted-average unit cost — a cached balance
-- derived from this ledger, exactly as products.stock is. Seeded from
-- buying_price because that is the best cost estimate that exists today.
--
-- All three are nullable/defaulted: movements written before this migration have
-- no cost side, and reports fall back to the old live join for any order whose
-- movements predate it (or that never moved stock at all — app orders don't).

ALTER TABLE "products"
  ADD COLUMN IF NOT EXISTS "avg_cost" numeric(14, 4) DEFAULT '0' NOT NULL;
--> statement-breakpoint
ALTER TABLE "stock_movements"
  ADD COLUMN IF NOT EXISTS "unit_cost" numeric(14, 4);
--> statement-breakpoint
ALTER TABLE "stock_movements"
  ADD COLUMN IF NOT EXISTS "cost_change" numeric(14, 2);
--> statement-breakpoint
-- Seed the running average from the only cost figure that exists. Blank strings
-- are common in this varchar column, hence the nullif/regex guard rather than a
-- bare cast — see the money() helper in routes/owner.ts, which exists for the
-- same reason.
UPDATE "products"
   SET "avg_cost" = CASE
     WHEN "buying_price" ~ '^[0-9]+(\.[0-9]+)?$' THEN "buying_price"::numeric
     ELSE 0
   END
 WHERE "avg_cost" = 0;
--> statement-breakpoint
-- COGS rollups scan by outlet + reason + time, which the existing
-- stock_movements_outlet_reason_created_idx already serves. This one serves the
-- per-order drill-down the reports do (cost of THIS order).
CREATE INDEX IF NOT EXISTS "stock_movements_order_reason_idx"
  ON "stock_movements" ("order_id", "reason");
