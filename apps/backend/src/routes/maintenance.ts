import type { FastifyInstance } from 'fastify';
import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import { db } from '../db';
import { adminsTable, maintenanceWindowsTable } from '../db/schema';
import { auth } from '../auth';
import { toWebHeaders } from '../lib/web-headers';

export type MaintenanceStatus = 'off' | 'upcoming' | 'active';

export type MaintenancePayload = {
  status: MaintenanceStatus;
  startsAt: string | null;
  endsAt: string | null;
  message: string | null;
};

const OFF: MaintenancePayload = { status: 'off', startsAt: null, endsAt: null, message: null };

async function requireAdminUser(request: any) {
  const session = await auth.api.getSession({ headers: toWebHeaders(request.headers) });
  if (!session?.user) return null;
  const [admin] = await db
    .select({ id: adminsTable.id })
    .from(adminsTable)
    .where(eq(adminsTable.user_id, session.user.id))
    .limit(1);
  return admin ? session.user : null;
}

/**
 * The single window that matters right now: the earliest one that has not
 * finished yet. Anything already over is history, and a window scheduled after
 * this one cannot be the thing to warn about while a nearer one is pending.
 */
async function currentWindow() {
  const [row] = await db
    .select()
    .from(maintenanceWindowsTable)
    .where(
      and(
        isNull(maintenanceWindowsTable.cancelled_at),
        isNull(maintenanceWindowsTable.deletedAt),
        gt(maintenanceWindowsTable.ends_at, sql`now()`),
      ),
    )
    .orderBy(maintenanceWindowsTable.starts_at)
    .limit(1);
  return row ?? null;
}

function toPayload(row: Awaited<ReturnType<typeof currentWindow>>): MaintenancePayload {
  if (!row) return OFF;

  const now = Date.now();
  const startsAt = row.starts_at.getTime();
  const endsAt = row.ends_at.getTime();

  if (now >= startsAt) {
    return {
      status: 'active',
      startsAt: row.starts_at.toISOString(),
      endsAt: row.ends_at.toISOString(),
      message: row.message,
    };
  }

  // Outside the notice period the window exists but nobody is told yet — a
  // banner that sits there for three days is a banner people stop seeing.
  if (now < startsAt - row.notice_minutes * 60_000) return OFF;

  return {
    status: 'upcoming',
    startsAt: row.starts_at.toISOString(),
    endsAt: row.ends_at.toISOString(),
    message: row.message,
  };
}

export async function maintenanceRoutes(app: FastifyInstance) {
  /**
   * Public, unauthenticated, and deliberately tiny: the frontend proxy calls
   * this on request paths that are not otherwise hitting the backend, and every
   * client polls it for the countdown banner.
   */
  app.get('/api/maintenance', async (_request, reply) => {
    try {
      return reply.send(toPayload(await currentWindow()));
    } catch (err) {
      // A database that cannot answer must not lock everyone out of the app.
      // Failing open is the safe direction here: the worst case is that a
      // planned window starts without its banner.
      app.log.error({ err }, 'maintenance status lookup failed');
      return reply.send(OFF);
    }
  });

  // Every window, past and future, for the admin screen.
  app.get('/api/admin/maintenance', async (request, reply) => {
    const user = await requireAdminUser(request);
    if (!user) return reply.status(401).send({ error: 'Unauthorized' });

    const windows = await db
      .select()
      .from(maintenanceWindowsTable)
      .where(isNull(maintenanceWindowsTable.deletedAt))
      .orderBy(desc(maintenanceWindowsTable.starts_at))
      .limit(50);

    return reply.send({ current: toPayload(await currentWindow()), windows });
  });

  app.post('/api/admin/maintenance', async (request, reply) => {
    const user = await requireAdminUser(request);
    if (!user) return reply.status(401).send({ error: 'Unauthorized' });

    const body = (request.body ?? {}) as {
      startsAt?: string;
      endsAt?: string;
      message?: string;
      noticeMinutes?: number;
    };

    const startsAt = body.startsAt ? new Date(body.startsAt) : null;
    const endsAt = body.endsAt ? new Date(body.endsAt) : null;
    if (!startsAt || Number.isNaN(startsAt.getTime()) || !endsAt || Number.isNaN(endsAt.getTime())) {
      return reply.status(400).send({ error: 'Waktu mulai dan selesai wajib diisi.' });
    }
    if (endsAt <= startsAt) {
      return reply.status(400).send({ error: 'Waktu selesai harus setelah waktu mulai.' });
    }

    const noticeMinutes = Number.isFinite(body.noticeMinutes)
      ? Math.min(Math.max(Math.trunc(body.noticeMinutes as number), 0), 7 * 24 * 60)
      : 60;

    const [row] = await db
      .insert(maintenanceWindowsTable)
      .values({
        starts_at: startsAt,
        ends_at: endsAt,
        message: body.message?.trim() || null,
        notice_minutes: noticeMinutes,
        created_by: user.id,
      })
      .returning();

    return reply.send({ success: true, window: row });
  });

  /**
   * Ends the window now rather than deleting it: if it already started, people
   * were affected, and that belongs in the history. A window that has not
   * started yet is simply marked cancelled.
   */
  app.post('/api/admin/maintenance/:id/end', async (request, reply) => {
    const user = await requireAdminUser(request);
    if (!user) return reply.status(401).send({ error: 'Unauthorized' });

    const id = Number((request.params as { id: string }).id);
    if (!Number.isFinite(id)) return reply.status(400).send({ error: 'Invalid id' });

    const [row] = await db
      .select()
      .from(maintenanceWindowsTable)
      .where(eq(maintenanceWindowsTable.id, id))
      .limit(1);
    if (!row) return reply.status(404).send({ error: 'Jadwal tidak ditemukan.' });

    const started = row.starts_at.getTime() <= Date.now();
    const [updated] = await db
      .update(maintenanceWindowsTable)
      .set(
        started
          ? { ends_at: new Date(), updatedAt: new Date() }
          : { cancelled_at: new Date(), updatedAt: new Date() },
      )
      .where(eq(maintenanceWindowsTable.id, id))
      .returning();

    return reply.send({ success: true, window: updated });
  });
}
