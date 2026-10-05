-- Two-factor login (better-auth twoFactor plugin), required for platform
-- admins: lib/admin-access.ts refuses an admin whose users.two_factor_enabled
-- is false. Merchants are untouched — the column defaults to false and nothing
-- asks them to enrol.
--
-- Written idempotently so a re-run after a journal `when` correction is
-- harmless.

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "two_factor_enabled" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "two_factor" (
  "id" text PRIMARY KEY NOT NULL,
  "secret" text NOT NULL,
  "backup_codes" text NOT NULL,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "verified" boolean DEFAULT true,
  "failed_verification_count" integer DEFAULT 0,
  "locked_until" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "two_factor_user_id_idx" ON "two_factor" USING btree ("user_id");
