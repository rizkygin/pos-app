-- Add explanation field to cashInDetailTable and cashOutDetailTable
ALTER TABLE "cashInDetailTable" ADD COLUMN "explanation" text;
ALTER TABLE "cashOutDetailTable" ADD COLUMN "explanation" text;
