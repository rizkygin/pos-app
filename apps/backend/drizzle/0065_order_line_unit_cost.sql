-- Freeze the per-line cost of the sales the cost ledger cannot see.
--
-- 0063 gave every stock MOVEMENT a money side, which covers any line that moved
-- something: a product that tracks its own stock, or a composition whose recipe
-- draws down its ingredients. It does not cover the third kind of line, and
-- never will — a track_stock=false product with NO recipe moves nothing, ever
-- (a service, a fee, an item nobody counts). That is a valid permanent state,
-- not a gap to be filled by making it move.
--
-- So lib/cogs.ts costs those lines from products.buying_price, joined LIVE at
-- report time. Same three problems 0063 listed, still unfixed for this one kind
-- of line:
--
--   * editing a purchase price today rewrites the profit on every sale ever
--     made through it;
--   * flipping a product's track_stock changes the cost of orders that closed
--     months ago — in one direction it double counts them (a historical
--     movement in the ledger PLUS a fallback that now matches), in the other it
--     drops them entirely;
--   * a closed month is never actually closed.
--
-- A snapshot on the LINE fixes all three, and belongs here rather than in
-- stock_movements: that table is the stock ledger, and these lines move no
-- stock. Putting a money-only row in it would make every future reader that
-- replays the ledger to rebuild on-hand quantities have to know to skip them.
--
-- Written on every line from here on (lib/cogs.ts lineUnitCostSql, called by
-- routes/mutations.ts for POS and routes/orders.ts for app orders), but only
-- ever READ for the lines the ledger cannot see. Summing it across all lines
-- would double count everything the ledger already covers.

ALTER TABLE "orderDetails"
  ADD COLUMN IF NOT EXISTS "unit_cost" numeric(14, 4);
--> statement-breakpoint

-- ── Backfill ────────────────────────────────────────────────────────────────
-- The only cost figure that exists for a historical line is the product's
-- buying_price AS IT STANDS TODAY. This does not recover what the line cost
-- when it was sold — that number was never recorded. What it does is stop the
-- drift: from here on an old order reports the same COGS no matter what anyone
-- types into the product form.
--
-- Deliberately NOT stamped where there is no price on record — blank (this is a
-- varchar with no CHECK, and the product form posts '' when the field is left
-- empty, see lib/money-sql.ts) or zero. This is the same call 0064 made when it
-- refused to value historical sales: a frozen zero is worse than the live
-- fallback, because the fallback starts telling the truth the day a real price
-- is entered and a frozen zero never does. Those lines stay NULL and keep
-- reporting through the fallback.
--
-- Not scoped to the ledger-invisible lines, and not scoped by order status.
-- Cheaper to stamp every line than to evaluate "would cogs.ts read this one?"
-- against product config that can change afterwards — which is the very bug
-- being fixed. Cancelled and soft-deleted orders are excluded by the readers,
-- not by this.
--
-- The regex is money()'s, so a value stamped here and a value read live are
-- accepted or rejected by exactly the same rule.
UPDATE "orderDetails" od
   SET "unit_cost" = p."buying_price"::numeric
  FROM "products" p
 WHERE p."id" = od."product_id"
   AND od."unit_cost" IS NULL
   AND p."buying_price" ~ '^\s*-?[0-9]+(\.[0-9]+)?\s*$'
   AND p."buying_price"::numeric > 0;
