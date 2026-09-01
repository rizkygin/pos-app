-- Backfill what the cost ledger (0063) can know for certain about movements
-- written before it existed. Two recoveries, both EXACT — nothing here is an
-- estimate, and nothing here invents a price.
--
-- What is deliberately NOT backfilled: the cost of historical SALES. Valuing
-- them would mean applying today's avg_cost to a sale that happened weeks ago,
-- and then freezing that guess forever. Where a product has no cost on record
-- yet (blank buying_price is a routine state — see lib/money-sql.ts) that
-- freezes a zero, which is strictly worse than the live buying_price fallback
-- in lib/cogs.ts: the fallback at least starts telling the truth the day a real
-- price is entered, while a frozen zero never does. Historical sales therefore
-- keep reporting through the fallback, by design.

-- ── 1. Recover order_id on POS movements ────────────────────────────────────
-- Before 0062 there was no order_id column, but applySaleStockOut already wrote
-- the order into the note ("POS <id>", and "Batal POS <id>" for its reversal),
-- so the link is real data that was only ever stored in the wrong place. With it
-- back, an old POS order cancels by ledger replay like any new one.
--
-- The id is taken up to the first space or the " · " separator that precedes the
-- recipe trail, which covers both the server's UUIDs and the client-generated
-- ids the desktop cashier sends. The EXISTS guard keeps a note that mentions a
-- since-deleted order from violating the foreign key.
UPDATE "stock_movements" sm
   SET "order_id" = substring(sm."note" from 'POS ([^ ·]+)')
 WHERE sm."order_id" IS NULL
   AND sm."note" ~ 'POS [^ ·]+'
   AND EXISTS (
     SELECT 1 FROM "orders" o WHERE o."id" = substring(sm."note" from 'POS ([^ ·]+)')
   );
--> statement-breakpoint

-- ── 2. Price historical PURCHASES from their own invoice lines ──────────────
-- A purchase movement carries invoice_id, and the invoice line holds what was
-- actually paid. line_total (not unit_price) because it already has the line
-- discount applied — the landed cost, which is what postMovement books today.
--
-- Summed per (invoice, product) so an invoice that lists the same product on
-- two lines resolves to one weighted price instead of matching ambiguously.
WITH landed AS (
  SELECT ii."invoice_id",
         ii."product_id",
         sum(ii."line_total") / nullif(sum(ii."quantity"), 0) AS unit_cost
    FROM "invoice_items" ii
   WHERE ii."product_id" IS NOT NULL
   GROUP BY 1, 2
  HAVING sum(ii."quantity") > 0
)
UPDATE "stock_movements" sm
   SET "unit_cost"   = round(landed.unit_cost, 4),
       "cost_change" = round(sm."qty_change" * landed.unit_cost, 2)
  FROM landed
 WHERE sm."reason" = 'purchase'
   AND sm."cost_change" IS NULL
   AND sm."invoice_id" = landed."invoice_id"
   AND sm."product_id" = landed."product_id";
--> statement-breakpoint

-- ── 3. And their reversals ──────────────────────────────────────────────────
-- A void of a purchase is exactly as knowable as the purchase itself: same
-- invoice, same product, opposite sign. Restricted to purchase invoices —
-- a voided SALE has no recorded cost to mirror, so it stays null with the sale
-- it reverses, and the pair keeps reporting through the fallback together.
WITH landed AS (
  SELECT ii."invoice_id",
         ii."product_id",
         sum(ii."line_total") / nullif(sum(ii."quantity"), 0) AS unit_cost
    FROM "invoice_items" ii
   WHERE ii."product_id" IS NOT NULL
   GROUP BY 1, 2
  HAVING sum(ii."quantity") > 0
)
UPDATE "stock_movements" sm
   SET "unit_cost"   = round(landed.unit_cost, 4),
       "cost_change" = round(sm."qty_change" * landed.unit_cost, 2)
  FROM landed
  JOIN "invoices" inv ON inv."id" = landed."invoice_id"
 WHERE sm."reason" = 'void'
   AND sm."cost_change" IS NULL
   AND sm."invoice_id" = landed."invoice_id"
   AND sm."product_id" = landed."product_id"
   AND inv."type" = 'purchase';
