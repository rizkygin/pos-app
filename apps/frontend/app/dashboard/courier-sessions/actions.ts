'use server';

import { revalidatePath } from 'next/cache';
import { getSession } from '@/lib/auth';
import { db } from '@/src/db';
import { couriersTable, courierSessionsTable } from '@/src/db/schema';
import { and, eq, isNull } from 'drizzle-orm';

async function getCourierId(userId: string) {
  const [courier] = await db
    .select({ id: couriersTable.id })
    .from(couriersTable)
    .where(eq(couriersTable.user_id, userId))
    .limit(1);
  return courier?.id ?? null;
}

export async function goOnline() {
  const session = await getSession();
  const courierId = await getCourierId(session.user.id);
  if (!courierId) throw new Error('Not a courier');

  // Close any dangling open session first
  await db
    .update(courierSessionsTable)
    .set({ ended_at: new Date() })
    .where(
      and(
        eq(courierSessionsTable.courier_id, courierId),
        isNull(courierSessionsTable.ended_at),
      ),
    );

  await db.insert(courierSessionsTable).values({ courier_id: courierId });
  revalidatePath('/dashboard');
}

export async function goOffline() {
  const session = await getSession();
  const courierId = await getCourierId(session.user.id);
  if (!courierId) throw new Error('Not a courier');

  await db
    .update(courierSessionsTable)
    .set({ ended_at: new Date() })
    .where(
      and(
        eq(courierSessionsTable.courier_id, courierId),
        isNull(courierSessionsTable.ended_at),
      ),
    );
  revalidatePath('/dashboard');
}
