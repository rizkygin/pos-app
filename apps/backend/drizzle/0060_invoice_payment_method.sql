CREATE TYPE "public"."invoice_payment_method" AS ENUM('cash', 'transfer', 'qris', 'debit', 'credit', 'ewallet');--> statement-breakpoint
ALTER TABLE "invoice_payments" ADD COLUMN "method" "invoice_payment_method" DEFAULT 'cash' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "down_payment_method" "invoice_payment_method" DEFAULT 'cash' NOT NULL;