import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import { productsTable, recipeItemsTable, stockMovementsTable } from "../db/schema";
import { postMovement } from "./cost";
import { MAX_RECIPE_DEPTH } from "./stock";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// "Paksa Hitung HPP" — for outlets that never buy through a Faktur, so the cost
// ledger has nothing to average and every recipe sale books Rp 0.
//
// The owner looks at a recipe in Jelajah Resep, corrects what each ingredient
// costs, and those costs are written to the one field a SALE reads for that
// ingredient. Nothing here invents a cost or restates a past sale: COGS is
// frozen when a line sells, so this only changes what sales book from now on.
//
// Where a product's cost lives depends on whether it tracks stock:
//
//   track_stock  -> products.avg_cost, set by a REVALUATION movement (qty 0,
//                   explicit unit cost) through postMovement, so the ledger still
//                   sums to what the shelf is worth and Alur Stok shows who
//                   changed it and when
//   otherwise    -> products.buying_price, the figure typed into the product
//                   form. That form keeps digits only, so this writes whole
//                   rupiah; a "0.9" would come back from the form as Rp 9.
//
// And what a sale of the ROOT books depends on the plan (usesCostLedger):
//
//   no ledger (Pro)       -> the dish's own buying_price, frozen on the line.
//                            The ingredient costs are only the inputs; the
//                            recipe total is written to the dish.
//   ledger, dish tracked  -> the dish's own avg_cost (a batch product). The
//                            recipe total is written there as a revaluation.
//   ledger, dish untracked-> the sum of its stock-tracked ingredients at their
//                            averages — expandRecipe's leaves. An ingredient that
//                            tracks no stock moves nothing and books nothing, so
//                            the recipe total has nowhere to go and is not
//                            written. If NO ingredient tracks stock, the line
//                            leaves no movement at all and falls back to the
//                            dish's buying_price, so that is the target again.
//
// OVERWRITING A REAL AVERAGE. A tracked product that was ever bought on a Faktur
// or made in Produksi carries an average the ledger computed from real events.
// That row is "protected": it is only written when the request says overwrite
// for it, and the dialog leaves it unticked. Opname's HPP awal refuses to touch
// such a row at all; this is the one place allowed to, and only on purpose.

export type CostedProduct = {
  id: string;
  name: string;
  unit: string;
  track_stock: boolean;
  avg_cost: string | number | null;
  buying_price: string;
  deletedAt: Date | null;
};

export type RecipeGraph<P extends CostedProduct = CostedProduct> = {
  byId: Map<string, P>;
  kidsOf: Map<string, { ingredient_id: string; qty: number }[]>;
};

const num = (v: unknown) => Number(v) || 0;

// Same acceptance rule as lib/money-sql.ts money(): buying_price is a varchar
// that is routinely blank, and anything not plainly numeric reads as 0.
const MONEY_RE = /^\s*-?[0-9]+(\.[0-9]+)?\s*$/;
export const moneyNum = (v: unknown) => (typeof v === "string" && MONEY_RE.test(v) ? Number(v) : 0);

// What one unit of a product costs a sale TODAY — no fallback. The explorer
// shows avg_cost || buying_price, which is what the product would cost if the
// ledger knew; this is what it actually books, and the gap between the two is
// the whole reason this file exists.
export const bookedUnitCost = (p: CostedProduct) =>
  p.track_stock ? num(p.avg_cost) : moneyNum(p.buying_price);

export type LeafKind = "stock" | "batch" | "plain";
export type CostLeaf = { product_id: string; qty: number; kind: LeafKind };

// The products whose own cost makes up one unit of the root, walking the way a
// sale does: through ingredients that track no stock and have a recipe (a
// pass-through composite owns no cost of its own), stopping at anything that
// tracks stock (a batch boundary) or has no recipe.
//
// Unlike expandRecipe, a no-stock no-recipe ingredient is KEPT as a "plain"
// leaf. A sale moves nothing for it, but on a plan without the ledger it is
// still part of the dish's cost, and the owner needs to see it either way.
//
// `inTree` is every product the walk touched, so "used by other recipes" can
// leave out the dish's own sub-assemblies. `broken` means a cycle or nesting
// past MAX_RECIPE_DEPTH — the recipe save refuses both, so only old rows get
// here, and a total built from them would be arbitrarily wrong.
export function costLeaves(g: RecipeGraph, rootId: string) {
  const into = new Map<string, CostLeaf>();
  const inTree = new Set<string>();
  let broken = false;
  const walk = (id: string, mult: number, path: string[]) => {
    if (path.length > MAX_RECIPE_DEPTH) {
      broken = true;
      return;
    }
    for (const k of g.kidsOf.get(id) ?? []) {
      const p = g.byId.get(k.ingredient_id);
      const qty = mult * k.qty;
      if (!p || !Number.isFinite(qty) || qty <= 0) continue;
      if (path.includes(p.id)) {
        broken = true;
        continue;
      }
      inTree.add(p.id);
      const hasRecipe = (g.kidsOf.get(p.id)?.length ?? 0) > 0;
      if (!p.track_stock && hasRecipe) {
        walk(p.id, qty, [...path, p.id]);
        continue;
      }
      const hit = into.get(p.id);
      if (hit) hit.qty += qty;
      else into.set(p.id, { product_id: p.id, qty, kind: p.track_stock ? (hasRecipe ? "batch" : "stock") : "plain" });
    }
  };
  walk(rootId, 1, [rootId]);
  return { leaves: [...into.values()], inTree, broken };
}

// What one unit of the root costs from its leaves, each at what it books today.
export function recipeHpp(g: RecipeGraph, leaves: CostLeaf[]) {
  return leaves.reduce((s, l) => {
    const p = g.byId.get(l.product_id);
    return p ? s + l.qty * bookedUnitCost(p) : s;
  }, 0);
}

export type RootTarget = "avg" | "buying" | null;

// Which field of the dish a sale reads its cost from — see the header.
export function rootTarget(root: CostedProduct, leaves: CostLeaf[], ledger: boolean): RootTarget {
  if (!ledger) return "buying";
  if (root.track_stock) return "avg";
  return leaves.some((l) => l.kind !== "plain") ? null : "buying";
}

// What a sale of one unit of the root books right now, mirroring lib/cogs.ts:
// the ledger sum of a line's movements when it has any, else the frozen
// buying_price. null when the recipe is broken and no honest number exists.
export function bookedHpp(g: RecipeGraph, rootId: string, ledger: boolean): number | null {
  const root = g.byId.get(rootId);
  if (!root) return null;
  const { leaves, broken } = costLeaves(g, rootId);
  if (broken) return null;
  const target = rootTarget(root, leaves, ledger);
  if (target === "avg") return num(root.avg_cost);
  if (target === "buying") return moneyNum(root.buying_price);
  return recipeHpp(
    g,
    leaves.filter((l) => l.kind !== "plain"),
  );
}

export class ForceHppError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

type Product = CostedProduct & { price: string; price_mark_down: string | null };

async function loadGraph(tx: Tx, outletId: number): Promise<RecipeGraph<Product>> {
  const [catalogue, edges] = await Promise.all([
    tx
      .select({
        id: productsTable.id,
        name: productsTable.product_name,
        unit: productsTable.unit,
        price: productsTable.price,
        price_mark_down: productsTable.price_mark_down,
        buying_price: productsTable.buying_price,
        avg_cost: productsTable.avg_cost,
        track_stock: productsTable.track_stock,
        deletedAt: productsTable.deletedAt,
      })
      .from(productsTable)
      .where(eq(productsTable.outlet_id, outletId)),
    tx
      .select({
        product_id: recipeItemsTable.product_id,
        ingredient_id: recipeItemsTable.ingredient_id,
        qty: recipeItemsTable.qty,
      })
      .from(recipeItemsTable)
      .where(eq(recipeItemsTable.outlet_id, outletId)),
  ]);
  const byId = new Map(catalogue.map((p) => [p.id, p]));
  const kidsOf = new Map<string, { ingredient_id: string; qty: number }[]>();
  for (const e of edges) {
    const row = { ingredient_id: e.ingredient_id, qty: num(e.qty) };
    const list = kidsOf.get(e.product_id);
    if (list) list.push(row);
    else kidsOf.set(e.product_id, [row]);
  }
  return { byId, kidsOf };
}

export type CostSource = "none" | "invoice" | "production" | "manual";

// Where a tracked product's average came from. "Ever bought / ever produced"
// rather than "the latest event": an average that has had a real purchase
// blended into it is never purely typed again, and the owner should be asked
// every time before it is replaced.
async function avgSources(tx: Tx, outletId: number, ids: string[]) {
  if (!ids.length) return new Map<string, { bought: boolean; produced: boolean }>();
  const rows = await tx
    .select({
      product_id: stockMovementsTable.product_id,
      bought: sql<boolean>`bool_or(${stockMovementsTable.reason} = 'purchase' and ${stockMovementsTable.qty_change} > 0)`,
      produced: sql<boolean>`bool_or(${stockMovementsTable.reason} = 'production' and ${stockMovementsTable.qty_change} > 0)`,
    })
    .from(stockMovementsTable)
    .where(and(eq(stockMovementsTable.outlet_id, outletId), inArray(stockMovementsTable.product_id, ids)))
    .groupBy(stockMovementsTable.product_id);
  return new Map(rows.map((r) => [r.product_id, { bought: !!r.bought, produced: !!r.produced }]));
}

const sourceOf = (
  target: "avg" | "buying",
  current: number,
  src: { bought: boolean; produced: boolean } | undefined,
): CostSource => {
  if (current <= 0) return "none";
  if (target === "buying") return "manual";
  if (src?.bought) return "invoice";
  if (src?.produced) return "production";
  return "manual";
};

const isProtected = (s: CostSource) => s === "invoice" || s === "production";

export type ForceHppRow = {
  product_id: string;
  name: string;
  unit: string;
  // Of this ingredient in ONE unit of the dish.
  qty: number;
  kind: LeafKind;
  target: "avg" | "buying";
  // What the target field holds now — exactly what a sale books for it.
  current: number;
  // A starting value for the input: the current cost when there is one, else
  // the typed buying price, else (for a batch product) what its own recipe costs.
  suggested: number;
  source: CostSource;
  protected: boolean;
  // false = this ingredient's cost does not reach what a sale of the dish books
  // (no stock tracked, on a ledger plan where the dish is costed from its
  // tracked ingredients). Still editable — it is still the product's cost.
  counted: boolean;
  // Other recipes this change reaches, through pass-through composites.
  used_by: string[];
};

async function plan(tx: Tx, outletId: number, productId: string, ledger: boolean) {
  const g = await loadGraph(tx, outletId);
  const root = g.byId.get(productId);
  if (!root || root.deletedAt) throw new ForceHppError(404, "Produk tidak ditemukan.");

  const { leaves, inTree, broken } = costLeaves(g, productId);
  if (broken) {
    throw new ForceHppError(
      409,
      "Resep produk ini berputar atau terlalu dalam, jadi HPP-nya tidak bisa dihitung. Perbaiki resepnya dulu.",
    );
  }
  if (!leaves.length) throw new ForceHppError(409, "Produk ini belum punya resep.");

  const target = rootTarget(root, leaves, ledger);
  const sources = await avgSources(tx, outletId, [productId, ...leaves.map((l) => l.product_id)]);

  const parentsOf = new Map<string, string[]>();
  for (const [parent, kids] of g.kidsOf) {
    for (const k of kids) {
      const list = parentsOf.get(k.ingredient_id);
      if (list) list.push(parent);
      else parentsOf.set(k.ingredient_id, [parent]);
    }
  }
  // A new average reaches every recipe that expands down to this product —
  // through pass-through composites, which own no cost, but not past a
  // stock-tracked one, whose batches keep the average they were made at.
  const usedBy = (leafId: string) => {
    const seen = new Set([leafId]);
    const names: string[] = [];
    const stack = [leafId];
    while (stack.length) {
      for (const parentId of parentsOf.get(stack.pop()!) ?? []) {
        if (seen.has(parentId)) continue;
        seen.add(parentId);
        const p = g.byId.get(parentId);
        if (!p || p.deletedAt) continue;
        if (parentId !== productId && !inTree.has(parentId)) names.push(p.name);
        if (!p.track_stock) stack.push(parentId);
      }
    }
    return names.sort((a, b) => a.localeCompare(b));
  };

  const rows: ForceHppRow[] = leaves
    .map((l) => {
      const p = g.byId.get(l.product_id)!;
      const rowTarget = p.track_stock ? ("avg" as const) : ("buying" as const);
      const current = bookedUnitCost(p);
      const source = sourceOf(rowTarget, current, sources.get(p.id));
      let suggested = current;
      if (suggested <= 0 && l.kind === "batch") {
        const own = costLeaves(g, p.id);
        if (!own.broken) suggested = recipeHpp(g, own.leaves);
      }
      if (suggested <= 0) suggested = moneyNum(p.buying_price);
      if (rowTarget === "buying") suggested = Math.round(suggested);
      return {
        product_id: p.id,
        name: p.name,
        unit: p.unit,
        qty: l.qty,
        kind: l.kind,
        target: rowTarget,
        current,
        suggested,
        source,
        protected: isProtected(source),
        counted: !(target === null && l.kind === "plain"),
        used_by: usedBy(p.id),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const rootCurrent = target === "avg" ? num(root.avg_cost) : target === "buying" ? moneyNum(root.buying_price) : 0;
  const rootSource = target ? sourceOf(target, rootCurrent, sources.get(productId)) : "none";

  return {
    g,
    root,
    leaves,
    rows,
    rootInfo: {
      target,
      current: rootCurrent,
      source: rootSource,
      protected: isProtected(rootSource),
    },
  };
}

export async function previewForceHpp(tx: Tx, args: { outletId: number; productId: string; ledger: boolean }) {
  const { g, root, leaves, rows, rootInfo } = await plan(tx, args.outletId, args.productId, args.ledger);
  return {
    ledger: args.ledger,
    product: {
      id: root.id,
      name: root.name,
      unit: root.unit,
      price: num(root.price_mark_down) || num(root.price),
      track_stock: root.track_stock,
    },
    root: rootInfo,
    booked_hpp: bookedHpp(g, root.id, args.ledger) ?? 0,
    recipe_hpp: recipeHpp(g, leaves),
    rows,
  };
}

export type ForceHppItem = { product_id: string; unit_cost: number; expected: number; overwrite?: boolean };

// Values are compared at avg_cost's own precision (numeric scale 4).
const EPS = 0.00005;
const same = (a: number, b: number) => Math.abs(a - b) < EPS;
const round4 = (n: number) => Number(n.toFixed(4));

// Should this value be written? Applying the same dialog twice is a no-op, not
// an error: a value already at its target is skipped BEFORE the "changed since
// you looked" check, so a double press cannot trip over its own first write.
function judge(
  name: string,
  current: number,
  next: number,
  expected: number,
  prot: boolean,
  overwrite: boolean | undefined,
) {
  if (same(current, next)) return false;
  if (!same(current, expected)) {
    throw new ForceHppError(409, `Biaya ${name} sudah berubah sejak dialog dibuka. Buka ulang Paksa Hitung HPP.`);
  }
  if (prot && overwrite !== true) {
    throw new ForceHppError(
      409,
      `Biaya ${name} berasal dari Faktur atau Produksi. Centang barisnya untuk menimpa.`,
    );
  }
  return true;
}

export async function applyForceHpp(
  tx: Tx,
  args: {
    outletId: number;
    productId: string;
    ledger: boolean;
    items: ForceHppItem[];
    root: { expected: number; overwrite?: boolean } | null;
  },
) {
  const { outletId, productId, ledger, items } = args;

  // Lock every row about to be judged before reading it, so "has this changed
  // since the dialog opened" is answered against the value we then overwrite,
  // not one a concurrent Faktur replaces in between. postMovement takes the
  // same row locks again inside this transaction, which is a no-op.
  await tx
    .select({ id: productsTable.id })
    .from(productsTable)
    .where(
      and(eq(productsTable.outlet_id, outletId), inArray(productsTable.id, [productId, ...items.map((i) => i.product_id)])),
    )
    .orderBy(productsTable.id)
    .for("update");

  const { g, root, leaves, rows, rootInfo } = await plan(tx, outletId, productId, ledger);
  const rowById = new Map(rows.map((r) => [r.product_id, r]));
  const note = `Paksa Hitung HPP · ${root.name}`.slice(0, 255);
  let changed = 0;

  for (const item of items) {
    const row = rowById.get(item.product_id);
    if (!row) throw new ForceHppError(400, "Ada bahan yang bukan bagian dari resep ini.");
    const p = g.byId.get(row.product_id)!;
    const next = row.target === "buying" ? Math.round(item.unit_cost) : round4(item.unit_cost);
    if (!(next > 0)) {
      throw new ForceHppError(
        400,
        row.target === "buying"
          ? `Biaya ${row.name} minimal Rp 1 — bahan tanpa Lacak Stok disimpan dalam rupiah bulat.`
          : `Biaya ${row.name} harus lebih dari 0.`,
      );
    }
    if (!judge(row.name, row.current, next, item.expected, row.protected, item.overwrite)) continue;

    if (row.target === "avg") {
      await postMovement(tx, { outletId, productId: p.id, qtyChange: 0, unitCost: next, reason: "adjustment", note });
      p.avg_cost = next;
    } else {
      await tx.update(productsTable).set({ buying_price: String(next) }).where(eq(productsTable.id, p.id));
      p.buying_price = String(next);
    }
    changed++;
  }

  // The dish itself, at the recipe total built from the costs just written.
  if (args.root) {
    if (!rootInfo.target) {
      throw new ForceHppError(400, "HPP produk ini diambil dari bahan berstoknya, jadi tidak ada yang disimpan ke produknya.");
    }
    const hpp = recipeHpp(g, leaves);
    const next = rootInfo.target === "buying" ? Math.round(hpp) : round4(hpp);
    if (!(next > 0)) {
      throw new ForceHppError(409, "HPP resep masih Rp 0 — isi dulu biaya bahannya.");
    }
    if (judge(root.name, rootInfo.current, next, args.root.expected, rootInfo.protected, args.root.overwrite)) {
      if (rootInfo.target === "avg") {
        await postMovement(tx, { outletId, productId, qtyChange: 0, unitCost: next, reason: "adjustment", note });
        root.avg_cost = next;
      } else {
        await tx.update(productsTable).set({ buying_price: String(next) }).where(eq(productsTable.id, productId));
        root.buying_price = String(next);
      }
      changed++;
    }
  }

  return { changed, booked_hpp: bookedHpp(g, productId, ledger) ?? 0, recipe_hpp: recipeHpp(g, leaves) };
}

// ── One product, no recipe ──────────────────────────────────────────────────
// Jelajah Barang Jadi's override, for a product nothing is made FROM — a bahan
// bought as it is. It is an ingredient row with the recipe taken away, so it
// follows the ingredient row's rules exactly: tracked -> avg_cost by
// revaluation, otherwise buying_price in whole rupiah, and an average fed by a
// Faktur or a Produksi is protected.
//
// A product WITH a recipe is refused. Its cost is its recipe's, and the place
// to set it is Paksa Hitung HPP on that recipe, which writes the ingredients
// and the dish together — two doors to one number would let them disagree.

async function singleTarget(tx: Tx, outletId: number, productId: string) {
  const [p] = await tx
    .select({
      id: productsTable.id,
      name: productsTable.product_name,
      unit: productsTable.unit,
      track_stock: productsTable.track_stock,
      avg_cost: productsTable.avg_cost,
      buying_price: productsTable.buying_price,
      deletedAt: productsTable.deletedAt,
    })
    .from(productsTable)
    .where(and(eq(productsTable.id, productId), eq(productsTable.outlet_id, outletId)))
    .limit(1);
  if (!p || p.deletedAt) throw new ForceHppError(404, "Produk tidak ditemukan.");

  const [hasRecipe] = await tx
    .select({ id: recipeItemsTable.id })
    .from(recipeItemsTable)
    .where(and(eq(recipeItemsTable.product_id, productId), eq(recipeItemsTable.outlet_id, outletId)))
    .limit(1);
  if (hasRecipe) {
    throw new ForceHppError(409, "Produk ini punya resep — atur HPP-nya lewat Paksa Hitung HPP di Jelajah Resep.");
  }

  const target = p.track_stock ? ("avg" as const) : ("buying" as const);
  const current = bookedUnitCost(p);
  const source = sourceOf(target, current, (await avgSources(tx, outletId, [p.id])).get(p.id));
  let suggested = current > 0 ? current : moneyNum(p.buying_price);
  if (target === "buying") suggested = Math.round(suggested);
  return {
    product: { id: p.id, name: p.name, unit: p.unit, track_stock: p.track_stock },
    target,
    current,
    suggested,
    source,
    protected: isProtected(source),
  };
}

export const previewUnitCost = (tx: Tx, args: { outletId: number; productId: string }) =>
  singleTarget(tx, args.outletId, args.productId);

export async function applyUnitCost(
  tx: Tx,
  args: { outletId: number; productId: string; unitCost: number; expected: number; overwrite?: boolean },
) {
  const { outletId, productId } = args;
  // Locked before it is judged, for the same reason applyForceHpp locks: the
  // "changed since you looked" answer must be about the value we overwrite.
  await tx
    .select({ id: productsTable.id })
    .from(productsTable)
    .where(and(eq(productsTable.id, productId), eq(productsTable.outlet_id, outletId)))
    .for("update");

  const info = await singleTarget(tx, outletId, productId);
  const next = info.target === "buying" ? Math.round(args.unitCost) : round4(args.unitCost);
  if (!(next > 0)) {
    throw new ForceHppError(
      400,
      info.target === "buying"
        ? `Biaya ${info.product.name} minimal Rp 1 — produk tanpa Lacak Stok disimpan dalam rupiah bulat.`
        : `Biaya ${info.product.name} harus lebih dari 0.`,
    );
  }
  if (!judge(info.product.name, info.current, next, args.expected, info.protected, args.overwrite)) {
    return { changed: 0, unit_cost: info.current };
  }

  if (info.target === "avg") {
    await postMovement(tx, {
      outletId,
      productId,
      qtyChange: 0,
      unitCost: next,
      reason: "adjustment",
      note: "Paksa Hitung HPP · Jelajah Barang Jadi",
    });
  } else {
    await tx.update(productsTable).set({ buying_price: String(next) }).where(eq(productsTable.id, productId));
  }
  return { changed: 1, unit_cost: next };
}
