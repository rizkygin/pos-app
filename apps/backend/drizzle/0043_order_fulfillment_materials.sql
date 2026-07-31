-- Third fulfillment lane: bulky goods the outlet delivers with its own driver.
--
-- delivery  = courier carries it (food, drink, mart, light materials)
-- service   = jasa; no courier, owner drives the whole flow, price is negotiated
-- materials = besi/keramik/kulkas; no courier either, but the goods have fixed
--             prices and real stock. What the owner quotes is the haul, stored
--             in orders.delivery_fee and capped by the products' price band.
--
-- Safe inside drizzle's migration transaction: PostgreSQL 12+ permits ALTER TYPE
-- ... ADD VALUE in a transaction as long as the new label is not *used* in that
-- same transaction. This migration only declares it; nothing writes 'materials'
-- until the application does, long after commit.

ALTER TYPE "public"."order_fulfillment" ADD VALUE IF NOT EXISTS 'materials';
