CREATE INDEX "products_outlet_id_idx" ON "products" USING btree ("outlet_id");--> statement-breakpoint
CREATE INDEX "orders_outlet_status_idx" ON "orders" USING btree ("outlet_id","status");--> statement-breakpoint
CREATE INDEX "orders_courier_status_idx" ON "orders" USING btree ("courier_id","status");--> statement-breakpoint
CREATE INDEX "order_details_order_id_idx" ON "orderDetails" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "ratings_outlet_id_idx" ON "ratings" USING btree ("outlet_id");--> statement-breakpoint
CREATE INDEX "ratings_product_id_idx" ON "ratings" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "ratings_reciepent_idx" ON "ratings" USING btree ("reciepent_id");--> statement-breakpoint
CREATE INDEX "cash_in_detail_created_at_idx" ON "cashInDetailTable" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "cash_out_detail_created_at_idx" ON "cashOutDetailTable" USING btree ("created_at");
