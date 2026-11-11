// Pure helpers for the role and subrole editor (app/app/admin/users).

/** Union of the permissions of `subroleIds`; unknown (archived) subroles grant nothing. */
export function permissionsOf(subroleIds: Iterable<string>, subrolePermissions: Record<string, readonly string[]>): Set<string> {
  const out = new Set<string>()
  for (const id of subroleIds) for (const p of subrolePermissions[id] ?? []) out.add(p)
  return out
}

/** What `after` adds to and removes from `before`, sorted. */
export function diff(before: Iterable<string>, after: Iterable<string>): { added: string[]; removed: string[] } {
  const b = new Set(before)
  const a = new Set(after)
  return { added: [...a].filter((x) => !b.has(x)).sort(), removed: [...b].filter((x) => !a.has(x)).sort() }
}

export function sameSet(a: Iterable<string>, b: Iterable<string>): boolean {
  const d = diff(a, b)
  return d.added.length === 0 && d.removed.length === 0
}

/** Groups items by `moduleId`, modules sorted by ID, items kept in input order. */
export function byModule<T extends { moduleId: string }>(items: readonly T[]): [string, T[]][] {
  const map = new Map<string, T[]>()
  for (const item of items) map.set(item.moduleId, [...(map.get(item.moduleId) ?? []), item])
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b))
}

/** previewSubroleChange blockers look like `protected_role:system:admin` or `exceeds_authority`. */
export function parseBlocker(blocker: string): { reason: string; roleId?: string } {
  const i = blocker.indexOf(":")
  return i < 0 ? { reason: blocker } : { reason: blocker.slice(0, i), roleId: blocker.slice(i + 1) }
}

/** Toggles `id` in a list. */
export function toggle(list: readonly string[], id: string, on: boolean): string[] {
  return on ? (list.includes(id) ? [...list] : [...list, id]) : list.filter((x) => x !== id)
}
