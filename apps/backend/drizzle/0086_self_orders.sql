-- Pesan Mandiri: customers order from their own phone on the outlet's menu
-- page and pay at the cashier. See selfOrdersTable in db/schema.ts.
--
-- A self order is NOT an order: it becomes one only when the cashier accepts
-- it into a till tab (or onto a table's bill) and checks it out through the
-- normal add-order-detail. So nothing here touches orders, and nothing is
-- backfilled.
--
-- Written idempotently so a re-run after a journal `when` correction is
-- harmless.

ALTER TABLE "outlets" ADD COLUMN IF NOT EXISTS "self_order_enabled" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "outlets" ADD COLUMN IF NOT EXISTS "self_order_radius_m" integer DEFAULT 150 NOT NULL;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "self_orders" (
  "id" text PRIMARY KEY NOT NULL,
  "outlet_id" integer NOT NULL REFERENCES "outlets"("id"),
  "queue_no" integer NOT NULL,
  "status" varchar(12) DEFAULT 'pending' NOT NULL,
  "customer_name" varchar(60) NOT NULL,
  "note" varchar(200),
  "service_type" varchar(10),
  "table_id" integer REFERENCES "dining_tables"("id"),
  "table_label" varchar(20),
  "lines" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "subtotal" numeric(14, 2) NOT NULL,
  "lat" numeric(10, 7),
  "lon" numeric(10, 7),
  "accuracy_m" integer,
  "distance_m" integer,
  "accepted_at" timestamp with time zone,
  "accepted_by" text REFERENCES "users"("id"),
  "session_id" text REFERENCES "table_sessions"("id"),
  "rejected_at" timestamp with time zone,
  "reject_reason" varchar(120),
  "cancelled_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone,
  CONSTRAINT "self_orders_status_ck" CHECK ("status" in ('pending', 'accepted', 'rejected', 'cancelled')),
  CONSTRAINT "self_orders_service_type_ck" CHECK ("service_type" is null or "service_type" in ('dine_in', 'take_away'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "self_orders_outlet_created_idx" ON "self_orders" ("outlet_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "self_orders_pending_idx" ON "self_orders" ("outlet_id") WHERE status = 'pending';
