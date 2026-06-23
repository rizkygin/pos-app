ALTER TYPE "public"."receipt" ADD VALUE 'product';--> statement-breakpoint
ALTER TABLE "couriers" ALTER COLUMN "ratings" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "couriers" ALTER COLUMN "ratings" SET DATA TYPE numeric(3, 2) USING ratings::numeric;--> statement-breakpoint
ALTER TABLE "couriers" ALTER COLUMN "ratings" SET DEFAULT 5;--> statement-breakpoint
ALTER TABLE "customers" ALTER COLUMN "ratings" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "customers" ALTER COLUMN "ratings" SET DATA TYPE numeric(3, 2) USING ratings::numeric;--> statement-breakpoint
ALTER TABLE "customers" ALTER COLUMN "ratings" SET DEFAULT 5;--> statement-breakpoint
ALTER TABLE "outlets" ALTER COLUMN "ratings" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "outlets" ALTER COLUMN "ratings" SET DATA TYPE numeric(3, 2) USING ratings::numeric;--> statement-breakpoint
ALTER TABLE "outlets" ALTER COLUMN "ratings" SET DEFAULT 5;--> statement-breakpoint
ALTER TABLE "products" ALTER COLUMN "ratings" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "products" ALTER COLUMN "ratings" SET DATA TYPE numeric(3, 2) USING ratings::numeric;--> statement-breakpoint
ALTER TABLE "products" ALTER COLUMN "ratings" SET DEFAULT 5;--> statement-breakpoint
ALTER TABLE "ratings" ALTER COLUMN "ratings" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "ratings" ALTER COLUMN "ratings" SET DATA TYPE numeric(3, 2) USING ratings::numeric;--> statement-breakpoint
ALTER TABLE "ratings" ALTER COLUMN "ratings" SET DEFAULT 5;--> statement-breakpoint
ALTER TABLE "ratings" ALTER COLUMN "reciepent_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "ratings" ADD COLUMN "comment" text;--> statement-breakpoint
ALTER TABLE "ratings" ADD COLUMN "outlet_id" integer;--> statement-breakpoint
ALTER TABLE "ratings" ADD COLUMN "product_id" text;--> statement-breakpoint
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;