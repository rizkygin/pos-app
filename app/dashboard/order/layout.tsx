import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { db } from '@/src/db';
import {
  customersTable,
  couriersTable,
  ordersTable,
  outletsTable,
} from '@/src/db/schema';
import { and, eq, notInArray, desc } from 'drizzle-orm';

export default async function OrderLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();

  const [[outlet], [courier]] = await Promise.all([
    db
      .select({ id: outletsTable.id })
      .from(outletsTable)
      .where(eq(outletsTable.user_id, session.user.id))
      .limit(1),
    db
      .select({ id: couriersTable.id })
      .from(couriersTable)
      .where(eq(couriersTable.user_id, session.user.id))
      .limit(1),
  ]);

  if (outlet || courier) redirect('/dashboard');

  const [activeOrder] = await db
    .select({ id: ordersTable.id })
    .from(ordersTable)
    .innerJoin(customersTable, eq(ordersTable.customer_id, customersTable.id))
    .where(
      and(
        eq(customersTable.user_id, session.user.id),
        notInArray(ordersTable.status, ['delivered', 'cancelled']),
      ),
    )
    .limit(1);

  if (activeOrder) redirect('/dashboard/activeorder/');

  return <>{children}</>;
}
