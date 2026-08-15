CREATE TYPE "public"."order_source" AS ENUM('app', 'pos');--> statement-breakpoint
ALTER TABLE "cashFlows" ADD COLUMN "order_id" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "source" "order_source" DEFAULT 'app' NOT NULL;--> statement-breakpoint
ALTER TABLE "cashFlows" ADD CONSTRAINT "cashFlows_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cash_flows_order_id_idx" ON "cashFlows" USING btree ("order_id");--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- Backfill orders.source for everything that already exists.
--
-- The only record of which orders came from the cashier is the one the new
-- column is meant to replace: they were attached to the hardcoded offline
-- customer (routes/mutations.ts, EMAIL = 'rizkygin1@gmail.com'). So we use that
-- test one last time, here, and nothing written after this migration depends on
-- it — /api/add-order-detail stamps source='pos' explicitly from now on.
--
-- The email is spelled out rather than imported because a migration is a
-- historical record: it must keep meaning what it meant on the day it ran, even
-- after the constant in the code is changed or deleted.
--
-- Orders that the `|| 1` fallback misattributed to customer id 1 are NOT
-- covered — there is nothing in the data that distinguishes them from a genuine
-- order by that customer, and guessing would mark real customer orders as POS
-- and expose them to cashier cancellation. They stay 'app' and stay
-- undeletable, which is the safe direction to be wrong in.
-- ---------------------------------------------------------------------------
UPDATE "orders" o
SET "source" = 'pos'
WHERE EXISTS (
  SELECT 1
  FROM "customers" c
  JOIN "users" u ON u."id" = c."user_id"
  WHERE c."id" = o."customer_id"
    AND u."email" = 'rizkygin1@gmail.com'
);