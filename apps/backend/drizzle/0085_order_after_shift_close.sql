-- A counter sale that reached the server after its shift had been closed.
--
-- An offline till (the Android app's queue) sends the shift it rang each sale
-- up under, and the sale is filed there even when that shift has closed in the
-- meantime (see getShiftForSale in lib/shift.ts). It is that shift's sale like
-- any other, and its cash is added on read on top of the frozen expected_cash
-- and variance (lateCashSql), so the stored columns stay exactly what was
-- signed. The slip prints it on its own line: "Masuk setelah tutup shift".
--
-- false on every sale that arrived while its shift was open, which is every
-- sale taken before this existed, so nothing is backfilled.
--
-- Written idempotently so a re-run after a journal `when` correction is
-- harmless.

ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "after_shift_close" boolean DEFAULT false NOT NULL;
--> statement-breakpoint

-- Only a sale filed under a shift can have arrived after that shift closed.
DO $$ BEGIN
  ALTER TABLE "orders" ADD CONSTRAINT "orders_after_shift_close_ck" CHECK (
    NOT "after_shift_close" OR "shift_id" IS NOT NULL
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
