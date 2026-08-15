-- An errand has no outlet to collect from: these columns snapshot the
-- customer's own location, which is where the courier rides TO. The pickup_*
-- naming was wrong from the start (migration 0052).
ALTER TABLE "errand_orders" RENAME COLUMN "pickup_address" TO "destination_address";--> statement-breakpoint
ALTER TABLE "errand_orders" RENAME COLUMN "pickup_lat" TO "destination_lat";--> statement-breakpoint
ALTER TABLE "errand_orders" RENAME COLUMN "pickup_lon" TO "destination_lon";
