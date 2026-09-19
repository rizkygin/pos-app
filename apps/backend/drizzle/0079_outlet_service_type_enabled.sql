-- Whether the counter asks Dine In / Take Away at all, per outlet.
--
-- A coffee stand that only sells to go, or a warung where everyone eats in,
-- has no use for the switch on every sale. The owner turns it off, the cashier
-- stops showing it, and the server stops recording one: counter sales and
-- counter kitchen tickets go in as NULL, which already means "not recorded"
-- (0076). A table's bill still records dine_in — it was eaten at a table, and
-- that is not the counter's switch to answer.
--
-- TRUE by default so every existing outlet keeps the switch it has today.
-- Turning it off never rewrites past orders.

ALTER TABLE "outlets" ADD COLUMN IF NOT EXISTS "service_type_enabled" boolean DEFAULT true NOT NULL;
