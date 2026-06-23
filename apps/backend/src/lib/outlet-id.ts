import { eq } from "drizzle-orm";
import { db } from "../db";
import { outletsTable } from "../db/schema";

export async function getOutletByUserId(userId: string) {
  const [outlet] = await db
    .select()
    .from(outletsTable)
    .where(eq(outletsTable.user_id, userId))
    .limit(1);

  return outlet ?? null;
}
