import getOutletID from "@/lib/outlet-id";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { db } from "@/src/db";
import { cashInDetailTable } from "@/src/db/schema";

export const POST = (req: Request) =>
    Promise.all([
        headers().then(h => auth.api.getSession({ headers: h })),
        getOutletID(),
        req.json(),
    ])
        .then(([session, outlet, body]) => {
            if (!session || !outlet) {
                return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
            }

            db.insert(cashInDetailTable).values({
                money_amount: String(body.total),
                category_id: 1,
                type: "cash",
            })
                .then(r => console.log("[cashIn]", r))
                .catch(e => console.error("[cashIn error]", e));

            return NextResponse.json({ success: true });
        })
        .catch((e: any) => NextResponse.json({ message: e.message, error: "Internal Server Error" }, { status: 500 }));
