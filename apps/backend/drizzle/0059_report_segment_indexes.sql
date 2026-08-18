-- Segmented sales reports (routes/reports.ts) group orders by free text that
-- lives inside orders.note: paymentMethod, cashierName, customerName.
--
-- Two different jobs here:
--
--  * orders_report_window_idx serves the scan every one of the four reports
--    starts with — "this outlet, this date window, this source". That is the
--    bulk of the work, and the 3-month range cap in the API exists so this scan
--    stays bounded.
--  * the three expression indexes serve the drill-down (`?key=budi`), which is
--    an equality test on the grouping expression. Their expressions must match
--    dimensionSql() in routes/reports.ts CHARACTER FOR CHARACTER — coalesce and
--    nullif included. A near-miss is not a slower index, it is no index.
--
-- All are partial on deleted_at IS NULL: a soft-deleted (cancelled) cashier
-- order is never part of a report, so it should not be part of the index.
-- json_object_field_text, coalesce, nullif and lower are all immutable, so
-- these expressions are indexable as written.

CREATE INDEX IF NOT EXISTS "orders_report_window_idx"
  ON "orders" ("outlet_id", "created_at", "source")
  WHERE "deleted_at" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "orders_report_payment_idx"
  ON "orders" ("outlet_id", (coalesce(nullif("note" ->> 'paymentMethod', ''), 'cash')), "created_at")
  WHERE "deleted_at" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "orders_report_cashier_idx"
  ON "orders" ("outlet_id", (lower(coalesce(nullif("note" ->> 'cashierName', ''), '-'))), "created_at")
  WHERE "deleted_at" IS NULL;
--> statement-breakpoint
-- No customer index on purpose. That report spans BOTH sources and falls back
-- to users.name for app orders, so its grouping key is not an expression over
-- `orders` alone and no index on this table can serve it. It rides the window
-- index above plus two primary-key joins instead.
--> statement-breakpoint
-- The rating filter walks ratings -> orderDetails; without this it is a scan of
-- ratings per order in the window.
CREATE INDEX IF NOT EXISTS "ratings_order_details_id_idx"
  ON "ratings" ("order_details_id");
--> statement-breakpoint
-- The menu-group filter's EXISTS resolves products by group.
CREATE INDEX IF NOT EXISTS "products_menu_group_idx"
  ON "products" ("menu_group_id");
