CREATE TYPE "public"."rejected_by" AS ENUM('courier', 'customer', 'owner');--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "rejected_by" "rejected_by";