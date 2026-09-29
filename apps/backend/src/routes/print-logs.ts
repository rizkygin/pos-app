import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { printLogsTable, tableSessionsTable } from "../db/schema";
import { requireOutletAccess } from "../lib/outlet-access";
import { TAB_KEY } from "../lib/kitchen";
import {
  PRINT_KINDS,
  parsePrintLine,
  printLogReport,
  type PrintKind,
  type PrintLine,
} from "../lib/print-log";

/**
 * Print logs — one row per press of Cetak on a slip printed before its sale is
 * booked. Checkout pays the row off (linkPrintLogs in lib/print-log.ts); the
 * ones it never reaches are the slips handed over and not paid.
 *
 * PERMISSIONS. Whoever can print the slip can log it: the till (`cashier`) for
 * its pre-checkout struk, the floor (`tables`) for Cetak Bill. The owner passes
 * both. Not plan-gated: it records what a page the plan already allows did.
 *
 * The report (Laporan → Struk Belum Dibayar) is the OWNER's only, like the
 * duplicate-order audit: it names the cashier who printed each slip, and the
 * cashier in question may well hold the `reports` permission.
 */

const PRINTERS = ["cashier", "tables"] as const;

function text(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t.slice(0, max);
}

export async function printLogRoutes(app: FastifyInstance) {
  app.post("/api/print-logs", async (request, reply) => {
    const access = await requireOutletAccess(request, reply, PRINTERS);
    if (!access) return;
    const bad = (error: string) => reply.status(400).send({ success: false, error });
    const body = (request.body as Record<string, unknown> | null) ?? {};

    const kind = body.kind as PrintKind;
    if (!PRINT_KINDS.includes(kind)) return bad("Jenis cetakan tidak valid");

    // The till tab for the cashier's struk; a table bill has none.
    const tabKey = typeof body.tabKey === "string" ? body.tabKey.trim() : "";
    if (kind === "receipt" && !TAB_KEY.test(tabKey)) return bad("Tab kasir tidak valid");

    // Which table bill, when it is one: always for Cetak Bill, and for the
    // till's struk on a table tab.
    const sessionId = typeof body.sessionId === "string" && body.sessionId ? body.sessionId : null;
    if (kind === "table_bill" && !sessionId) return bad("Meja tidak valid");
    const billNo = body.billNo == null ? null : Number(body.billNo);
    if (billNo !== null && !(Number.isInteger(billNo) && billNo >= 1 && billNo <= 20)) {
      return bad("Nomor bill tidak valid");
    }
    if (sessionId) {
      const [session] = await db
        .select({ id: tableSessionsTable.id })
        .from(tableSessionsTable)
        .where(and(eq(tableSessionsTable.id, sessionId), eq(tableSessionsTable.outlet_id, access.outlet.id)))
        .limit(1);
      if (!session) return bad("Meja tidak ditemukan");
    }

    if (!Array.isArray(body.lines) || body.lines.length === 0 || body.lines.length > 300) {
      return bad("Daftar item tidak valid");
    }
    const parsed = body.lines.map(parsePrintLine);
    const lineError = parsed.find((p): p is string => typeof p === "string");
    if (lineError) return bad(lineError);

    const total = Number(body.total);
    if (!Number.isFinite(total) || total < 0 || total >= 1e12) return bad("Total tidak valid");

    const [row] = await db
      .insert(printLogsTable)
      .values({
        outlet_id: access.outlet.id,
        kind,
        source_key: kind === "receipt" ? tabKey : null,
        session_id: sessionId,
        bill_no: billNo,
        label: text(body.label, 40),
        customer: text(body.customer, 100),
        lines: parsed as PrintLine[],
        total: total.toFixed(2),
        created_by: access.userId,
      })
      .returning({ id: printLogsTable.id });
    return { success: true, id: row.id };
  });

  app.get("/api/print-logs/report", async (request, reply) => {
    const access = await requireOutletAccess(request, reply, "owner");
    if (!access) return;
    // The viewer's local day bounds, as ISO instants — the page works them out,
    // so no timezone is guessed here.
    const q = request.query as Record<string, string>;
    const from = new Date(q.from ?? "");
    const to = new Date(q.to ?? "");
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      return reply.status(400).send({ success: false, error: "Rentang tanggal tidak valid" });
    }
    if (to <= from) {
      return reply.status(400).send({ success: false, error: "Tanggal akhir harus setelah tanggal mulai" });
    }
    if (to.getTime() - from.getTime() > 93 * 24 * 60 * 60 * 1000) {
      return reply.status(400).send({ success: false, error: "Rentang maksimal 3 bulan" });
    }
    return { success: true, ...(await printLogReport(access.outlet.id, from, to)) };
  });
}
