import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { and, count, eq, inArray, isNull } from "drizzle-orm";
import { db } from "../db";
import {
  productsTable,
  stockOpnameLinesTable,
  stockOpnameSessionsTable,
  usersTable,
} from "../db/schema";
import { requireOutletAccess } from "../lib/outlet-access";
import { HttpError } from "../lib/tables";
import {
  MAX_BACKDATE_DAYS,
  REASON_CODES,
  classify,
  lastCountedAt,
  linesWithSystem,
  postCount,
  round3,
  stockAt,
  unitCostOf,
} from "../lib/opname";

/**
 * Stock opname SESSIONS — a count that may take days while the shop sells.
 *
 * Start a session, save counts in as many sittings as it takes (any device,
 * any employee holding `stock`), then finish it. Each count is compared with
 * the system stock at the moment it was counted, so a sale made halfway
 * through the count is not booked as shrinkage. Nothing touches stock until
 * FINISH, which posts one adjustment per differing line, dated at its count.
 *
 * A count may be dated up to MAX_BACKDATE_DAYS back ("we counted on paper
 * yesterday"), but never before the product's last count: that one already
 * corrected the stock, and reconciling against the stock before it would book
 * the same difference twice.
 *
 * The one-shot POST /api/stock/opname (routes/invoices.ts) still exists and
 * is a count dated now; it shares postCount with FINISH here.
 */

const STOCK = "stock" as const;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Clock skew tolerated between a phone and the server before "future" is refused. */
const SKEW_MS = 2 * 60 * 1000;
const MAX_ITEMS = 2000;

type Session = typeof stockOpnameSessionsTable.$inferSelect;

async function handle(reply: FastifyReply, fn: () => Promise<unknown>) {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof HttpError) {
      return reply.status(err.status).send({ success: false, error: err.message, code: err.code });
    }
    throw err;
  }
}

const iso = (d: Date | null | undefined) => (d ? new Date(d).toISOString() : null);

/**
 * Why a count was not saved. Codes, not sentences with a date baked in: the
 * page words them in the viewer's own timezone.
 *   invalid        the quantity is not a number >= 0
 *   invalid_time   the item's own counted_at is unreadable, in the future or
 *                  older than MAX_BACKDATE_DAYS
 *   counted_later  the product was already counted at `lastCountedAt`, which
 *                  is not before this count's time
 */
type Rejected = {
  productId: string;
  productName: string;
  reason: "invalid" | "invalid_time" | "counted_later";
  lastCountedAt?: string;
};

function sessionParam(request: FastifyRequest): number {
  const id = Number((request.params as Record<string, string>).id);
  if (!Number.isInteger(id) || id < 1) throw new HttpError(400, "Sesi opname tidak valid");
  return id;
}

/**
 * When a count happened: the time sent, or now. Refused when it is in the
 * future or older than MAX_BACKDATE_DAYS.
 */
function parseCountedAt(raw: unknown): Date {
  const now = Date.now();
  if (raw == null || raw === "") return new Date(now);
  const d = new Date(String(raw));
  if (Number.isNaN(d.getTime())) throw new HttpError(400, "Waktu hitung tidak valid");
  if (d.getTime() > now + SKEW_MS) throw new HttpError(400, "Waktu hitung tidak boleh di masa depan");
  if (d.getTime() < now - MAX_BACKDATE_DAYS * DAY_MS) {
    throw new HttpError(400, `Waktu hitung paling jauh ${MAX_BACKDATE_DAYS} hari ke belakang`);
  }
  return d.getTime() > now ? new Date(now) : d;
}

/** The session, scoped to the outlet; optionally locked and required open. */
async function loadSession(
  q: typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0],
  outletId: number,
  id: number,
  opts: { lock?: boolean; open?: boolean } = {},
): Promise<Session> {
  const base = q
    .select()
    .from(stockOpnameSessionsTable)
    .where(and(eq(stockOpnameSessionsTable.id, id), eq(stockOpnameSessionsTable.outlet_id, outletId)))
    .limit(1);
  const [s] = opts.lock ? await base.for("update") : await base;
  if (!s) throw new HttpError(404, "Sesi opname tidak ditemukan");
  if (opts.open && s.status !== "open") {
    throw new HttpError(409, "Sesi opname ini sudah selesai atau dibatalkan", "not_open");
  }
  return s;
}

/**
 * The session as the page draws it. An open session's system stock and
 * difference are computed now, from the ledger; a finished one shows what
 * was booked.
 */
async function sessionView(session: Session) {
  const lines = await linesWithSystem(db, session.id);
  const userIds = [
    ...new Set(
      [session.started_by, session.finished_by, ...lines.map((l) => l.counted_by)].filter(
        (u): u is string => !!u,
      ),
    ),
  ];
  const users = userIds.length
    ? await db
        .select({ id: usersTable.id, name: usersTable.name })
        .from(usersTable)
        .where(inArray(usersTable.id, userIds))
    : [];
  const nameOf = (id: string | null) => (id ? (users.find((u) => u.id === id)?.name ?? null) : null);
  const live = session.status === "open";
  // How many products this session is answerable for. Finishing needs an
  // answer for every one of them, so the page's "N belum dihitung" has to be
  // measured against the same number the finish gate uses.
  const [{ total } = { total: 0 }] = await db
    .select({ total: count() })
    .from(productsTable)
    .where(
      and(
        eq(productsTable.outlet_id, session.outlet_id),
        eq(productsTable.track_stock, true),
        isNull(productsTable.deletedAt),
      ),
    );

  return {
    id: session.id,
    // "OP-0009" — something a person can say out loud when two counts are
    // being discussed. The id is the real handle.
    code: `OP-${String(session.id).padStart(4, "0")}`,
    note: session.note,
    status: session.status,
    startedAt: iso(session.started_at),
    startedBy: nameOf(session.started_by),
    finishedAt: iso(session.finished_at),
    finishedBy: nameOf(session.finished_by),
    productCount: total,
    lines: lines.map((l) => {
      const skipped = l.skipped;
      const counted = l.counted == null ? null : Number(l.counted);
      const system = live
        ? round3(Number(l.stock) - Number(l.after))
        : l.system_qty == null
          ? null
          : Number(l.system_qty);
      const delta =
        skipped || counted == null
          ? null
          : live
            ? system == null
              ? null
              : round3(counted - system)
            : l.delta == null
              ? null
              : Number(l.delta);
      const unitCost = unitCostOf(l.avg_cost, l.buying_price, l.unit_cost);
      return {
        productId: l.product_id,
        productName: l.product_name,
        // Whatever code the outlet put on the product. products has no SKU
        // column; `barcode` is the one per-outlet-unique code there is.
        code: l.barcode,
        unit: l.unit,
        counted,
        skipped,
        reason: l.reason,
        countedAt: iso(l.counted_at),
        countedBy: nameOf(l.counted_by),
        unitCost: l.unit_cost == null ? null : Number(l.unit_cost),
        systemQty: skipped ? null : system,
        delta,
        // What this difference does to the value of the shelf, and whether it
        // is big enough to owe an explanation.
        impact: delta == null ? null : Math.round(delta * unitCost),
        tone: delta == null ? null : classify(delta, system ?? 0, unitCost),
        // No longer counted by FINISH: the product was deleted or stopped
        // tracking stock after this line was saved.
        dropped: !l.track_stock || l.deleted_at != null,
      };
    }),
  };
}

async function openSession(outletId: number): Promise<Session | null> {
  const [s] = await db
    .select()
    .from(stockOpnameSessionsTable)
    .where(and(eq(stockOpnameSessionsTable.outlet_id, outletId), eq(stockOpnameSessionsTable.status, "open")))
    .limit(1);
  return s ?? null;
}

export async function stockOpnameRoutes(app: FastifyInstance) {
  // The outlet's open session, or null. The Stok page asks on load to decide
  // between "Mulai Opname" and "Lanjutkan Opname".
  app.get("/api/stock/opname-sessions/current", async (request, reply) => {
    const access = await requireOutletAccess(request, reply, STOCK);
    if (!access) return;
    const s = await openSession(access.outlet.id);
    return { success: true, session: s ? await sessionView(s) : null };
  });

  // Start a session — or return the one already open, so a second device
  // pressing the same button joins it instead of failing.
  app.post("/api/stock/opname-sessions", async (request, reply) => {
    const access = await requireOutletAccess(request, reply, STOCK);
    if (!access) return;
    const note = String((request.body as { note?: unknown } | null)?.note ?? "")
      .trim()
      .slice(0, 255);
    const existing = await openSession(access.outlet.id);
    if (existing) return { success: true, session: await sessionView(existing) };
    try {
      const [s] = await db
        .insert(stockOpnameSessionsTable)
        .values({ outlet_id: access.outlet.id, note, started_by: access.userId })
        .returning();
      return { success: true, session: await sessionView(s) };
    } catch (err: any) {
      // Lost a race with another device: the partial unique index kept it to one.
      if ((err?.code ?? err?.cause?.code) === "23505") {
        const s = await openSession(access.outlet.id);
        if (s) return { success: true, session: await sessionView(s) };
      }
      throw err;
    }
  });

  app.patch("/api/stock/opname-sessions/:id", async (request, reply) => {
    const access = await requireOutletAccess(request, reply, STOCK);
    if (!access) return;
    return handle(reply, async () => {
      const id = sessionParam(request);
      await loadSession(db, access.outlet.id, id, { open: true });
      const note = String((request.body as { note?: unknown } | null)?.note ?? "")
        .trim()
        .slice(0, 255);
      const [s] = await db
        .update(stockOpnameSessionsTable)
        .set({ note })
        .where(eq(stockOpnameSessionsTable.id, id))
        .returning();
      return { success: true, session: await sessionView(s) };
    });
  });

  // Save counts. Re-saving a product replaces its count and its time. Every
  // item is judged on its own: a product that cannot be counted at that time
  // comes back in `rejected` with the reason, and the rest are saved.
  app.put("/api/stock/opname-sessions/:id/lines", async (request, reply) => {
    const access = await requireOutletAccess(request, reply, STOCK);
    if (!access) return;
    return handle(reply, async () => {
      const id = sessionParam(request);
      const body = (request.body ?? {}) as {
        counted_at?: string | null;
        // An item's own counted_at wins over the batch's. The page sends one
        // only to re-save a line without moving its time — an HPP typed after
        // the count.
        items?: {
          product_id?: string;
          counted?: number | string;
          unit_cost?: number | string | null;
          counted_at?: string | null;
          // "Tidak bisa dihitung" — an answer that adjusts nothing. Sent
          // instead of a count, never alongside one.
          skipped?: boolean;
          // One of REASON_CODES; anything else is dropped rather than stored.
          reason?: string | null;
        }[];
      };
      const items = Array.isArray(body.items) ? body.items.slice(0, MAX_ITEMS) : [];
      if (items.length === 0) throw new HttpError(400, "Tidak ada hitungan");
      const countedAt = parseCountedAt(body.counted_at);

      const rejected: Rejected[] = [];
      await db.transaction(async (tx) => {
        await loadSession(tx, access.outlet.id, id, { lock: true, open: true });

        const ids = [...new Set(items.map((i) => i.product_id).filter((x): x is string => !!x))];
        const products = ids.length
          ? await tx
              .select({ id: productsTable.id, name: productsTable.product_name })
              .from(productsTable)
              .where(
                and(
                  inArray(productsTable.id, ids),
                  eq(productsTable.outlet_id, access.outlet.id),
                  eq(productsTable.track_stock, true),
                  isNull(productsTable.deletedAt),
                ),
              )
          : [];
        const nameOf = new Map(products.map((p) => [p.id, p.name]));
        const last = await lastCountedAt(tx, [...nameOf.keys()]);

        const seen = new Set<string>();
        for (const it of items) {
          const pid = it.product_id;
          if (!pid || seen.has(pid)) continue;
          seen.add(pid);
          const name = nameOf.get(pid);
          if (!name) continue; // not this outlet's, or not stock-tracked
          const skipped = it.skipped === true;
          const counted = Number(it.counted);
          if (!skipped && (!Number.isFinite(counted) || counted < 0 || counted > 1e9)) {
            rejected.push({ productId: pid, productName: name, reason: "invalid" });
            continue;
          }
          let at = countedAt;
          if (it.counted_at) {
            try {
              at = parseCountedAt(it.counted_at);
            } catch {
              rejected.push({ productId: pid, productName: name, reason: "invalid_time" });
              continue;
            }
          }
          const prev = last.get(pid);
          if (prev && prev >= at) {
            rejected.push({
              productId: pid,
              productName: name,
              reason: "counted_later",
              lastCountedAt: prev.toISOString(),
            });
            continue;
          }
          const cost = Number(it.unit_cost);
          const unitCost = Number.isFinite(cost) && cost > 0 ? cost.toFixed(4) : null;
          // A skipped line carries no count and no reason: "nobody could
          // count it" is the whole answer, and the DB check enforces the pair.
          const qty = skipped ? null : String(round3(counted));
          const why = !skipped && it.reason && REASON_CODES[it.reason] ? it.reason : null;
          await tx
            .insert(stockOpnameLinesTable)
            .values({
              session_id: id,
              product_id: pid,
              counted: qty,
              skipped,
              reason: why,
              counted_at: at,
              counted_by: access.userId,
              unit_cost: unitCost,
            })
            .onConflictDoUpdate({
              target: [stockOpnameLinesTable.session_id, stockOpnameLinesTable.product_id],
              set: {
                counted: qty,
                skipped,
                reason: why,
                counted_at: at,
                counted_by: access.userId,
                unit_cost: unitCost,
                updated_at: new Date(),
              },
            });
        }
      });

      const s = await loadSession(db, access.outlet.id, id);
      return { success: true, session: await sessionView(s), rejected };
    });
  });

  // Take a count back out of the session — the product is simply not counted.
  app.delete("/api/stock/opname-sessions/:id/lines/:productId", async (request, reply) => {
    const access = await requireOutletAccess(request, reply, STOCK);
    if (!access) return;
    return handle(reply, async () => {
      const id = sessionParam(request);
      const { productId } = request.params as { productId: string };
      const s = await loadSession(db, access.outlet.id, id, { open: true });
      await db
        .delete(stockOpnameLinesTable)
        .where(and(eq(stockOpnameLinesTable.session_id, id), eq(stockOpnameLinesTable.product_id, productId)));
      return { success: true, session: await sessionView(s) };
    });
  });

  // Book it. One adjustment per line that differs from the system stock at
  // its counted_at, dated at that time.
  //
  // Two gates before anything is written, both re-checked here rather than
  // trusted from the page: every product must have an ANSWER (a count or an
  // explicit skip), and every difference over tolerance must carry a reason.
  // A skipped line adjusts nothing.
  app.post("/api/stock/opname-sessions/:id/finish", async (request, reply) => {
    const access = await requireOutletAccess(request, reply, STOCK);
    if (!access) return;
    return handle(reply, async () => {
      const id = sessionParam(request);
      const result = await db.transaction(async (tx) => {
        const session = await loadSession(tx, access.outlet.id, id, { lock: true, open: true });
        const answered = (await linesWithSystem(tx, id)).filter(
          (l) => l.track_stock && l.deleted_at == null,
        );
        if (answered.length === 0) throw new HttpError(400, "Belum ada barang yang dihitung");

        // Every tracked product needs an answer. Counting what you reached and
        // finishing would silently declare the rest correct.
        const [{ total } = { total: 0 }] = await tx
          .select({ total: count() })
          .from(productsTable)
          .where(
            and(
              eq(productsTable.outlet_id, access.outlet.id),
              eq(productsTable.track_stock, true),
              isNull(productsTable.deletedAt),
            ),
          );
        const missing = total - answered.length;
        if (missing > 0) {
          throw new HttpError(
            409,
            `${missing} barang belum dihitung. Hitung dulu, atau tandai "tidak bisa dihitung".`,
            "incomplete",
          );
        }

        const lines = answered.filter((l) => !l.skipped);

        // A difference big enough to matter has to say why before it rewrites
        // the shelf. Measured on the server so the page cannot wave it through.
        const unexplained = lines.filter((l) => {
          const system = round3(Number(l.stock) - Number(l.after));
          const delta = round3(Number(l.counted) - system);
          if (delta === 0) return false;
          const tone = classify(delta, system, unitCostOf(l.avg_cost, l.buying_price, l.unit_cost));
          return tone === "major" && !l.reason;
        });
        if (unexplained.length > 0) {
          throw new HttpError(
            409,
            `Selisih besar belum diberi alasan: ${unexplained.map((l) => l.product_name).join(", ")}.`,
            "needs_reason",
          );
        }

        // Re-checked here, not only when the count was saved: a one-shot
        // opname may have been done since, and it corrected the same stock.
        const last = await lastCountedAt(
          tx,
          lines.map((l) => l.product_id),
        );
        const stale = lines.filter((l) => {
          const prev = last.get(l.product_id);
          return prev && prev >= new Date(l.counted_at);
        });
        if (stale.length > 0) {
          throw new HttpError(
            409,
            `Sudah diopname lagi sesudah dihitung: ${stale.map((l) => l.product_name).join(", ")}. ` +
              "Hitung ulang atau hapus barang ini dari sesi.",
            "stale",
          );
        }

        const note = session.note.trim() || "Opname";
        let adjusted = 0;
        for (const l of lines) {
          // linesWithSystem read stock and the movements after counted_at in
          // one statement, so this is consistent even if a sale lands now:
          // postCount applies the delta as an increment on whatever the stock
          // is by then.
          const system = round3(Number(l.stock) - Number(l.after));
          const delta = round3(Number(l.counted) - system);
          // The reason rides along on the movement, so Riwayat Opname and
          // Alur Stok say WHY the shelf changed, not just that it did.
          const why = l.reason ? REASON_CODES[l.reason] : null;
          const touched = await postCount(tx, {
            outletId: access.outlet.id,
            product: { id: l.product_id, stock: l.stock, avg_cost: l.avg_cost, unit: l.unit },
            delta,
            typedCost: l.unit_cost == null ? null : Number(l.unit_cost),
            note: why ? `${note} · ${why}`.slice(0, 255) : note,
            createdAt: new Date(l.counted_at),
          });
          if (touched) adjusted++;
          await tx
            .update(stockOpnameLinesTable)
            .set({ system_qty: String(system), delta: String(delta) })
            .where(
              and(eq(stockOpnameLinesTable.session_id, id), eq(stockOpnameLinesTable.product_id, l.product_id)),
            );
        }

        await tx
          .update(stockOpnameSessionsTable)
          .set({ status: "finished", finished_at: new Date(), finished_by: access.userId })
          .where(eq(stockOpnameSessionsTable.id, id));
        return { adjusted, counted: lines.length, skipped: answered.length - lines.length };
      });
      return { success: true, ...result };
    });
  });

  // Throw the session away. Nothing was ever booked; the lines stay as a record.
  app.post("/api/stock/opname-sessions/:id/cancel", async (request, reply) => {
    const access = await requireOutletAccess(request, reply, STOCK);
    if (!access) return;
    return handle(reply, async () => {
      const id = sessionParam(request);
      await loadSession(db, access.outlet.id, id, { open: true });
      await db
        .update(stockOpnameSessionsTable)
        .set({ status: "cancelled", finished_at: new Date(), finished_by: access.userId })
        .where(eq(stockOpnameSessionsTable.id, id));
      return { success: true };
    });
  });

  // System stock of every tracked product at a past moment, so a count typed
  // from yesterday's paper can be compared with yesterday's stock before it is
  // saved. `at` is an ISO timestamp.
  app.get("/api/stock/system-at", async (request, reply) => {
    const access = await requireOutletAccess(request, reply, STOCK);
    if (!access) return;
    return handle(reply, async () => {
      const at = parseCountedAt((request.query as { at?: string }).at);
      return { success: true, at: at.toISOString(), data: await stockAt(db, access.outlet.id, at) };
    });
  });
}
