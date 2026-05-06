"use server";

import { NextResponse } from "next/server";
import { auth } from '@/lib/auth'
import { ordersTable, productsTable, orderDetailsTable, outletsTable } from "@/src/db/schema"
import { eq, desc, count, and, like } from 'drizzle-orm'
import { db } from '@/src/db'
import { headers } from "next/headers";

export type OrderType = {
    product_name: string;
    order_id: string;
    quantity: number;
    summary_price: string;
    note_product: string;
    status: string | null;
}

export const GET = async (req: Request) => {
    try {
        const { searchParams } = new URL(req.url)
        const page = Number(searchParams.get('page')) || 1
        const limit = Number(searchParams.get('limit')) || 10
        const offset = (page - 1) * limit
        const search = searchParams.get('search') || ''
        const session = await auth.api.getSession({
            headers: await headers()
        });

        if (!session || !session.user) {
            return NextResponse.json({
                success: false,
                error: "Unauthorized",
            }, { status: 401 });
        }

        // Find the outlet belonging to this user on the server
        const outletRes = await db.select().from(outletsTable).where(eq(outletsTable.user_id, session.user.id)).limit(1);
        const outlet = outletRes[0];

        if (!outlet) {
            return NextResponse.json({
                success: false,
                error: "No outlet found",
            }, { status: 404 });
        }

        const getProduct = await db.select().from(productsTable).where(eq(productsTable.outlet_id, outlet.id));

        if (search !== '') {

        }
        const getOrderDetails2 = await db.select({
            product_name: productsTable.product_name,
            order_id: orderDetailsTable.order_id,
            quantity: orderDetailsTable.quantity,
            summary_price: orderDetailsTable.summary_price,
            note_product: orderDetailsTable.note_product,
            status: orderDetailsTable.status,
            created_at: orderDetailsTable.created_at,
        }).from(orderDetailsTable).innerJoin(productsTable, eq(orderDetailsTable.product_id, productsTable.id)).where(and(eq(productsTable.outlet_id, outlet.id), like(productsTable.product_name, `%${search}%`))).limit(limit).offset(offset).orderBy(desc(orderDetailsTable.created_at));
        const countData = await db.select({
            count: count(orderDetailsTable.id),
        }).from(orderDetailsTable).innerJoin(productsTable, eq(orderDetailsTable.product_id, productsTable.id)).where(and(eq(productsTable.outlet_id, outlet.id), like(productsTable.product_name, `%${search}%`)));

        const getOrderDetailsFinal = await Promise.all(getOrderDetails2);

        const result = getOrderDetailsFinal.flat();

        if (getProduct.length === 0) {
            return NextResponse.json({
                success: false,
                error: "No products found",
            }, { status: 404 });
        }

        return NextResponse.json({
            success: true,
            data: result,
            count: countData[0].count,
        });
    } catch (error) {
        return NextResponse.json({
            success: false,
            error: error,
        }, { status: 500 })
    }
}