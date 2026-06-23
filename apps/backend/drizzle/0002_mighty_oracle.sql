ALTER TABLE "cashFlows" RENAME COLUMN "cash_in_category_id" TO "cash_in_detail_id";--> statement-breakpoint
ALTER TABLE "cashFlows" RENAME COLUMN "cash_out_category_id" TO "cash_out_detail_id";--> statement-breakpoint
ALTER TABLE "cashFlows" DROP CONSTRAINT "cashFlows_cash_in_category_id_cashInDetailTable_id_fk";
--> statement-breakpoint
ALTER TABLE "cashFlows" DROP CONSTRAINT "cashFlows_cash_out_category_id_cashOutDetailTable_id_fk";
--> statement-breakpoint
ALTER TABLE "cashFlows" ADD CONSTRAINT "cashFlows_cash_in_detail_id_cashInDetailTable_id_fk" FOREIGN KEY ("cash_in_detail_id") REFERENCES "public"."cashInDetailTable"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cashFlows" ADD CONSTRAINT "cashFlows_cash_out_detail_id_cashOutDetailTable_id_fk" FOREIGN KEY ("cash_out_detail_id") REFERENCES "public"."cashOutDetailTable"("id") ON DELETE no action ON UPDATE no action;