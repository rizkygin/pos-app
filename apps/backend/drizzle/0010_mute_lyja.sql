ALTER TABLE "couriers" ADD COLUMN "review_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "review_count" integer DEFAULT 0 NOT NULL;