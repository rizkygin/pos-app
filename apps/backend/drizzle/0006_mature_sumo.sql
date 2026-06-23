ALTER TABLE "promos" ADD COLUMN "image" varchar(255) DEFAULT '/promos/default-promo.png' NOT NULL;--> statement-breakpoint
CREATE INDEX "products_available_deleted_idx" ON "products" USING btree ("is_available","deleted_at");--> statement-breakpoint
ALTER TABLE "orders" DROP COLUMN "image";