import { db } from "@/src/db";
import { productsTable } from "@/src/db/schema";
import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";
import { headers } from "next/headers";

export async function POST(req: Request) {
    try {
        const session = await auth.api.getSession({
            headers: await headers()
        });

        if (!session) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const body = await req.json();
        const { product_name, price, stock, image, outlet_id } = body;

        // await db.insert(productsTable).values({
        //     product_name,
        //     price,
        //     stock,
        //     image,
        //     outlet_id
        // });

        return NextResponse.json({ success: true });
    } catch (error: any) {
        console.error("Add product error:", error);
        return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
    }
}