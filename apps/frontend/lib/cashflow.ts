import getOutletID from '@/lib/outlet-id';
import { db } from '@/src/db';
import { cashFlows, cashInDetailTable, cashInCategoryTable } from '@/src/db/schema';
import { and, eq, gte, lte } from 'drizzle-orm';
import { CATEGORY_IN } from './cashflow-categories';
import { getUTCRangeFromLocalDate } from '@/lib/timezone';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function addPosToCashflowin(total: number, tx?: Tx) {
    const client = tx ?? db;
    const outlet = await getOutletID();
    if (!outlet) throw new Error('Outlet not found');

    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const date = new Date().toISOString().split('T')[0];
    const { startUTC, endUTC } = getUTCRangeFromLocalDate(date, timezone)

    const cashFlowExist = await client
        .select({ id: cashInDetailTable.id, money_amount: cashInDetailTable.money_amount })
        .from(cashFlows)
        .innerJoin(cashInDetailTable,
            eq(cashFlows.cash_in_detail_id, cashInDetailTable.id),
        ).leftJoin(cashInCategoryTable, eq(cashInDetailTable.category_id, cashInCategoryTable.id))
        .where(and(
            eq(cashFlows.outlet_id, outlet.id),
            eq(cashInCategoryTable.category, CATEGORY_IN[0]),
            gte(cashInDetailTable.created_at, startUTC),
            lte(cashInDetailTable.created_at, endUTC)))
        .limit(1);


    if (cashFlowExist.length > 0) {
        const totalIn = total + Number(cashFlowExist[0].money_amount);
        await client.update(cashInDetailTable).set({
            money_amount: String(totalIn),
        }).where(and(
            eq(cashInDetailTable.id, cashFlowExist[0].id),
        ));
        return;
    }



    const [category] = await client
        .select({ id: cashInCategoryTable.id })
        .from(cashInCategoryTable)
        .where(eq(cashInCategoryTable.category, CATEGORY_IN[0]))
        .limit(1);
    if (!category) throw new Error('Kategori Produk/jasa tidak ditemukan');

    const [{ id: cashInId }] = await client.insert(cashInDetailTable)
        .values({
            money_amount: String(total),
            category_id: category.id,
            type: 'cash',
        })
        .returning({ id: cashInDetailTable.id });

    await client.insert(cashFlows).values({
        outlet_id: outlet.id,
        cash_opname: 'cash',
        cash_in_detail_id: cashInId,
    });
}
