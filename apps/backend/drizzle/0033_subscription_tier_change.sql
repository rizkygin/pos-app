ALTER TABLE "subscriptions" ADD COLUMN "next_plan_id" integer;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "next_tier" "subscription_tier";--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "next_tier_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_next_plan_id_subscription_plans_id_fk" FOREIGN KEY ("next_plan_id") REFERENCES "public"."subscription_plans"("id") ON DELETE no action ON UPDATE no action;