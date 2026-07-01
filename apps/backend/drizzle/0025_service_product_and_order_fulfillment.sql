CREATE TYPE "public"."order_fulfillment" AS ENUM('delivery', 'service');--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "fulfillment" "order_fulfillment" DEFAULT 'delivery' NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "lowest_price" varchar(15);--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "highest_price" varchar(15);