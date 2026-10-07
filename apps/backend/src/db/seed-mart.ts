/**
 * Seeds a minimarket / sembako catalogue onto one outlet so the "Belanja" (mart)
 * browse can be exercised: sections, barcodes for the cashier scanner, a few
 * markdown promos, and real opening stock.
 *
 * Opening stock goes through postMovement() as an 'adjustment' at the buying
 * price, so the Stok page, Alur Stok and avg_cost all agree from the first sale
 * instead of starting from a bare `stock` number with no ledger behind it.
 *
 * Idempotent: matches on (outlet_id, product_name) among live products and
 * updates in place. Stock is booked only when a product is first created, so a
 * re-run refreshes prices without inflating the shelf.
 *
 *   npm run db:seed-mart -- --outlet 21
 */
import { and, eq, isNull } from "drizzle-orm";
import { randomUUID } from "crypto";
import { db } from "./index";
import { outletsTable, productsTable, menuGroupsTable } from "./schema";
import { recalcOutletFeatures } from "../lib/outlet-features";
import { postMovement } from "../lib/cost";

const CATEGORY = "mart";

type SeedProduct = {
  name: string;
  unit: string;
  stock: number;
  buying: number;
  price: number;
  /** Promo selling price. Shown struck-through against `price`. */
  promo?: number;
  group: string;
};

// Ballpark minimarket retail, late 2026. Plausible relative to each other is
// all that matters here.
const CATALOGUE: SeedProduct[] = [
  // ── Sembako ─────────────────────────────────────────────────────────
  { name: "Beras Premium 5kg", unit: "karung", stock: 30, buying: 68_000, price: 78_000, group: "Sembako" },
  { name: "Minyak Goreng 2L", unit: "pouch", stock: 40, buying: 33_000, price: 38_500, promo: 36_000, group: "Sembako" },
  { name: "Gula Pasir 1kg", unit: "pcs", stock: 50, buying: 16_000, price: 18_500, group: "Sembako" },
  { name: "Telur Ayam 10 butir", unit: "pak", stock: 25, buying: 25_000, price: 29_000, group: "Sembako" },
  { name: "Tepung Terigu 1kg", unit: "pcs", stock: 35, buying: 11_500, price: 14_000, group: "Sembako" },

  // ── Mi & Makanan Instan ─────────────────────────────────────────────
  { name: "Mi Instan Goreng", unit: "bungkus", stock: 200, buying: 2_800, price: 3_500, group: "Mi & Makanan Instan" },
  { name: "Mi Instan Kuah Soto", unit: "bungkus", stock: 150, buying: 2_700, price: 3_300, group: "Mi & Makanan Instan" },
  { name: "Sarden Kaleng 155gr", unit: "kaleng", stock: 40, buying: 9_000, price: 11_500, group: "Mi & Makanan Instan" },
  { name: "Kornet Sapi 198gr", unit: "kaleng", stock: 30, buying: 19_000, price: 23_500, promo: 21_000, group: "Mi & Makanan Instan" },

  // ── Minuman ─────────────────────────────────────────────────────────
  { name: "Air Mineral 600ml", unit: "botol", stock: 120, buying: 2_500, price: 3_500, group: "Minuman" },
  { name: "Air Mineral Galon 19L", unit: "galon", stock: 15, buying: 17_000, price: 21_000, group: "Minuman" },
  { name: "Teh Kotak 300ml", unit: "kotak", stock: 60, buying: 3_200, price: 4_500, group: "Minuman" },
  { name: "Kopi Sachet 3in1 (10 pcs)", unit: "renceng", stock: 45, buying: 13_000, price: 16_000, group: "Minuman" },
  { name: "Susu UHT Cokelat 1L", unit: "kotak", stock: 30, buying: 17_500, price: 21_000, group: "Minuman" },

  // ── Snack ───────────────────────────────────────────────────────────
  { name: "Keripik Kentang 68gr", unit: "bungkus", stock: 50, buying: 8_500, price: 11_000, group: "Snack" },
  { name: "Biskuit Cokelat 130gr", unit: "bungkus", stock: 45, buying: 7_000, price: 9_500, group: "Snack" },
  { name: "Wafer Keju 140gr", unit: "bungkus", stock: 40, buying: 8_000, price: 10_500, promo: 9_000, group: "Snack" },

  // ── Bumbu Dapur ─────────────────────────────────────────────────────
  { name: "Kecap Manis 520ml", unit: "botol", stock: 35, buying: 19_500, price: 23_500, group: "Bumbu Dapur" },
  { name: "Saus Sambal 335ml", unit: "botol", stock: 30, buying: 11_000, price: 14_000, group: "Bumbu Dapur" },
  { name: "Garam Dapur 250gr", unit: "bungkus", stock: 40, buying: 2_500, price: 3_500, group: "Bumbu Dapur" },

  // ── Kebutuhan Rumah ─────────────────────────────────────────────────
  { name: "Sabun Cuci Piring 780ml", unit: "pouch", stock: 35, buying: 13_000, price: 16_500, group: "Kebutuhan Rumah" },
  { name: "Deterjen Bubuk 800gr", unit: "bungkus", stock: 30, buying: 19_000, price: 23_000, group: "Kebutuhan Rumah" },
  { name: "Tisu Wajah 250 lembar", unit: "pak", stock: 40, buying: 11_000, price: 14_500, group: "Kebutuhan Rumah" },

  // ── Perawatan Diri ──────────────────────────────────────────────────
  { name: "Sabun Mandi Batang 110gr", unit: "pcs", stock: 60, buying: 3_500, price: 5_000, group: "Perawatan Diri" },
  { name: "Sampo Sachet (12 pcs)", unit: "renceng", stock: 40, buying: 9_500, price: 12_000, group: "Perawatan Diri" },
  { name: "Pasta Gigi 190gr", unit: "pcs", stock: 35, buying: 12_000, price: 15_500, group: "Perawatan Diri" },
];

/**
 * Deterministic EAN-13 per outlet + position, under the 899 (Indonesia) prefix,
 * so the cashier's barcode scan has something to hit. Fake codes, but with a
 * valid check digit so scanner libraries don't reject them.
 */
function ean13(outletId: number, index: number): string {
  const body = `899${String(outletId).padStart(4, "0")}${String(index + 1).padStart(5, "0")}`;
  const sum = [...body].reduce((acc, d, i) => acc + Number(d) * (i % 2 === 0 ? 1 : 3), 0);
  return body + ((10 - (sum % 10)) % 10);
}

function parseOutletId(): number {
  const flag = process.argv.indexOf("--outlet");
  const raw = flag !== -1 ? process.argv[flag + 1] : process.env.SEED_OUTLET_ID;
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error("Pass a target outlet: npm run db:seed-mart -- --outlet 21");
  }
  return id;
}

async function main() {
  const outletId = parseOutletId();

  const [outlet] = await db
    .select({ id: outletsTable.id, name: outletsTable.name })
    .from(outletsTable)
    .where(eq(outletsTable.id, outletId))
    .limit(1);
  if (!outlet) throw new Error(`Outlet ${outletId} not found`);

  console.log(`Seeding ${CATALOGUE.length} products onto #${outlet.id} ${outlet.name}\n`);

  // Sections are matched by name so an owner's existing row (and its sort
  // order) is reused rather than duplicated.
  const existingGroups = await db
    .select({ id: menuGroupsTable.id, name: menuGroupsTable.name, sort: menuGroupsTable.sort_order })
    .from(menuGroupsTable)
    .where(eq(menuGroupsTable.outlet_id, outletId));

  const groupIdByName = new Map(existingGroups.map((g) => [g.name, g.id]));
  let nextSort = existingGroups.reduce((max, g) => Math.max(max, g.sort ?? 0), -1) + 1;

  for (const name of new Set(CATALOGUE.map((i) => i.group))) {
    if (groupIdByName.has(name)) continue;
    const [row] = await db
      .insert(menuGroupsTable)
      .values({ outlet_id: outletId, name, sort_order: nextSort++ })
      .returning({ id: menuGroupsTable.id });
    groupIdByName.set(name, row.id);
    console.log(`  + grup menu "${name}"`);
  }

  let created = 0;
  let updated = 0;

  for (const [index, item] of CATALOGUE.entries()) {
    const sellAt = item.promo ?? item.price;
    const values = {
      product_name: item.name,
      price: String(item.price),
      price_mark_down: String(sellAt),
      discount_percent: item.promo ? Math.round((1 - item.promo / item.price) * 100) : null,
      buying_price: String(item.buying),
      outlet_id: outletId,
      category: CATEGORY,
      unit: item.unit,
      image: "avatar.png",
      features: ["mart"],
      is_for_sale: true,
      track_stock: true,
      courier_deliverable: true,
      isAvailable: true,
      barcode: ean13(outletId, index),
      menu_group_id: groupIdByName.get(item.group) ?? null,
    };

    const [existing] = await db
      .select({ id: productsTable.id })
      .from(productsTable)
      .where(
        and(
          eq(productsTable.outlet_id, outletId),
          eq(productsTable.product_name, item.name),
          isNull(productsTable.deletedAt),
        ),
      )
      .limit(1);

    if (existing) {
      await db.update(productsTable).set(values).where(eq(productsTable.id, existing.id));
      updated += 1;
    } else {
      const id = randomUUID();
      await db.transaction(async (tx) => {
        await tx.insert(productsTable).values({ id, ...values, stock: "0" });
        await postMovement(tx, {
          outletId,
          productId: id,
          qtyChange: item.stock,
          reason: "adjustment",
          unitCost: item.buying,
          note: "Stok awal (seed)",
        });
      });
      created += 1;
    }

    const promo = item.promo ? ` promo ${item.promo} (-${values.discount_percent}%)` : "";
    console.log(
      `  ${item.name.padEnd(28)} ${item.group.padEnd(20)} ${String(item.price).padStart(6)}${promo}  stok ${item.stock} ${item.unit}`,
    );
  }

  // outlets.features is derived from products, so the outlet only shows up
  // under Belanja once it actually holds mart products.
  const features = await recalcOutletFeatures(outletId);

  console.log(`\n${created} created, ${updated} updated`);
  console.log(`outlet features -> {${features.join(", ")}}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
