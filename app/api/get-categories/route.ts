import { db } from "@/src/db";
import { eq } from "drizzle-orm";
import { productsTable } from "@/src/db/schema";
import { NextResponse } from "next/server";


export async function GET(req: Request) {
    const { searchParams } = new URL(req.url);
    const outletIdParam = searchParams.get("outletId");

    if (!outletIdParam) {
        return NextResponse.json({ success: false, message: "Missing outletId" }, { status: 400 });
    }

    const userOutletsId = parseInt(outletIdParam, 10);

    try {
        const categories = await db.selectDistinct({
            category: productsTable.category
        }).from(productsTable).where(eq(productsTable.outlet_id, userOutletsId));

        return NextResponse.json({
            success: true,
            message: "Categories fetched successfully",
            data: categories
        });
    } catch (error: any) {
        return NextResponse.json({ success: false, error: { message: error.message } }, { status: 500 });
    }
}