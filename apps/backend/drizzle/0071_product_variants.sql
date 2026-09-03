-- Product variants ("Reguler / Large / Jumbo", "Panas / Dingin", "S / M / L").
--
-- A VARIANT IS NOT AN ADD-ON, and the difference is the whole reason this
-- migration exists rather than another addon_group called "Ukuran".
--
--   an add-on ADDS a line.      Nasi goreng + telur = two rows, two prices,
--                               two stock movements. The dish is unchanged.
--   a variant CHANGES the line. A Large is not a Reguler with something added;
--                               it is a different thing, at a different price,
--                               made of different amounts of the same stuff.
--
-- Modelling size as an add-on ("Upsize Large +6.000") forced that group onto
-- every product it could ever apply to, priced the difference instead of the
-- drink, and left the sale reporting one Kopi Susu Reguler plus one abstract
-- "upsize" — so "how many Large did we sell" had no answer, and the extra milk
-- came out of nobody's stock.
--
-- ── The model: a variant is a PRODUCT ───────────────────────────────────────
-- Same decision as 0069 made for add-on options, for the same payoff. A variant
-- is an ordinary products row pointed at its base by variant_of, so it carries
-- its OWN price, stock, recipe, avg_cost, barcode and availability, and:
--
--   * cost     lib/cogs.ts freezes the variant's own unit_cost at sale time.
--   * stock    the variant's own recipe expands to leaves — a Large really can
--              consume 250ml of milk where a Reguler consumes 150ml.
--   * reports  every per-product report already groups by product_id, so
--              "Kopi Susu (Large) x37" appears with no reporting change at all.
--   * refunds  a variant voids like any other line.
--
-- Nothing downstream of the order line needs to know variants exist. The word
-- "variant" appears in exactly one place in the sale path: nowhere.
--
-- ── The base stays sellable ─────────────────────────────────────────────────
-- variant_of IS NULL is a normal product, and it does NOT stop being one when
-- variants are added to it. "Kopi Susu" keeps its price and becomes the first
-- option in its own picker (variant_name, default "Reguler").
--
-- The alternative — an abstract parent that cannot be sold — would have meant
-- migrating every existing product into a child row before it could be rung up,
-- and a product whose variants were all archived would become unsellable with
-- nothing on screen saying why. Here, a product with no variants behaves
-- exactly as it did yesterday, and that is what makes this migration free.
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "variant_of" text;
--> statement-breakpoint

-- ON DELETE SET NULL, deliberately NOT cascade.
--
-- Cascade would let one owner tap delete a base product and take its variants'
-- rows with it — and those rows are referenced by orderDetails, invoiceItems and
-- the stock ledger. Deleting a product must never rewrite financial history,
-- which is why routes/products.ts soft-deletes anything with history in the
-- first place. The route archives a base's variants alongside it (they must not
-- outlive the picker that is the only way to reach them); this constraint is the
-- floor under that, and orphaning a variant into a standalone product is a
-- recoverable state where a cascade-deleted sale is not.
DO $$ BEGIN
  ALTER TABLE "products" ADD CONSTRAINT "products_variant_of_fk"
    FOREIGN KEY ("variant_of") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- This row's short label inside its own group: "Reguler", "Large", "Dingin".
-- Set on the BASE too, where it names the base's own option in the picker.
--
-- It is NOT the product's name. product_name stays the full "Kopi Susu (Large)"
-- because that is the string every receipt, kitchen ticket, stock page and sales
-- report prints, and none of them have a parent to read the context from. This
-- column is only ever shown next to its siblings, where "Large" alone is
-- clearer than repeating the base name three times.
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "variant_name" varchar(40);
--> statement-breakpoint

-- The QUESTION the picker asks, on the base row only: "Ukuran", "Suhu", "Level".
-- Per product rather than per outlet (which is how addon_groups are shared),
-- because a variant set is not reusable: "Ukuran" for coffee is Reguler/Large,
-- for a t-shirt it is S/M/L, and the rows themselves are this product's rows.
-- NULL falls back to "Varian" in the UI.
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "variant_label" varchar(40);
--> statement-breakpoint

-- Menu order, not price order: Reguler before Large before Jumbo, even when the
-- owner prices them oddly. The base sorts first regardless (it is the default).
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "variant_sort" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint

-- Every read is "the variants of this base, in menu order" — the cashier
-- building a picker, the owner's editor, the delete route gathering children.
CREATE INDEX IF NOT EXISTS "products_variant_of_idx" ON "products" ("variant_of", "variant_sort");
--> statement-breakpoint

-- A row can never be its own variant. That is all a CHECK can say here: SQL
-- cannot see whether variant_of points at a row that is itself a variant, so
-- the ONE-LEVEL-DEEP rule (a variant is never a base) lives in the write path,
-- exactly as the same rule does for add-on children in 0069. This constraint is
-- only the floor under the cheapest way to get it wrong.
DO $$ BEGIN
  ALTER TABLE "products" ADD CONSTRAINT "products_variant_not_self"
    CHECK ("variant_of" IS NULL OR "variant_of" <> "id");
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
