import { getSession } from "../auth";
import { db } from "@/src/db";
import { eq } from "drizzle-orm";
import { customersTable, couriersTable, outletsTable } from "@/src/db/schema";
import { count } from "drizzle-orm";


export const getRole = async () => {
    const session = await getSession();

    if (session.user.email === 'admin') {
        return {
            role: 'admin'
        }
    }

    return ({
        role: 'owner',
        data: null
    });
    const customer = db.query.customersTable.findFirst({
        where: eq(customersTable.user_id, session.user.id),
    })
    const totalCustomer = await db.$count(customersTable, eq(customersTable.user_id, session.user.id));

    if (totalCustomer > 0) {
        return {
            role: 'customer',
            data: customer
        };
    }

    const courier = db.query.couriersTable.findFirst({
        where: eq(couriersTable.user_id, session.user.id),
    })
    const totalCourier = await db.$count(couriersTable, eq(couriersTable.user_id, session.user.id));

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