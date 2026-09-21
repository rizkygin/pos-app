-- Billing for the extra staff seats granted by 0080's max_employees_override.
--
-- The override hands a merchant seats; this is what they PAY for them. It is
-- deliberately NOT a negative marketing deal: a seat costs a fixed rupiah
-- amount, while discount_pct is a percentage of the plan price, so one seat
-- would be a different "deal %" on every tier, would have to be recomputed
-- whenever a plan is repriced, and — because a deal carries a tier/interval
-- scope — would silently stop being charged the moment the merchant upgraded.
--
-- Stored as seats x a PER-MONTH unit price rather than one lump sum so the same
-- admin setting prices both intervals: a yearly plan bills 12 months of it
-- (see employeeAddonFor in lib/subscription.ts). The marketing deal never
-- touches it — a discount is on the plan, a seat is a pass-through charge — so
-- the quote is (plan price - deal) + add-on + unique code.
ALTER TABLE "subscriptions"
  ADD COLUMN IF NOT EXISTS "addon_employee_seats" integer DEFAULT 0 NOT NULL,
  ADD COLUMN IF NOT EXISTS "addon_seat_price" numeric(14, 2) DEFAULT '0' NOT NULL,
  ADD COLUMN IF NOT EXISTS "addon_note" varchar(255) DEFAULT '' NOT NULL;

-- Snapshot on the payment, exactly like discount_pct: a later price change must
-- not rewrite what an old kwitansi says was charged. amount stays the base plan
-- price; addon_amount is the whole add-on line for THIS payment (seats x unit
-- price x months), already folded into amount_due.
ALTER TABLE "subscription_payments"
  ADD COLUMN IF NOT EXISTS "addon_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
  ADD COLUMN IF NOT EXISTS "addon_seats" integer DEFAULT 0 NOT NULL;
