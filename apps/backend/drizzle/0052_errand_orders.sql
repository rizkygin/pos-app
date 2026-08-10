CREATE TYPE "public"."errand_status" AS ENUM('pending', 'on_delivery', 'delivered', 'rejected_by_courier', 'cancelled_by_customer');--> statement-breakpoint
CREATE TABLE "errand_orders" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"courier_id" integer NOT NULL,
	"status" "errand_status" DEFAULT 'pending' NOT NULL,
	"note" text,
	"price" varchar(15),
	"rejected_reason" varchar(255),
	"pickup_address" varchar(255),
	"pickup_lat" numeric(10, 7),
	"pickup_lon" numeric(10, 7),
	"accepted_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"updated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "ratings" ALTER COLUMN "order_details_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "phone" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "ratings" ADD COLUMN "errand_order_id" text;--> statement-breakpoint
ALTER TABLE "errand_orders" ADD CONSTRAINT "errand_orders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "errand_orders" ADD CONSTRAINT "errand_orders_courier_id_couriers_id_fk" FOREIGN KEY ("courier_id") REFERENCES "public"."couriers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "errand_orders_courier_pending_uq" ON "errand_orders" USING btree ("courier_id") WHERE status = 'pending';--> statement-breakpoint
CREATE INDEX "errand_orders_user_status_idx" ON "errand_orders" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "errand_orders_courier_status_idx" ON "errand_orders" USING btree ("courier_id","status");--> statement-breakpoint
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_errand_order_id_errand_orders_id_fk" FOREIGN KEY ("errand_order_id") REFERENCES "public"."errand_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ratings_errand_order_id_idx" ON "ratings" USING btree ("errand_order_id");--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- users.phone cleanup. Hand-written, and it MUST stay above the UNIQUE
-- constraint that follows — drizzle-kit generates the constraint alone, which
-- aborts on any real dataset.
--
-- Three problems in dependency order: the column's old DEFAULT was a shared
-- literal, numbers were stored in whatever shape people typed, and uniqueness
-- means nothing until both are fixed.
-- ---------------------------------------------------------------------------

-- 1. Canonicalise to 628… — same rule as normalizeIndonesianPhone() in
--    lib/utils/phone.ts. Until this runs '08123…' and '628123…' are one human
--    that UNIQUE happily accepts as two.
--    Anything that cannot be normalised (garbage, landlines, foreign numbers)
--    is left exactly as it was: this migration fixes formatting, it does not
--    get to decide a number is invalid and destroy it.
UPDATE "users"
SET "phone" = '62' || substring(regexp_replace("phone", '\D', '', 'g') from '^(?:62|0)?(8.*)$')
WHERE "phone" IS NOT NULL
  AND substring(regexp_replace("phone", '\D', '', 'g') from '^(?:62|0)?(8.*)$') IS NOT NULL
  AND length(substring(regexp_replace("phone", '\D', '', 'g') from '^(?:62|0)?(8.*)$')) BETWEEN 10 AND 13;--> statement-breakpoint

-- 2. Drop the placeholder. Every account that never set a number carries the
--    old column DEFAULT, so this is not an edge case — it is potentially most
--    of the table, and all of it collides. NULL is the honest value, and
--    unlimited NULLs are allowed under UNIQUE.
UPDATE "users"
SET "phone" = NULL, "phone_changed_at" = NULL
WHERE "phone" IN ('082222222222', '6282222222222');--> statement-breakpoint

-- 3. Genuine collisions: two real accounts on one number. The oldest row keeps
--    it, the rest are cleared — rather than the migration aborting halfway
--    through a deploy with no way forward.
--
--    phone_changed_at is cleared alongside, and that is the part that matters:
--    the settings page allows one change per month and reads NULL as "never
--    changed, first edit free". A stale timestamp would lock someone out of
--    re-entering the very number this migration just took from them.
UPDATE "users" u
SET "phone" = NULL, "phone_changed_at" = NULL
WHERE u."phone" IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM "users" older
    WHERE older."phone" = u."phone"
      AND (older."created_at", older."id") < (u."created_at", u."id")
  );--> statement-breakpoint

ALTER TABLE "users" ADD CONSTRAINT "users_phone_unique" UNIQUE("phone");--> statement-breakpoint
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_one_target_chk" CHECK (("ratings"."order_details_id" IS NOT NULL AND "ratings"."errand_order_id" IS NULL)
        OR ("ratings"."order_details_id" IS NULL AND "ratings"."errand_order_id" IS NOT NULL));