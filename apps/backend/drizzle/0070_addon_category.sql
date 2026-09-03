-- Add-on options stop borrowing a customer-facing category.
--
-- An add-on option is a real products row with is_for_sale = false (0069), and
-- until now it had to be filed under one of the platform's browse categories:
-- "Extra Shot Espresso" as minuman, "Telur Ceplok" as makanan. That was wrong
-- in both directions.
--
--   for the owner   the product list and its category filter showed toppings
--                   shuffled in among the drinks they attach to, and the
--                   category picker offered no honest answer for "this is a
--                   topping" — every choice was a lie about what the thing is.
--   for the customer nothing kept an extra shot off the marketplace except
--                   is_for_sale being right on every single public query. One
--                   missed gate and "Extra Es Batu" is a drink you can order.
--
-- "tambahan" is an internal category, exactly like "bahan": it maps to no
-- browse feature (FEATURE_CATEGORY), so it can never tag an outlet, and it is
-- excluded from every public listing (INTERNAL_CATEGORIES, lib/outlet-features.ts),
-- so a mis-set is_for_sale can no longer publish a topping on its own. The
-- category now says what the row IS, and the gate no longer rests on one flag.
--
-- ONLY OPTIONS THAT ARE NOT SOLD ON THEIR OWN ARE MOVED. A product can be both
-- a menu item and somebody's add-on — "Telur Ceplok" sold as a side and offered
-- on nasi goreng is one row, not two — and that one must keep the category it
-- sells under. is_for_sale = false is exactly the test for "this exists only as
-- an add-on", and it is the same flag the picker and the POS grid already read.
--
-- Archived options count: deleted_at is not filtered below, because a topping
-- the owner removed from a group last week is still a topping, and a held tab
-- may still price against it.
UPDATE "products" p
SET "category" = 'tambahan',
    -- features route "Order Lagi" for a sellable product. An add-on is never
    -- the row that routing reads (that query filters to parent lines), so a
    -- leftover ['drink'] here can only ever mislead a human reading the table.
    "features" = '{}'
WHERE p."is_for_sale" = false
  AND p."category" <> 'tambahan'
  AND EXISTS (
    SELECT 1 FROM "addon_group_options" o WHERE o."product_id" = p."id"
  );
