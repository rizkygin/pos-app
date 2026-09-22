-- Variance reasons and skipped items on an opname session (0082).
--
-- Finishing a session now requires an ANSWER for every product: a count, or
-- an explicit "tidak bisa dihitung". A skipped line adjusts nothing, so its
-- `counted` is NULL — a zero is a real count ("the shelf is empty") and the
-- two must not collapse into each other.
--
-- `reason` is one of the codes in lib/opname.ts, required before finishing
-- when the difference is worth more than the tolerance, and copied into the
-- stock adjustment's note so the ledger explains itself.
--
-- Written idempotently so a re-run after a journal `when` correction is
-- harmless.

ALTER TABLE "stock_opname_lines" ALTER COLUMN "counted" DROP NOT NULL;
--> statement-breakpoint

ALTER TABLE "stock_opname_lines"
  ADD COLUMN IF NOT EXISTS "skipped" boolean DEFAULT false NOT NULL,
  ADD COLUMN IF NOT EXISTS "reason" varchar(40);
--> statement-breakpoint

-- A skipped line carries no count; a counted line always does.
DO $$ BEGIN
  ALTER TABLE "stock_opname_lines" ADD CONSTRAINT "stock_opname_lines_counted_ck"
    CHECK (("skipped" and "counted" is null) or (not "skipped" and "counted" is not null));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
