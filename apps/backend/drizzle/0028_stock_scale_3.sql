ALTER TABLE "products" ALTER COLUMN "stock" SET DATA TYPE numeric(12, 3);--> statement-breakpoint
ALTER TABLE "products" ALTER COLUMN "stock" SET DEFAULT '0';--> statement-breakpoint
ALTER TABLE "stock_movements" ALTER COLUMN "qty_change" SET DATA TYPE numeric(12, 3);