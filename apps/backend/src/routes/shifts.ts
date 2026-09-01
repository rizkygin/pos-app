import type { FastifyInstance } from "fastify";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "../db";
import { cashierShiftsTable, usersTable } from "../db/schema";
import { hasFeature, requireOutletAccess } from "../lib/outlet-access";
import { buildShiftReport, getOpenShift, listRecentShifts } from "../lib/shift";
import { money } from "../lib/money-sql";

/**
 * Cashier shifts: open the drawer with a float, close it with a count.
 *
 * Gated on the `cashier` permission throughout, not on owner. The person who
 * opens the drawer is the person standing at it, and making them fetch the
 * owner to close their own shift is how you get a shift that is never closed
 * and a report nobody ever prints. Owners pass the check too.
 *
 * Everything here is scoped to the caller's own outlet — the shift id in the
 * URL is checked against it, never trusted on its own, or one outlet could read
 * another's takings by guessing a number.
 *
 * PLAN GATING: only OPENING a shift requires the `cashierShift` feature (Max
 * Lite and up). Closing, reading the current shift and reprinting a past slip
 * are deliberately ungated — a merchant who downgrades, or whose plan lapses,
 * with a shift still open must be able to count the drawer and close it. The
 * alternative is a till that can never be reconciled and takings stranded
 * behind a paywall, which is the same "data held hostage" the expiry rules
 * elsewhere are written to avoid.
 */

const SHIFT_FEATURE = "cashierShift";
const SHIFT_UPGRADE_MESSAGE =
  "Buka Shift tersedia mulai paket Max Lite — upgrade paket untuk membukanya.";

/** Money off the wire: accepts a number or a numeric string, rejects the rest. */
function parseAmount(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) && v >= 0 ? v : null;
  if (typeof v === "string") {
    const trimmed = v.replace(/[\s.,]/g, (m) => (m === "," ? "." : ""));
    if (!/^-?\d+(\.\d+)?$/.test(trimmed)) return null;
    const n = Number(trimmed);
    return Number.isFinite(n) && n >= 0 ? n : null;
  }
  return null;
}

export async function shiftRoutes(app: FastifyInstance) {
  /**
   * The open shift and its live figures, or `{ shift: null }`.
   *
   * The cashier screen polls this to decide whether it shows "Buka Shift" or a
   * running drawer, so it answers with the whole report rather than a bare row:
   * the running expected-cash total is the number that stops a cashier being
   * surprised at closing time.
   */
  app.get("/api/shifts/current", async (request, reply) => {
    const access = await requireOutletAccess(request, reply, "cashier");
    if (!access) return;

    // Reported alongside so the shift strip knows whether to offer "Buka Shift"
    // or the upgrade prompt. An outlet that opened a shift and then downgraded
    // still gets its running shift back here — see the gating note above.
    const canOpen = hasFeature(access.gate, SHIFT_FEATURE);

    const open = await getOpenShift(db, access.outlet.id);
    if (!open) return { success: true, shift: null, canOpen };

    const report = await buildShiftReport(open.id, access.outlet.id);
    return { success: true, shift: report, canOpen };
  });

  /** Recent shifts, for reprinting a slip that jammed or went missing. */
  app.get("/api/shifts", async (request, reply) => {
    const access = await requireOutletAccess(request, reply, "cashier");
    if (!access) return;

    const q = request.query as Record<string, string>;
    const limit = Math.min(50, Math.max(1, Number(q.limit) || 10));
    const rows = await listRecentShifts(access.outlet.id, limit);

    return {
      success: true,
      shifts: rows.map((r) => ({
        id: r.id,
        cashierName: r.cashierName,
        // ISO strings; the browser renders them in the viewer's timezone.
        openedAt: new Date(r.openedAt).toISOString(),
        closedAt: r.closedAt ? new Date(r.closedAt).toISOString() : null,
        expectedCash: r.expectedCash === null ? null : Number(r.expectedCash),
        countedCash: r.countedCash === null ? null : Number(r.countedCash),
        variance: r.variance === null ? null : Number(r.variance),
      })),
    };
  });

  /** One shift's full report. Works for open and closed shifts alike. */
  app.get("/api/shifts/:shiftId/report", async (request, reply) => {
    const access = await requireOutletAccess(request, reply, "cashier");
    if (!access) return;

    const { shiftId } = request.params as { shiftId: string };
    const id = Number(shiftId);
    if (!Number.isInteger(id)) {
      return reply.status(400).send({ success: false, error: "Shift tidak dikenal" });
    }

    const report = await buildShiftReport(id, access.outlet.id);
    // Another outlet's shift is "not found", not "forbidden": confirming the id
    // exists is itself a leak.
    if (!report) {
      return reply.status(404).send({ success: false, error: "Shift tidak ditemukan" });
    }
    return { success: true, shift: report };
  });

  /**
   * Open a shift with the float that was put in the drawer.
   *
   * The float is recorded here and NOWHERE else — deliberately not as a
   * cash-in. It is money moved into a till, not income, and booking it in the
   * ledger would inflate the day's revenue and double count itself into this
   * report's own "Total Tunai Masuk". See db/schema.ts.
   */
  app.post("/api/shifts/open", async (request, reply) => {
    const access = await requireOutletAccess(request, reply, "cashier");
    if (!access) return;

    if (!hasFeature(access.gate, SHIFT_FEATURE)) {
      return reply
        .status(403)
        .send({ success: false, error: SHIFT_UPGRADE_MESSAGE, code: "PLAN_FEATURE" });
    }

    const body = (request.body as any) ?? {};
    const openingFloat = parseAmount(body.openingFloat ?? 0);
    if (openingFloat === null) {
      return reply.status(400).send({ success: false, error: "Modal awal tidak valid" });
    }

    // The name is frozen on the row so a later rename can't rewrite shifts that
    // are already closed. Falls back to the signed-in user, same rule the POS
    // uses for orders.note.cashierName.
    let cashierName: string | null =
      typeof body.cashierName === "string" && body.cashierName.trim() !== ""
        ? body.cashierName.trim().slice(0, 100)
        : null;
    if (!cashierName) {
      const [actor] = await db
        .select({ name: usersTable.name })
        .from(usersTable)
        .where(eq(usersTable.id, access.userId))
        .limit(1);
      cashierName = actor?.name?.trim().slice(0, 100) || "Kasir";
    }

    try {
      const [shift] = await db
        .insert(cashierShiftsTable)
        .values({
          outlet_id: access.outlet.id,
          user_id: access.userId,
          cashier_name: cashierName,
          opening_float: openingFloat.toFixed(2),
        })
        .returning({ id: cashierShiftsTable.id });

      const report = await buildShiftReport(shift.id, access.outlet.id);
      return { success: true, shift: report };
    } catch (err: any) {
      // The partial unique index caught a second open shift. Two cashiers
      // tapping "Buka Shift" at the same counter is the ordinary cause, so
      // answer with the shift that already exists rather than an error the
      // second one can do nothing about.
      const pgCode = err?.code ?? err?.cause?.code;
      if (pgCode === "23505") {
        const open = await getOpenShift(db, access.outlet.id);
        if (open) {
          const report = await buildShiftReport(open.id, access.outlet.id);
          return reply.status(409).send({
            success: false,
            error: "Shift sudah dibuka",
            shift: report,
          });
        }
      }
      request.log.error(err);
      return reply.status(500).send({ success: false, error: "Gagal membuka shift" });
    }
  });

  /**
   * Close the shift against a physical count of the drawer.
   *
   * Expected, counted and variance are all frozen onto the row here rather than
   * recomputed on every read. The count is a statement about one moment; a
   * cancellation booked ten minutes later must not silently redraw a
   * discrepancy the cashier already signed for.
   */
  app.post("/api/shifts/close", async (request, reply) => {
    const access = await requireOutletAccess(request, reply, "cashier");
    if (!access) return;

    const body = (request.body as any) ?? {};
    const countedCash = parseAmount(body.countedCash);
    if (countedCash === null) {
      return reply
        .status(400)
        .send({ success: false, error: "Jumlah uang di laci tidak valid" });
    }
    const closingNote =
      typeof body.note === "string" && body.note.trim() !== ""
        ? body.note.trim().slice(0, 255)
        : null;

    const result = await db.transaction(async (tx) => {
      // FOR UPDATE: two devices hitting "Tutup Shift" together would otherwise
      // both read it as open and both write a closing count, and the second
      // one's numbers would win silently.
      const [shift] = await tx
        .select({ id: cashierShiftsTable.id, openingFloat: cashierShiftsTable.opening_float })
        .from(cashierShiftsTable)
        .where(
          and(
            eq(cashierShiftsTable.outlet_id, access.outlet.id),
            isNull(cashierShiftsTable.closed_at),
          ),
        )
        .limit(1)
        .for("update");

      if (!shift) return { status: 409 as const, error: "Tidak ada shift yang terbuka" };

      // The drawer's own arithmetic, read inside the same transaction the close
      // is written in, so nothing can land between the count and the freeze.
      const cash = await tx.execute(sql`
        select coalesce(sum(case when ci.type = 'cash'
                                 then ${money(sql`ci.money_amount`)} else 0 end), 0)::float8 as cash_in,
               coalesce(sum(case when co.type = 'cash'
                                 then ${money(sql`co.money_amount`)} else 0 end), 0)::float8 as cash_out
          from "cashFlows" cf
          left join "cashInDetailTable"  ci on ci.id = cf.cash_in_detail_id
          left join "cashOutDetailTable" co on co.id = cf.cash_out_detail_id
         where cf.shift_id = ${shift.id}
      `);
      const cashIn = Number((cash.rows[0] as any)?.cash_in ?? 0);
      const cashOut = Number((cash.rows[0] as any)?.cash_out ?? 0);
      const expected = Number(shift.openingFloat ?? 0) + cashIn - cashOut;

      await tx
        .update(cashierShiftsTable)
        .set({
          closed_at: new Date(),
          counted_cash: countedCash.toFixed(2),
          expected_cash: expected.toFixed(2),
          // Negative = kurang (short), positive = lebih (over).
          variance: (countedCash - expected).toFixed(2),
          closing_note: closingNote,
        })
        .where(eq(cashierShiftsTable.id, shift.id));

      return { status: 200 as const, shiftId: shift.id };
    });

    if (result.status !== 200) {
      return reply.status(result.status).send({ success: false, error: result.error });
    }

    const report = await buildShiftReport(result.shiftId, access.outlet.id);
    return { success: true, shift: report };
  });
}
