-- Courier live position, for the customer's delivery ETA.
--
-- Overwritten in place rather than appended: this answers "where is my courier
-- right now", not "where has this courier been". No history means no growing
-- table and nothing to purge, and it keeps the privacy surface to a single
-- current point that is cleared when the delivery ends.
--
-- numeric, not varchar. outlets.lat/lon and locations.lat/lon are varchar, and
-- that is precisely how empty strings and the literal text 'NaN' ended up in
-- coordinate columns (see 0041_derive_outlet_features and the repair before it).
-- Postgres rejects both for numeric, so the class of bug cannot recur here.
--
-- All three are nullable: a courier who has never delivered, or who is off
-- shift, legitimately has no position.

ALTER TABLE "couriers" ADD COLUMN IF NOT EXISTS "last_lat" numeric(10, 7);
--> statement-breakpoint
ALTER TABLE "couriers" ADD COLUMN IF NOT EXISTS "last_lon" numeric(10, 7);
--> statement-breakpoint
ALTER TABLE "couriers" ADD COLUMN IF NOT EXISTS "last_location_at" timestamp with time zone;
