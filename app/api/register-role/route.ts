import { db } from "@/src/db";
import { outletsTable, couriersTable, customersTable } from "@/src/db/schema";
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

        const userId = session.user.id;
        const body = await req.json();
        const { role, data } = body;

        if (role === 'owner') {
            await db.insert(outletsTable).values({
                name: data.name,
                address: data.address,
                phone: data.phone,
                email: data.email,
                user_id: userId,
                avatar: data.avatar || 'avatar.png'
            });
        } else if (role === 'courier') {
            await db.insert(couriersTable).values({
                user_id: userId,
                vehicle_plate: data.vehicle_plate,
                vehicle_type: data.vehicle_type,
                avatar: data.avatar || 'avatar-courier.png'
            });
        } else if (role === 'customer') {
            await db.insert(customersTable).values({
                user_id: userId,
            });
        } else {
            return NextResponse.json({ error: "Invalid role" }, { status: 400 });
        }

        return NextResponse.json({ success: true });
    } catch (error: any) {
        console.error("Registration error:", error);
        return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
    }
}
