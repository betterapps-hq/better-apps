import { eq } from "drizzle-orm"
import { user } from "./db/auth-schema"
import { db } from "./db/database.server"
import { ownerEmail } from "./demo-users"

/** Whether someone owns the workspace, which lets them moderate comments. A real app would read their role. */
export async function isOwner(userId: string): Promise<boolean> {
  const [found] = await db.select({ email: user.email }).from(user).where(eq(user.id, userId)).limit(1)
  return found?.email === ownerEmail
}
