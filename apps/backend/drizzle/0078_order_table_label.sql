-- Laporan per Meja: which table a sale was served at, frozen on the order.
--
-- Nothing else remembers it. Occupancy is dining_tables.session_id, and the
-- host clearing a table sets that back to NULL — after which a paid bill can
-- still be traced to its seating (table_session_lines.order_id), but no longer
-- to a table. So the checkout stamps the label the floor called the seating by
-- ("5", or "5+6" for joined tables), the same text a kitchen ticket prints.
--
-- A label, not a table id: a table renamed or deleted from the layout next
-- month must not rewrite where last month's sales were eaten, and a joined
-- seating's bill belongs to "5+6" as a whole rather than being guessed onto
-- one of them. Labels are unique per outlet (the layout editor enforces it).
--
-- NULL on every counter sale — only a table bill has a table.
--
-- Written idempotently (IF NOT EXISTS / duplicate_object guards) so a re-run
-- after a journal `when` correction is harmless.

ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "table_label" varchar(40);
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "orders" ADD CONSTRAINT "orders_table_label_ck" CHECK (
    "table_label" IS NULL OR "source" = 'pos'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

-- Serves Laporan per Meja's window scan and its drill-down (`?key=5`). Partial
-- on table_label, so it holds only table bills and costs counter-only outlets
-- nothing.
CREATE INDEX IF NOT EXISTS "orders_report_table_idx"
  ON "orders" ("outlet_id", "table_label", "created_at")
  WHERE "deleted_at" IS NULL AND "table_label" IS NOT NULL;
--> statement-breakpoint

-- Best-effort backfill for bills settled before this existed: the tables the
-- seating still holds if it has not been cleared yet, else the label its last
-- kitchen ticket was sent under. A bill with neither stays NULL rather than
-- being filed under a guessed table.
UPDATE "orders" o SET "table_label" = src.label
  FROM (
    SELECT DISTINCT ON (l."order_id") l."order_id", coalesce(
      (SELECT string_agg(t."label", '+' ORDER BY length(t."label"), t."label")
         FROM "dining_tables" t WHERE t."session_id" = l."session_id"),
      (SELECT nullif(k."label", '')
         FROM "kitchen_tickets" k
        WHERE k."session_id" = l."session_id" AND k."source" = 'table'
        ORDER BY k."created_at" DESC LIMIT 1)
    ) AS label
    FROM "table_session_lines" l
    WHERE l."order_id" IS NOT NULL
  ) src
 WHERE o."id" = src."order_id"
   AND o."source" = 'pos'
   AND o."table_label" IS NULL
   AND src.label IS NOT NULL;
