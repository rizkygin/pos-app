-- Kitchen Display: the order a ticket's dishes were paid in, so the kitchen
-- screen can show the receipt's order number beside "#N". NULL until checkout
-- (a ticket is sent before anything is paid), and for tickets from before this.
--
-- ON DELETE SET NULL: a ticket is a screen label, and must never be what
-- blocks removing an order.
--
-- Written idempotently (IF NOT EXISTS / duplicate_object guards) so a re-run
-- after a journal `when` correction is harmless.

ALTER TABLE "kitchen_tickets" ADD COLUMN IF NOT EXISTS "order_id" text;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "kitchen_tickets" ADD CONSTRAINT "kitchen_tickets_order_id_orders_id_fk"
    FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
