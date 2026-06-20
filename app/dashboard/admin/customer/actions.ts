'use server';

import { db } from '@/src/db';
import { adminsTable, customersTable, usersTable } from '@/src/db/schema';
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

export async function deleteCustomerAction(customerId: number) {
  try {
    await requireAdmin();

    const [customer] = await db
      .select({ id: customersTable.id, user_id: customersTable.user_id })
      .from(customersTable)
      .where(eq(customersTable.id, customerId))
      .limit(1);

    if (!customer) {
      return { success: false, message: 'Customer not found.' };
    }

    const now = new Date();
    await db.transaction(async (tx) => {
      await tx
        .update(customersTable)
        .set({ deletedAt: now })
        .where(eq(customersTable.id, customerId));
      await tx
        .update(usersTable)
        .set({ deletedAt: now })
        .where(eq(usersTable.id, customer.user_id));
    });

    revalidatePath('/dashboard/admin/customer');
    return { success: true, message: 'Customer deleted successfully.' };
  } catch (error) {
    console.error('Failed to delete customer:', error);
    return { success: false, message: 'Failed to delete customer.' };
  }
}
