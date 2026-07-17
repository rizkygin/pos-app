ALTER TABLE "subscription_payments" ADD COLUMN "discount_pct" numeric(5, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "discount_pct" numeric(5, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "discount_tier" "subscription_tier";--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "discount_interval" "billing_interval";--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "discount_note" varchar(255) DEFAULT '';