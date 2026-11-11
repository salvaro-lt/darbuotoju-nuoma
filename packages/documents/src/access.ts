// Who sees which documents and labels. One rule, in one place:
//
// - `documents:document:all` sees everything.
// - A document with no restricted label and no share is visible to everyone
//   with `documents:document:read`.
// - Otherwise it is visible to its uploader, to the users and roles it is
//   shared with, and to anyone granted (as a user or through a role) on ANY of
//   its restricted labels ("any grant opens").
// - A restricted label is visible only to its grantees (and `all` holders).
//
// Functions get a `Viewer` once per request (`viewerFor`) and use the pure
// helpers below; the helpers never read the database.
import { decide, heldRoleIds, type Actor, type SystemContext } from "@digimuza/system-core/convex"
import { DocumentsPermissions } from "./manifest"
import type { TagAccess } from "./shared"

export interface Viewer {
  /** Holds `documents:document:all`. */
  all: boolean
  /** Principal ids that count as "me": the user, or an API key and its owner. */
  ids: ReadonlySet<string>
  /** Roles that count for grants (for API keys: the key's roles the owner also holds). */
  roleIds: ReadonlySet<string>
}

interface TagLike {
  _id: string
  access?: TagAccess | undefined
}
interface DocLike {
  tagIds: readonly string[]
  addedBy: string
  sharedUserIds?: readonly string[] | undefined
  sharedRoleIds?: readonly string[] | undefined
}

export async function viewerFor(sys: SystemContext, actor: Actor): Promise<Viewer> {
  const all = (await decide(sys, actor, DocumentsPermissions.all)).allowed
  if (actor.kind === "user") return { all, ids: new Set([actor.userId]), roleIds: new Set(await heldRoleIds(sys, { userId: actor.userId })) }
  const [keyRoles, ownerRoles] = await Promise.all([heldRoleIds(sys, { apiKeyId: actor.apiKeyId }), heldRoleIds(sys, { userId: actor.ownerId })])
  const owner = new Set(ownerRoles)
  return { all, ids: new Set([actor.apiKeyId, actor.ownerId]), roleIds: new Set(keyRoles.filter((r) => owner.has(r))) }
}

const granted = (v: Viewer, userIds: readonly string[] | undefined, roleIds: readonly string[] | undefined) =>
  (userIds ?? []).some((id) => v.ids.has(id)) || (roleIds ?? []).some((id) => v.roleIds.has(id))

export function canSeeTag(v: Viewer, tag: TagLike): boolean {
  if (v.all || !tag.access) return true
  return granted(v, tag.access.userIds, tag.access.roleIds)
}

export const isShared = (d: Pick<DocLike, "sharedUserIds" | "sharedRoleIds">) => (d.sharedUserIds?.length ?? 0) + (d.sharedRoleIds?.length ?? 0) > 0

/** Restricted labels on the document (labels that no longer exist are ignored). */
export function restrictedTagsOf<T extends TagLike>(d: Pick<DocLike, "tagIds">, tags: ReadonlyMap<string, T>): T[] {
  return d.tagIds.map((id) => tags.get(id)).filter((t): t is T => Boolean(t?.access))
}

export function canSeeDocument(v: Viewer, d: DocLike, tags: ReadonlyMap<string, TagLike>): boolean {
  if (v.all) return true
  const restricted = restrictedTagsOf(d, tags)
  if (!restricted.length && !isShared(d)) return true
  if (v.ids.has(d.addedBy)) return true
  if (granted(v, d.sharedUserIds, d.sharedRoleIds)) return true
  return restricted.some((t) => canSeeTag(v, t))
}

/** The document's labels this viewer may see. */
export function visibleTagIds<I extends string>(v: Viewer, ids: readonly I[], tags: ReadonlyMap<string, TagLike>): I[] {
  return ids.filter((id) => {
    const t = tags.get(id)
    return !t || canSeeTag(v, t)
  })
}

/**
 * New label set when a viewer edits a document's labels: labels they cannot see
 * stay as they are; asking for one they cannot see is refused (returns null).
 */
export function mergeTagIds<I extends string>(v: Viewer, current: readonly I[], requested: readonly I[], tags: ReadonlyMap<string, TagLike>): I[] | null {
  const hidden = (id: string) => {
    const t = tags.get(id)
    return Boolean(t && !canSeeTag(v, t))
  }
  if (requested.some((id) => hidden(id) && !current.includes(id))) return null
  return [...new Set([...current.filter(hidden), ...requested])]
}
