ALTER TABLE "product_ads" DROP CONSTRAINT IF EXISTS "product_ads_schedule_at_id_schedule_product_ads_id_fk";--> statement-breakpoint
ALTER TABLE "product_ads" DROP COLUMN IF EXISTS "schedule_at_id";--> statement-breakpoint
ALTER TABLE "product_ads" DROP COLUMN IF EXISTS "duration";--> statement-breakpoint
ALTER TABLE "product_ads" ADD COLUMN "starts_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "product_ads" ADD COLUMN "ends_at" timestamp with time zone;
