ALTER TABLE "products" ADD COLUMN "barcode" varchar(64);--> statement-breakpoint
CREATE UNIQUE INDEX "products_outlet_barcode_uq" ON "products" USING btree ("outlet_id","barcode");