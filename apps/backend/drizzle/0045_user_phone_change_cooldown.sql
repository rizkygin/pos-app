-- Tracks when a user last changed their phone number, for the one-change-per-
-- month limit on the account settings page.
--
-- Nullable with no backfill on purpose. NULL reads as "never changed", so every
-- existing user gets one free edit rather than being locked out for a month by a
-- migration they had no part in — and a customer who mistypes their WhatsApp at
-- signup can still fix it immediately.
--
-- Only a genuine change stamps this. Re-submitting the same number is a no-op
-- and must not start a cooldown.

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "phone_changed_at" timestamp with time zone;
