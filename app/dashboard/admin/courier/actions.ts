'use server';

import { db } from '@/src/db';
import { adminsTable, couriersTable, ratingsTable, usersTable } from '@/src/db/schema';
import { getSession } from '@/lib/auth';
import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

const requireAdmin = async () => {
  const session = await getSession();
  const totalAdmin = await db.$count(adminsTable, eq(adminsTable.user_id, session.user.id));
  if (totalAdmin === 0) {
    throw new Error('Forbidden');
  }
};

export async function resetCourierRatingAction(courierId: number) {
  try {
    await requireAdmin();

    await db
      .update(couriersTable)
      .set({ ratings: '5' })
      .where(eq(couriersTable.id, courierId));

    revalidatePath('/dashboard/admin/courier');
    return { success: true };
  } catch (error) {
    console.error('Failed to reset courier rating:', error);
    return { success: false, message: 'Failed to reset courier rating.' };
  }
}

export async function resetCourierReviewCountAction(courierId: number) {
  try {
    await requireAdmin();

    await db
      .update(couriersTable)
      .set({ review_count: 0 })
      .where(eq(couriersTable.id, courierId));

    revalidatePath('/dashboard/admin/courier');
    return { success: true };
  } catch (error) {
    console.error('Failed to reset courier review count:', error);
    return { success: false, message: 'Failed to reset courier review count.' };
  }
}

export async function updateLatestRatingAction(ratingId: string, newRating: number) {
  try {
    await requireAdmin();

    if (!Number.isFinite(newRating) || newRating < 1 || newRating > 5) {
      return { success: false, message: 'Rating must be between 1 and 5.' };
    }

    await db
      .update(ratingsTable)
      .set({ ratings: String(newRating) })
      .where(eq(ratingsTable.id, ratingId));

    revalidatePath('/dashboard/admin/courier');
    return { success: true };
  } catch (error) {
    console.error('Failed to update latest rating:', error);
    return { success: false, message: 'Failed to update latest rating.' };
  }
}

export async function deleteCourierAction(courierId: number) {
  try {
    await requireAdmin();

    const [courier] = await db
      .select({ id: couriersTable.id, user_id: couriersTable.user_id })
      .from(couriersTable)
      .where(eq(couriersTable.id, courierId))
      .limit(1);

    if (!courier) {
      return { success: false, message: 'Courier not found.' };
    }

    const now = new Date();
    await db.transaction(async (tx) => {
      await tx
        .update(couriersTable)
        .set({ deletedAt: now })
        .where(eq(couriersTable.id, courierId));
      await tx
        .update(usersTable)
        .set({ deletedAt: now })
        .where(eq(usersTable.id, courier.user_id));
    });

    revalidatePath('/dashboard/admin/courier');
    return { success: true, message: 'Courier deleted successfully.' };
  } catch (error) {
    console.error('Failed to delete courier:', error);
    return { success: false, message: 'Failed to delete courier.' };
  }
}
