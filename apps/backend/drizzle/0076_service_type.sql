-- Dine In / Take Away: how a counter sale was served, recorded instead of
-- inferred. Until now the floor plan's "Take Away" count was every POS order
-- no table bill became — which also counted a pager customer eating in.
--
-- NULL means "not recorded", never "take away": every app order (their
-- `fulfillment` already says how they travel), every counter sale taken before
-- this existed, and anything rung up by a client that does not send one.
--
-- Written idempotently (IF NOT EXISTS / duplicate_object guards) so a re-run
-- after a journal `when` correction is harmless.

ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "service_type" varchar(10);
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "orders" ADD CONSTRAINT "orders_service_type_ck" CHECK (
    "service_type" IS NULL
    OR ("source" = 'pos' AND "service_type" IN ('dine_in', 'take_away'))
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

-- The kitchen learns it from the ticket, which is sent before anything is paid.
ALTER TABLE "kitchen_tickets" ADD COLUMN IF NOT EXISTS "service_type" varchar(10);
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "kitchen_tickets" ADD CONSTRAINT "kitchen_tickets_service_type_ck" CHECK (
    "service_type" IS NULL OR "service_type" IN ('dine_in', 'take_away')
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

-- Backfill only what is provable: a sale a table's bill became was eaten in.
-- A counter sale with no table stays NULL — it may well have been eaten in too.
UPDATE "orders" o SET "service_type" = 'dine_in'
 WHERE o."source" = 'pos'
   AND o."service_type" IS NULL
   AND EXISTS (SELECT 1 FROM "table_session_lines" l WHERE l."order_id" = o."id");
--> statement-breakpoint

UPDATE "kitchen_tickets" SET "service_type" = 'dine_in'
 WHERE "source" = 'table' AND "service_type" IS NULL;
