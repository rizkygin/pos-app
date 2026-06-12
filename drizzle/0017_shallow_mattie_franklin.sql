CREATE TABLE "product_ads_schedule" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "product_ads_schedule_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"schedule_products_ads_id" integer NOT NULL,
	"products_ads_id" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "product_ads_schedule" ADD CONSTRAINT "product_ads_schedule_schedule_products_ads_id_schedule_product_ads_id_fk" FOREIGN KEY ("schedule_products_ads_id") REFERENCES "public"."schedule_product_ads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_ads_schedule" ADD CONSTRAINT "product_ads_schedule_products_ads_id_product_ads_id_fk" FOREIGN KEY ("products_ads_id") REFERENCES "public"."product_ads"("id") ON DELETE no action ON UPDATE no action;