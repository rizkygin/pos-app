/**
 * Demo add-on catalogue for a coffee shop — the "Topping / Ukuran / Level Gula"
 * questions a cashier is asked at the counter.
 *
 *   npm run db:seed-addons -- --outlet 19
 *   npm run db:seed-addons -- --outlet 19 --reset   # archive this outlet's
 *                                                   # existing groups first
 *
 * Runs on top of an outlet that already has a menu and its bahan (seed-fnb-cafe),
 * because every option here is priced against ingredients that seed already put
 * in stock. Re-running is safe: products are upserted by name and the group's
 * option list is replaced wholesale, exactly as the products route does it.
 *
 * WHAT IT IS BUILT TO DEMONSTRATE — each option below exists to exercise one
 * path through the sale, not just to fill the menu:
 *
 *   Extra Shot Espresso   a composition add-on: track_stock=false + a recipe, so
 *                         selling one walks the recipe and decrements BEANS,
 *                         tagged to the add-on's own order line
 *   Topping Boba          a tracked add-on: decrements its own stock directly
 *   Extra Es Batu         priced at 0 and still consumes stock — a free add-on
 *                         that costs money is exactly what a POS must be able to
 *                         state, and it is why price 0 is a real value here
 *   Tanpa Gula            free AND costless: a pure preference, no stock at all
 *   Ukuran / Level Gula   min_select=1, so the picker forces a choice ("wajib
 *                         pilih"). There is no separate required flag — a
 *                         minimum of one IS the requirement
 *   Extra Topping         max_select=3, so the picker stops at three
 *
 * The rules are enforced when the cashier COMPOSES a line, never when the sale
 * settles: a tab parked before the owner tightened a rule must still be payable.
 * See lib/addons.ts.
 */
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { db } from './index';
import {
  addonGroupOptionsTable,
  addonGroupsTable,
  outletsTable,
  productAddonGroupsTable,
  productsTable,
  recipeItemsTable,
} from './schema';

/**
 * This script writes demo rows into a live catalogue. It is for a
 * demo/development database only — refuse anything that isn't obviously local
 * unless the caller says out loud that they mean it.
 */
function assertDevelopmentDatabase() {
  const url = process.env.DATABASE_URL ?? '';
  const host = url.replace(/^[a-z]+:\/\/[^@]*@/, '').split('/')[0];
  const local = /^(localhost|127\.0\.0\.1|\[::1\]|host\.docker\.internal|db|postgres)(:\d+)?$/.test(host);
  if (!local && !process.argv.includes('--i-know-this-is-not-local')) {
    throw new Error(
      `Refusing to seed demo data into a non-local database (${host}). ` +
        'Point DATABASE_URL at your dev database first.',
    );
  }
  console.log(`  database: ${host} ${local ? '(local dev)' : '(OVERRIDDEN)'}`);
}

// ---------------------------------------------------------------- katalog

type AddonOption = {
  name: string;
  /** What the CUSTOMER pays for it, rupiah. 0 is a real, deliberate value. */
  price: number;
  /**
   * Ingredients consumed per one of these. Empty means the add-on costs nothing
   * to give away (a preference like "Tanpa Gula"), which is a different thing
   * from being free to the customer.
   */
  recipe?: Record<string, number>;
  /**
   * Countable stock of its own instead of a recipe. Selling one decrements this
   * directly — the other half of the stock story from a composition.
   */
  stock?: number;
  /** Per-unit cost, rupiah. Kept in step with the recipe below it by hand. */
  cost: number;
  unit?: string;
};

type AddonGroupSpec = {
  name: string;
  /** >= 1 is what "wajib pilih" means. */
  minSelect: number;
  /** null = unlimited. */
  maxSelect: number | null;
  options: AddonOption[];
  /** Menu items this question gets asked about, by product name. */
  attachTo: string[];
};

/** Every drink on the menu gets the size and sugar questions. */
const DRINKS = [
  'Affogato',
  'Americano',
  'Caffe Latte',
  'Cappuccino',
  'Caramel Macchiato',
  'Cokelat Panas',
  'Kopi Susu',
  'Kopi Susu Gula Aren',
  'Lemon Tea',
  'Matcha Latte',
  'Milkshake Vanila',
  'Teh Melati',
  'Vanilla Latte',
];

/** The savoury items worth adding to. Cakes and pastries get nothing. */
const SAVOURY = [
  'Beef Burger Keju',
  'Chicken Katsu Curry',
  'Chicken Wings BBQ',
  'Chicken Wrap',
  'French Fries',
  'Nasi Ayam Geprek',
];

const GROUPS: AddonGroupSpec[] = [
  {
    name: 'Ukuran',
    // Exactly one, always: a drink has to be some size, so the picker refuses to
    // confirm until the cashier says which.
    minSelect: 1,
    maxSelect: 1,
    attachTo: DRINKS,
    options: [
      { name: 'Regular', price: 0, cost: 0 },
      {
        name: 'Upsize Large',
        price: 8_000,
        // A bigger cup is a bigger cup, more milk and more ice — all three come
        // out of stock, none of them out of the drink's own recipe.
        recipe: { 'Cup Plastik 16oz': 1, 'Susu UHT Full Cream': 0.05, 'Es Batu Kristal': 0.05 },
        cost: 850 + 900 + 200,
      },
    ],
  },
  {
    name: 'Level Gula',
    minSelect: 1,
    maxSelect: 1,
    attachTo: DRINKS,
    // Free and costless: a preference the barista acts on, with no stock and no
    // money attached. It still belongs in the order because the kitchen ticket
    // has to print it.
    options: [
      { name: 'Gula Normal', price: 0, cost: 0 },
      { name: 'Less Sugar', price: 0, cost: 0 },
      { name: 'Tanpa Gula', price: 0, cost: 0 },
    ],
  },
  {
    name: 'Extra Topping',
    minSelect: 0,
    maxSelect: 3,
    attachTo: DRINKS,
    options: [
      {
        name: 'Extra Shot Espresso',
        price: 8_000,
        // 18 g of beans per shot, the usual double-basket dose.
        recipe: { 'Biji Kopi Arabika Gayo': 0.018 },
        cost: 2_970,
      },
      {
        name: 'Sirup Caramel',
        price: 5_000,
        recipe: { 'Sirup Caramel': 0.025 },
        cost: 1_950,
      },
      {
        name: 'Sirup Vanila',
        price: 5_000,
        recipe: { 'Sirup Vanila': 0.025 },
        cost: 1_950,
      },
      {
        name: 'Extra Susu',
        price: 4_000,
        recipe: { 'Susu UHT Full Cream': 0.05 },
        cost: 900,
      },
      {
        name: 'Topping Boba',
        price: 7_000,
        // Bought in, counted by the portion: no recipe, its own stock instead.
        stock: 200,
        cost: 1_500,
        unit: 'porsi',
      },
      {
        // Free to the customer and NOT free to the shop. The whole reason price
        // and cost are separate columns.
        name: 'Extra Es Batu',
        price: 0,
        recipe: { 'Es Batu Kristal': 0.05 },
        cost: 200,
      },
    ],
  },
  {
    name: 'Tambahan',
    minSelect: 0,
    maxSelect: 3,
    attachTo: SAVOURY,
    options: [
      {
        name: 'Extra Patty Sapi',
        price: 15_000,
        recipe: { 'Daging Sapi Giling': 0.1 },
        cost: 11_800,
      },
      { name: 'Extra Keju', price: 5_000, recipe: { 'Keju Slice': 1 }, cost: 1_800 },
      { name: 'Telur Ceplok', price: 6_000, recipe: { 'Telur Ayam': 1 }, cost: 2_400 },
      {
        name: 'Extra Saus Sambal',
        price: 0,
        recipe: { 'Saus Sambal': 0.02 },
        cost: 300,
      },
    ],
  },
];

// ---------------------------------------------------------------- helpers

const argOf = (flag: string) => {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : undefined;
};

function parseOutletId(): number {
  const raw = argOf('--outlet') ?? process.env.SEED_OUTLET_ID;
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error('Pass a target outlet: npm run db:seed-addons -- --outlet 19');
  }
  return id;
}

const rupiah = (n: number) => `Rp${Math.round(n).toLocaleString('id-ID')}`;

// ---------------------------------------------------------------- main

async function main() {
  assertDevelopmentDatabase();
  const outletId = parseOutletId();
  const doReset = process.argv.includes('--reset');

  const [outlet] = await db
    .select({ id: outletsTable.id, name: outletsTable.name })
    .from(outletsTable)
    .where(eq(outletsTable.id, outletId))
    .limit(1);
  if (!outlet) throw new Error(`Outlet ${outletId} not found`);

  console.log(`\nSeeding add-ons onto #${outlet.id} ${outlet.name}\n`);

  // Everything already in this outlet's catalogue, by name — both the menu items
  // the groups attach to and the bahan the options are costed against.
  const existing = await db
    .select({ id: productsTable.id, name: productsTable.product_name })
    .from(productsTable)
    .where(and(eq(productsTable.outlet_id, outletId), isNull(productsTable.deletedAt)));
  const productId = new Map(existing.map((p) => [p.name, p.id]));

  // ── reset ─────────────────────────────────────────────────────────
  // Archived, never deleted, for the same reason the delete route archives: a
  // cashier's held tab may still reference one of these rows.
  if (doReset) {
    const now = new Date();
    const groups = await db
      .select({ id: addonGroupsTable.id })
      .from(addonGroupsTable)
      .where(and(eq(addonGroupsTable.outlet_id, outletId), isNull(addonGroupsTable.deletedAt)));
    const ids = groups.map((g) => g.id);
    if (ids.length > 0) {
      await db
        .update(addonGroupOptionsTable)
        .set({ deletedAt: now })
        .where(inArray(addonGroupOptionsTable.group_id, ids));
      await db
        .update(productAddonGroupsTable)
        .set({ deleted_at: now })
        .where(inArray(productAddonGroupsTable.group_id, ids));
      await db.update(addonGroupsTable).set({ deletedAt: now }).where(inArray(addonGroupsTable.id, ids));
    }
    console.log(`  reset   : ${ids.length} grup lama diarsipkan`);
  }

  // ── option products ───────────────────────────────────────────────
  // Upsert by name so a re-run refreshes prices instead of duplicating. Each is
  // a real products row with is_for_sale=false, which is what keeps it off the
  // POS grid and the customer menu while still giving it stock, a recipe and a
  // cost of its own.
  const allOptions = GROUPS.flatMap((g) => g.options);
  const optionIds = new Map<string, string>();

  for (const opt of allOptions) {
    const tracked = opt.stock !== undefined;
    const values = {
      price: String(opt.price),
      price_mark_down: '0',
      buying_price: String(opt.cost),
      outlet_id: outletId,
      // Its own internal category, never the category of the dish it attaches
      // to: an extra shot is not a drink somebody can order. "tambahan" maps to
      // no browse feature and is excluded from every public listing
      // (INTERNAL_CATEGORIES in lib/outlet-features.ts), so this row cannot
      // reach a customer even if is_for_sale below were wrong.
      category: 'tambahan',
      unit: opt.unit ?? 'porsi',
      image: 'avatar.png',
      // Empty on purpose: features route marketplace browse, which never sees
      // this row, and "Order Lagi" reads the parent line's features anyway.
      features: [],
      // Never sold on its own — it only ever reaches an order as a child line.
      is_for_sale: false,
      // Tracked: countable stock of its own. Untracked: selling one walks the
      // recipe below into bahan instead.
      track_stock: tracked,
      stock: String(opt.stock ?? 0),
      // Only meaningful for the tracked one; a recipe product's cost comes from
      // its leaves, and buying_price is the fallback when it has neither.
      avg_cost: tracked ? String(opt.cost) : '0',
      isAvailable: true,
      courier_deliverable: true,
      menu_group_id: null,
      description: 'Tambahan (add-on)',
    };

    const [row] = await db
      .select({ id: productsTable.id })
      .from(productsTable)
      .where(
        and(eq(productsTable.outlet_id, outletId), eq(productsTable.product_name, opt.name)),
      )
      .limit(1);

    if (row) {
      await db.update(productsTable).set(values).where(eq(productsTable.id, row.id));
      optionIds.set(opt.name, row.id);
    } else {
      const id = randomUUID();
      await db.insert(productsTable).values({ id, product_name: opt.name, ...values } as never);
      optionIds.set(opt.name, id);
    }
  }
  console.log(`  produk  : ${allOptions.length} item tambahan`);

  // ── recipes (replace-on-save, matching the products route) ────────
  const recipeOwners = allOptions.filter((o) => o.recipe).map((o) => optionIds.get(o.name)!);
  if (recipeOwners.length > 0) {
    await db.delete(recipeItemsTable).where(inArray(recipeItemsTable.product_id, recipeOwners));
  }

  let recipeRows = 0;
  const missing: string[] = [];
  for (const opt of allOptions) {
    if (!opt.recipe) continue;
    const rows = Object.entries(opt.recipe).flatMap(([ing, qty]) => {
      const ingredient_id = productId.get(ing);
      if (!ingredient_id) {
        missing.push(`${opt.name} -> ${ing}`);
        return [];
      }
      return [
        { outlet_id: outletId, product_id: optionIds.get(opt.name)!, ingredient_id, qty: String(qty) },
      ];
    });
    if (rows.length) await db.insert(recipeItemsTable).values(rows);
    recipeRows += rows.length;
  }
  console.log(`  resep   : ${recipeRows} baris bahan`);
  if (missing.length > 0) {
    console.warn(`  ! bahan tidak ada, dilewati: ${missing.join(', ')}`);
  }

  // ── groups, options and attachments ───────────────────────────────
  let attachments = 0;
  const skipped: string[] = [];

  for (const [i, spec] of GROUPS.entries()) {
    // A live group of this name is reused, so re-running does not pile up
    // duplicates the owner would then have to clean out by hand.
    const [live] = await db
      .select({ id: addonGroupsTable.id })
      .from(addonGroupsTable)
      .where(
        and(
          eq(addonGroupsTable.outlet_id, outletId),
          eq(addonGroupsTable.name, spec.name),
          isNull(addonGroupsTable.deletedAt),
        ),
      )
      .limit(1);

    let groupId: number;
    if (live) {
      groupId = live.id;
      await db
        .update(addonGroupsTable)
        .set({
          min_select: spec.minSelect,
          max_select: spec.maxSelect,
          sort_order: i,
          updatedAt: new Date(),
        })
        .where(eq(addonGroupsTable.id, groupId));
    } else {
      const [created] = await db
        .insert(addonGroupsTable)
        .values({
          outlet_id: outletId,
          name: spec.name,
          min_select: spec.minSelect,
          max_select: spec.maxSelect,
          sort_order: i,
        })
        .returning({ id: addonGroupsTable.id });
      groupId = created.id;
    }

    // Options are replaced wholesale, the same idiom the PUT route uses: archive
    // the current set, then insert the new one. The unique index is partial on
    // deleted_at IS NULL, so re-adding an option archived a moment ago is fine.
    await db
      .update(addonGroupOptionsTable)
      .set({ deletedAt: new Date() })
      .where(
        and(eq(addonGroupOptionsTable.group_id, groupId), isNull(addonGroupOptionsTable.deletedAt)),
      );
    await db.insert(addonGroupOptionsTable).values(
      spec.options.map((o, j) => ({
        group_id: groupId,
        product_id: optionIds.get(o.name)!,
        price: String(o.price),
        sort_order: j,
      })),
    );

    for (const [j, productName] of spec.attachTo.entries()) {
      const target = productId.get(productName);
      if (!target) {
        skipped.push(productName);
        continue;
      }
      const [attached] = await db
        .select({ id: productAddonGroupsTable.id })
        .from(productAddonGroupsTable)
        .where(
          and(
            eq(productAddonGroupsTable.product_id, target),
            eq(productAddonGroupsTable.group_id, groupId),
            isNull(productAddonGroupsTable.deleted_at),
          ),
        )
        .limit(1);
      if (attached) continue;
      await db
        .insert(productAddonGroupsTable)
        .values({ product_id: target, group_id: groupId, sort_order: j });
      attachments++;
    }

    const rule =
      spec.minSelect > 0
        ? `wajib pilih ${spec.minSelect}${spec.maxSelect ? `-${spec.maxSelect}` : ''}`
        : `opsional, maks ${spec.maxSelect ?? '∞'}`;
    console.log(
      `  grup    : ${spec.name.padEnd(14)} ${String(spec.options.length).padStart(2)} opsi · ${rule} · ${spec.attachTo.length} menu`,
    );
  }

  console.log(`  pasang  : ${attachments} kaitan menu-grup baru`);
  if (skipped.length > 0) {
    console.warn(`  ! menu tidak ada, dilewati: ${[...new Set(skipped)].join(', ')}`);
  }

  const cheapest = Math.min(...allOptions.map((o) => o.price));
  const dearest = Math.max(...allOptions.map((o) => o.price));
  console.log(
    `\n  harga tambahan ${rupiah(cheapest)} – ${rupiah(dearest)}` +
      `\n\nSelesai. Buka Kasir di outlet ini, ketuk salah satu minuman, dan pemilih tambahan akan muncul.\n`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
