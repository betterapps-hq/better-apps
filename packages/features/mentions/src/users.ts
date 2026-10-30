import type { Actor, Identity, IdentityUser } from "better-apps"

/** Which of several users may be mentioned somewhere, such as whoever can see a thread. */
export type MentionCheck = (actors: readonly Actor[]) => readonly Actor[] | Promise<readonly Actor[]>

/** Where a mention is checked: the identity adapter, the organization it's in, and who may be mentioned there. */
export interface MentionScope {
  identity: Identity
  /** The organization of the record holding the mention, or `null` for apps without organizations. */
  orgId: string | null
  allowed: MentionCheck
}

/**
 * Splits mentioned users into those who may be mentioned and those dropped, such as users who can't see the record.
 * Users are built with one `getActorsFor` call, so users outside the organization are dropped. The author is skipped.
 */
export async function checkMentions(
  scope: MentionScope,
  userIds: readonly string[],
  authorId?: string
): Promise<{ allowed: string[]; dropped: string[] }> {
  const others = userIds.filter((id) => id !== authorId)
  if (others.length === 0) {
    return { allowed: [], dropped: [] }
  }
  const actors = await scope.identity.getActorsFor(others, scope.orgId)
  const allowed = new Set((await scope.allowed(actors)).map((actor) => actor.userId))
  return { allowed: others.filter((id) => allowed.has(id)), dropped: others.filter((id) => !allowed.has(id)) }
}

/**
 * Suggests users to mention as someone types: the identity adapter's search among the organization's members, keeping
 * only users who may be mentioned. Without `searchUsers`, there are no suggestions.
 */
export async function suggestMentions(scope: MentionScope, query: string, limit = 10): Promise<IdentityUser[]> {
  const { identity, orgId } = scope
  if (!identity.searchUsers) {
    return []
  }
  // Asks for more than it returns, since some may be filtered out.
  const found = await identity.searchUsers(query, { orgId, limit: limit * 3 })
  const actors = await identity.getActorsFor(
    found.map((user) => user.id),
    orgId
  )
  const allowed = new Set((await scope.allowed(actors)).map((actor) => actor.userId))
  return found.filter((user) => allowed.has(user.id)).slice(0, limit)
}
