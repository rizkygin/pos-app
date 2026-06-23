ALTER TABLE "orderDetails" ALTER COLUMN "note_product" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "image" varchar(255) DEFAULT '/promos/default-promo.png' NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "buying_price" varchar(15) DEFAULT '0' NOT NULL;