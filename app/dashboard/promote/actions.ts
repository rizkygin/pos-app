'use server';

import { db } from '@/src/db';
import {
  productAdsTable,
  productAdsSchedule,
  scheduleProductAdsTable,
} from '@/src/db/schema';
import { revalidatePath } from 'next/cache';
import fs from 'fs/promises';
import path from 'path';
import sharp from 'sharp';
import { and, eq } from 'drizzle-orm';
import getOutletID from '@/lib/outlet-id';

export type DisplayAs = 'once a week' | 'only 1 day' | 'only weekend' | 'only weekdays';

const WEEKEND_DAYS = ['saturday', 'sunday'];
const WEEKDAY_DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];

function resolveDays(display_as: DisplayAs, day?: string): string[] {
  switch (display_as) {
    case 'only weekend':
      return WEEKEND_DAYS;
    case 'only weekdays':
      return WEEKDAY_DAYS;
    case 'once a week':
    case 'only 1 day':
    default:
      return day ? [day] : [];
  }
}

function resolveHours(hour_start: string, hour_end: string): string[] {
  const start = Number(hour_start);
  const end = Number(hour_end);
  const hours: string[] = [];
  for (let h = start; h <= end; h++) {
    hours.push(String(h).padStart(2, '0'));
  }
  return hours;
}

function resolveEndsAt(display_as: DisplayAs, starts_at: Date, duration?: number): Date | null {
  switch (display_as) {
    case 'once a week':
      return null;
    case 'only 1 day':
      return new Date(starts_at.getTime() + 7 * 24 * 60 * 60 * 1000);
    case 'only weekend':
    case 'only weekdays':
    default: {
      const weeks = duration && duration > 0 ? duration : 1;
      return new Date(starts_at.getTime() + weeks * 7 * 24 * 60 * 60 * 1000);
    }
  }
}

export async function uploadAdBanner(formData: FormData) {
  try {
    const file = formData.get('image') as File | null;
    if (!file) {
      return { success: false, message: 'No image file provided.' };
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const filename = `ad-${uniqueSuffix}.webp`;
    const uploadDir = path.join(process.cwd(), 'public', 'uploads', 'ads');
    await fs.mkdir(uploadDir, { recursive: true });

    await sharp(buffer)
      .resize(1200, 500, {
        fit: 'cover',
        position: 'center',
      })
      .webp({ quality: 80 })
      .toFile(path.join(uploadDir, filename));

    const imageUrl = `/ads/${filename}`;

    return { success: true, imageUrl };
  } catch (error) {
    console.error('Failed to upload ad banner:', error);
    return { success: false, message: 'Failed to process and upload image.' };
  }
}

export type CreateAdInput = {
  product_id: string;
  title: string;
  description?: string;
  banner_image: string;
  display_as: DisplayAs;
  day?: string;
  hour_start: string;
  hour_end: string;
  duration?: number;
};

export async function createAdAction(data: CreateAdInput) {
  try {
    const outlet = await getOutletID();
    if (!outlet) {
      return { success: false, message: 'Outlet not found.' };
    }

    const days = resolveDays(data.display_as, data.day);
    const hours = resolveHours(data.hour_start, data.hour_end);
    if (days.length === 0 || hours.length === 0) {
      return { success: false, message: 'Jadwal tampil iklan tidak valid.' };
    }

    const starts_at = new Date();
    const ends_at = resolveEndsAt(data.display_as, starts_at, data.duration);

    const [newAd] = await db
      .insert(productAdsTable)
      .values({
        outlet_id: outlet.id,
        product_id: data.product_id,
        title: data.title,
        description: data.description || '',
        banner_image: data.banner_image,
        status: 'pending',
        starts_at,
        ends_at,
      })
      .returning({ id: productAdsTable.id });

    const slots = await db.select().from(scheduleProductAdsTable);
    const matchedSlots = slots.filter(
      (slot) => slot.time && days.includes(slot.time.day) && hours.includes(slot.time.hour),
    );

    if (matchedSlots.length > 0) {
      await db.insert(productAdsSchedule).values(
        matchedSlots.map((slot) => ({
          scheduleProductAdsTable_id: slot.id,
          productAdsSchedule_id: newAd.id,
        })),
      );
    }

    revalidatePath('/dashboard/promote');
    return { success: true, message: 'Ad submitted for review.' };
  } catch (error) {
    console.error('Failed to create ad:', error);
    return { success: false, message: 'Failed to create ad.' };
  }
}

export async function toggleAdActiveAction(adId: number, isActive: boolean) {
  try {
    const outlet = await getOutletID();
    if (!outlet) {
      return { success: false, message: 'Outlet not found.' };
    }

    const [ad] = await db
      .select()
      .from(productAdsTable)
      .where(
        and(
          eq(productAdsTable.id, adId),
          eq(productAdsTable.outlet_id, outlet.id),
        ),
      )
      .limit(1);

    if (!ad) {
      return { success: false, message: 'Ad not found.' };
    }
    if (ad.status !== 'approved') {
      return { success: false, message: 'Ad is not approved yet.' };
    }

    await db
      .update(productAdsTable)
      .set({ is_active: isActive })
      .where(eq(productAdsTable.id, adId));

    revalidatePath('/dashboard/promote');
    return { success: true };
  } catch (error) {
    console.error('Failed to toggle ad:', error);
    return { success: false, message: 'Failed to update ad.' };
  }
}

export async function deleteAdAction(adId: number) {
  try {
    const outlet = await getOutletID();
    if (!outlet) {
      return { success: false, message: 'Outlet not found.' };
    }

    const [ad] = await db
      .select()
      .from(productAdsTable)
      .where(
        and(
          eq(productAdsTable.id, adId),
          eq(productAdsTable.outlet_id, outlet.id),
        ),
      )
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

    await db.delete(productAdsTable).where(eq(productAdsTable.id, adId));

    revalidatePath('/dashboard/promote');
    return { success: true, message: 'Ad deleted successfully.' };
  } catch (error) {
    console.error('Failed to delete ad:', error);
    return { success: false, message: 'Failed to delete ad.' };
  }
}
