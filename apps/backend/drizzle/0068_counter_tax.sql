-- Counter tax (PB1 / PPN) for the cashier.
--
-- Tax sits OUTSIDE the line. orderDetails.summary_price is not touched by this
-- migration and must not be touched later: it is the price the line sold at and
-- the app's revenue column, read from 47 places across 16 files. Folding tax
-- into it would restate revenue and profit by the tax rate on the day it
-- shipped, make orders either side of that day incomparable, and report money
-- held for the tax office as income.
--
-- So the tax is recorded on the ORDER, frozen at sale time, in the same shape
-- invoicesTable already uses (subtotal / tax_rate / tax_amount / tax_inclusive)
-- so this codebase has one tax convention rather than two.

-- ── Outlet configuration ────────────────────────────────────────────────────
-- Rate is the merchant's to enter, never hardcoded: PB1 is set per
-- kabupaten/kota and PPN for goods differs again. Defaults leave every existing
-- outlet exactly as it is today — tax off, nothing charged, nothing printed.
ALTER TABLE "outlets" ADD COLUMN IF NOT EXISTS "tax_enabled" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "outlets" ADD COLUMN IF NOT EXISTS "tax_rate" numeric(5, 2) DEFAULT '0' NOT NULL;
--> statement-breakpoint
ALTER TABLE "outlets" ADD COLUMN IF NOT EXISTS "tax_inclusive" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "outlets" ADD COLUMN IF NOT EXISTS "tax_label" varchar(20) DEFAULT 'Pajak' NOT NULL;
--> statement-breakpoint

-- ── Per-order, frozen ───────────────────────────────────────────────────────
-- Nullable, and no backfill. NULL means no tax applied to this order, which is
-- true of every order that already exists. NULL is not 0: "no tax was charged"
-- and "tax was charged at 0%" are different claims and only one of them should
-- put a tax line on a receipt.
--
-- Frozen rather than re-derived from the outlet's settings, for the same reason
-- orderDetails.unit_cost is frozen (0065): editing the rate today must not
-- rewrite what was charged on a sale that closed months ago.
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "tax_rate" numeric(5, 2);
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "tax_amount" numeric(14, 2);
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "tax_inclusive" boolean;
