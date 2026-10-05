import { and, eq, isNull } from "drizzle-orm";
import { db } from "../db";
import { adminsTable } from "../db/schema";

// The admins-row half of the admin check, with no auth.ts import so auth.ts's
// own hooks (lib/admin-devices.ts) can use it without an import cycle. Route
// code should go through lib/admin-access.ts, which re-exports these.

/** The live admins row, or null. Says nothing about 2FA — see isAdminSession. */
export async function getAdminRow(userId: string) {
  const [row] = await db
    .select()
    .from(adminsTable)
    .where(and(eq(adminsTable.user_id, userId), isNull(adminsTable.deletedAt)))
    .limit(1);
  return row ?? null;
}

export async function hasAdminRow(userId: string) {
  return (await getAdminRow(userId)) !== null;
}
