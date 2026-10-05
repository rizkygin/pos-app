-- When an admin last reset this outlet's stock flow (Reset Alur Stok on
-- Manage Outlet, lib/outlet-reset.ts). Orders older than this have no stock
-- movements any more, so cancelling one must not re-derive a stock return from
-- the recipe (routes/mutations.ts): that stock already left the ledger with
-- the reset. NULL = never reset.
--
-- Written idempotently so a re-run after a journal `when` correction is
-- harmless.

ALTER TABLE "outlets" ADD COLUMN IF NOT EXISTS "stock_reset_at" timestamp with time zone;
