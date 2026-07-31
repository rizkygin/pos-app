/**
 * Seeds a realistic hardware-store catalogue onto one outlet, covering BOTH
 * fulfillment lanes so the materials flow can actually be exercised end to end.
 *
 *   courier_deliverable = true   fixed price, rides the normal courier lane
 *   courier_deliverable = false  [lowest, highest] band, outlet's own driver;
 *                                the gap is the haul room the owner quotes into
 *                                orders.delivery_fee at confirm time
 *
 * Idempotent: matches on (outlet_id, product_name) and updates in place, so
 * re-running refreshes prices instead of duplicating the catalogue.
 *
 *   npm run db:seed-materials -- --outlet 17
 */
import { and, eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { db } from "./index";
import { outletsTable, productsTable, menuGroupsTable } from "./schema";
import { recalcOutletFeatures } from "../lib/outlet-features";

const CATEGORY = "bahan bangunan";

type SeedProduct = {
  name: string;
  unit: string;
  stock: number;
  buying: number;
  /** Fixed selling price. Courier-deliverable goods only. */
  price?: number;
  /** Goods price / goods + delivered. Bulky goods only — the gap is haul room. */
  band?: [lowest: number, highest: number];
  /**
   * Owner's menu section. Created if missing, matched by name otherwise.
   * The customer browse tabs show these instead of the raw "bahan bangunan"
   * category — without an assignment there is nothing for them to show.
   */
  group?: string;
};

// Prices are ballpark Banjarmasin retail, mid-2026. They only need to be
// plausible relative to each other — the point is exercising both lanes.
const CATALOGUE: SeedProduct[] = [
  // ── Courier-deliverable: light enough for a motorcycle ──────────────
  { name: "Semen Tiga Roda 40kg", unit: "sak", stock: 120, buying: 58_000, price: 65_000, group: "Semen" },
  { name: "Cat Tembok Avitex 5kg", unit: "kaleng", stock: 40, buying: 72_000, price: 89_000, group: "Cat & Finishing" },
  { name: "Paku Beton 5cm", unit: "kg", stock: 85, buying: 18_000, price: 24_000, group: "Bahan Bangunan" },
  { name: "Kuas Cat 3 inci", unit: "pcs", stock: 60, buying: 12_000, price: 18_000, group: "Cat & Finishing" },
  { name: "Lem Pipa PVC 100gr", unit: "pcs", stock: 55, buying: 9_000, price: 14_000, group: "Bahan Bangunan" },
  { name: "Engsel Pintu Stainless 4 inci", unit: "pasang", stock: 48, buying: 21_000, price: 32_000, group: "Furniture" },
  { name: "Kunci Pintu Set", unit: "set", stock: 25, buying: 78_000, price: 105_000, group: "Furniture" },

  // ── Not courier-deliverable: the outlet hauls these itself ──────────
  { name: "Besi Beton Polos 10mm 12m", unit: "batang", stock: 200, buying: 72_000, band: [85_000, 95_000], group: "Besi" },
  { name: "Besi Beton Ulir 13mm 12m", unit: "batang", stock: 150, buying: 118_000, band: [138_000, 152_000], group: "Besi" },
  { name: "Keramik Lantai 40x40", unit: "dus", stock: 300, buying: 51_000, band: [62_000, 67_000], group: "Keramik" },
  { name: "Keramik Dinding 25x40", unit: "dus", stock: 180, buying: 47_000, band: [58_000, 63_000], group: "Keramik" },
  { name: "Wastafel Keramik Putih", unit: "pcs", stock: 18, buying: 365_000, band: [450_000, 495_000], group: "Furniture" },
  { name: "Kloset Jongkok", unit: "pcs", stock: 22, buying: 145_000, band: [185_000, 210_000], group: "Furniture" },
  { name: "Pasir Bangunan", unit: "kubik", stock: 40, buying: 220_000, band: [280_000, 340_000], group: "Bahan Bangunan" },
  { name: "Batu Split 2/3", unit: "kubik", stock: 30, buying: 260_000, band: [320_000, 385_000], group: "Bahan Bangunan" },
  { name: "Batako Press", unit: "biji", stock: 2_000, buying: 2_700, band: [3_500, 4_200], group: "Bahan Bangunan" },
  { name: "Seng Gelombang 2m", unit: "lembar", stock: 140, buying: 54_000, band: [68_000, 78_000], group: "Bahan Bangunan" },
  { name: "Pipa PVC 4 inci 4m", unit: "batang", stock: 90, buying: 76_000, band: [95_000, 105_000], group: "Bahan Bangunan" },
  { name: "Triplek 9mm 122x244", unit: "lembar", stock: 65, buying: 128_000, band: [158_000, 175_000], group: "Bahan Bangunan" },
];

function parseOutletId(): number {
  const flag = process.argv.indexOf("--outlet");
  const raw = flag !== -1 ? process.argv[flag + 1] : process.env.SEED_OUTLET_ID;
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error("Pass a target outlet: npm run db:seed-materials -- --outlet 17");
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

  // Resolve the owner's sections, creating any that don't exist yet. Matched by
  // name so an outlet that already has "Besi" keeps its own row (and whatever
  // sort_order the owner dragged it to) instead of getting a duplicate.
  const existingGroups = await db
    .select({ id: menuGroupsTable.id, name: menuGroupsTable.name, sort: menuGroupsTable.sort_order })
    .from(menuGroupsTable)
    .where(eq(menuGroupsTable.outlet_id, outletId));

  const groupIdByName = new Map(existingGroups.map((g) => [g.name, g.id]));
  let nextSort = existingGroups.reduce((max, g) => Math.max(max, g.sort ?? 0), -1) + 1;

  for (const name of new Set(CATALOGUE.map((i) => i.group).filter(Boolean) as string[])) {
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

  for (const item of CATALOGUE) {
    const deliverable = item.band === undefined;
    const lowest = item.band ? item.band[0] : null;
    const highest = item.band ? item.band[1] : null;
    // Mirrors rangePricedFields() in routes/products.ts: a banded product's
    // `price` is its floor, so every existing "mulai dari" display keeps working.
    const price = String(item.band ? item.band[0] : item.price!);

    const values = {
      product_name: item.name,
      price,
      price_mark_down: price,
      buying_price: String(item.buying),
      outlet_id: outletId,
      category: CATEGORY,
      unit: item.unit,
      image: "avatar.png",
      features: ["building-materials"],
      is_for_sale: true,
      // Real countable goods — batang, dus, sak. This is exactly what the old
      // serviceProductFields() would have wiped out on any banded product.
      track_stock: true,
      courier_deliverable: deliverable,
      lowest_price: lowest === null ? null : String(lowest),
      highest_price: highest === null ? null : String(highest),
      stock: String(item.stock),
      isAvailable: true,
      menu_group_id: item.group ? (groupIdByName.get(item.group) ?? null) : null,
    };

    const [existing] = await db
      .select({ id: productsTable.id })
      .from(productsTable)
      .where(
        and(eq(productsTable.outlet_id, outletId), eq(productsTable.product_name, item.name)),
      )
      .limit(1);

    if (existing) {
      await db.update(productsTable).set(values).where(eq(productsTable.id, existing.id));
      updated += 1;
    } else {
      await db.insert(productsTable).values({ id: randomUUID(), ...values });
      created += 1;
    }

    const label = deliverable
      ? `fixed ${price}`
      : `band ${lowest}–${highest} (haul room ${highest! - lowest!}/${item.unit})`;
    console.log(
      `  ${deliverable ? "kurir " : "sopir "} ${item.name.padEnd(32)} ${(item.group ?? "-").padEnd(18)} ${label}`,
    );
  }

  // outlets.features is derived, so the outlet only becomes browsable under
  // Bahan Bangunan once it actually holds products in that category.
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
