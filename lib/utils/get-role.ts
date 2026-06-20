import { getSession } from "../auth";
import { db } from "@/src/db";
import { and, eq, isNull } from "drizzle-orm";
import { adminsTable, customersTable, couriersTable, outletsTable } from "@/src/db/schema";
import { count } from "drizzle-orm";


export const getRole = async () => {
    const session = await getSession();

    const admin = db.query.adminsTable.findFirst({
        where: eq(adminsTable.user_id, session.user.id),
    })
    const totalAdmin = await db.$count(adminsTable, eq(adminsTable.user_id, session.user.id));

    if (totalAdmin > 0) {
        return {
            role: 'admin',
            data: admin
        };
    }

    const customer = db.query.customersTable.findFirst({
        where: and(eq(customersTable.user_id, session.user.id), isNull(customersTable.deletedAt)),
    })
    const totalCustomer = await db.$count(
        customersTable,
        and(eq(customersTable.user_id, session.user.id), isNull(customersTable.deletedAt)),
    );

    if (totalCustomer > 0) {
        return {
            role: 'customer',
            data: customer
        };
    }

    const courier = db.query.couriersTable.findFirst({
        where: and(eq(couriersTable.user_id, session.user.id), isNull(couriersTable.deletedAt)),
    })
    const totalCourier = await db.$count(
        couriersTable,
        and(eq(couriersTable.user_id, session.user.id), isNull(couriersTable.deletedAt)),
    );

    if (totalCourier > 0) {
        return {
            role: 'courier',
            data: courier
        };
    }

    const outlet = db.query.outletsTable.findFirst({
        where: eq(outletsTable.user_id, session.user.id),
    })
    const totalOutlet = await db.$count(outletsTable, eq(outletsTable.user_id, session.user.id));

    if (totalOutlet > 0) {
        return {
            role: 'owner',
            data: outlet
        };
    }

    return false;
}

export const getOutlet = async () => {
    const session = await getSession();
    const result = await db.select()
    .from(outletsTable)
    .where(eq(outletsTable.user_id, session.user.id))

    return {
        result
    }
}