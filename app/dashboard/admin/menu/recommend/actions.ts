'use server';

import { db } from '@/src/db';
import { adminsTable, productsTable } from '@/src/db/schema';
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

export async function setRecommendedAction(productId: string, isRecommended: boolean) {
  try {
    await requireAdmin();

    await db
      .update(productsTable)
      .set({ is_recommended: isRecommended })
      .where(eq(productsTable.id, productId));

    revalidatePath('/dashboard/admin/menu/recommend');
    return { success: true };
  } catch (error) {
    console.error('Failed to update recommended status:', error);
    return { success: false, message: 'Failed to update recommended status.' };
  }
}

export type AdminEditProductInput = {
  product_name: string;
  price: string;
  price_mark_down: string;
  category: string;
  description: string;
};

export async function adminUpdateProductAction(
  productId: string,
  data: AdminEditProductInput,
) {
  try {
    await requireAdmin();

    await db
      .update(productsTable)
      .set({
        product_name: data.product_name,
        price: data.price,
        price_mark_down: data.price_mark_down,
        category: data.category,
        description: data.description,
      })
      .where(eq(productsTable.id, productId));

    revalidatePath('/dashboard/admin/menu/recommend');
    return { success: true, message: 'Product updated successfully.' };
  } catch (error) {
    console.error('Failed to update product:', error);
    return { success: false, message: 'Failed to update product.' };
  }
}
