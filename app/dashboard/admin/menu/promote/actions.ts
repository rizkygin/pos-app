'use server';

import { db } from '@/src/db';
import { adminsTable, productAdsTable, productAdsSchedule } from '@/src/db/schema';
import { getSession } from '@/lib/auth';
import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import fs from 'fs/promises';
import path from 'path';

const requireAdmin = async () => {
  const session = await getSession();
  const totalAdmin = await db.$count(adminsTable, eq(adminsTable.user_id, session.user.id));
  if (totalAdmin === 0) {
    throw new Error('Forbidden');
  }
};

export async function approveAdAction(adId: number) {
  try {
    await requireAdmin();

    await db
      .update(productAdsTable)
      .set({ status: 'approved', rejection_reason: null })
      .where(eq(productAdsTable.id, adId));

    revalidatePath('/dashboard/admin/menu/promote');
    return { success: true };
  } catch (error) {
    console.error('Failed to approve ad:', error);
    return { success: false, message: 'Failed to approve ad.' };
  }
}

export async function rejectAdAction(adId: number, reason: string) {
  try {
    await requireAdmin();

    await db
      .update(productAdsTable)
      .set({ status: 'rejected', is_active: false, rejection_reason: reason })
      .where(eq(productAdsTable.id, adId));

    revalidatePath('/dashboard/admin/menu/promote');
    return { success: true };
  } catch (error) {
    console.error('Failed to reject ad:', error);
    return { success: false, message: 'Failed to reject ad.' };
  }
}

export async function deleteAdAction(adId: number) {
  try {
    await requireAdmin();

    const [ad] = await db
      .select()
      .from(productAdsTable)
      .where(eq(productAdsTable.id, adId))
      .limit(1);

    if (!ad) {
      return { success: false, message: 'Ad not found.' };
    }

    if (ad.banner_image.startsWith('/ads/')) {
      const filePath = path.join(
        process.cwd(),
        'public',
        ad.banner_image.replace(/^\/ads\//, '/uploads/ads/'),
      );
      try {
        await fs.unlink(filePath);
      } catch (err) {
        console.error('Failed to delete banner file:', err);
      }
    }

    await db
      .delete(productAdsSchedule)
      .where(eq(productAdsSchedule.productAdsSchedule_id, adId));

    await db.delete(productAdsTable).where(eq(productAdsTable.id, adId));

    revalidatePath('/dashboard/admin/menu/promote');
    return { success: true, message: 'Ad deleted successfully.' };
  } catch (error) {
    console.error('Failed to delete ad:', error);
    return { success: false, message: 'Failed to delete ad.' };
  }
}
