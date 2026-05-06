import { getSession } from "./auth";
import Forbidden from "./forbidden";
import { db } from "@/src/db";
import { eq } from "drizzle-orm";
import { outletsTable } from "@/src/db/schema";


export default async function getOutletID() {
    const session = await getSession();

    if (!session || !session.user) {
        return null;
    }

    // Find the outlet belonging to this user
    const outletRes = await db.select().from(outletsTable).where(eq(outletsTable.user_id, session.user.id)).limit(1);
    const outlet = outletRes[0];
    return outlet;
}