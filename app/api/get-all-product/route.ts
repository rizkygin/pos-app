import { db } from "@/src/db";
import { eq, and, isNull, desc, like, sql } from "drizzle-orm"
import { productsTable } from "@/src/db/schema";

export async function GET(request: Request) {
    const url = new URL(request.url);
    const name = url.searchParams.get('name')

    const data = await db.select().from(productsTable).where(
        and(
            eq(productsTable.isAvailable, true),
            isNull(productsTable.deletedAt),
            name ? like(productsTable.product_name, `%${name}%`) : sql`true`
        )
    ).orderBy(desc(productsTable.ratings)).limit(100);

    return Response.json({ data });
}