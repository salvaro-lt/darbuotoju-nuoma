"use client"
// The last opened palette items, per user, in localStorage. Pages are stored
// by href only and relabelled at render (locale changes, lost access drops them).
import { useCallback, useSyncExternalStore } from "react"

export type RecentItem =
  | { type: "page"; href: string }
  | { type: "record"; href: string; title: string; subtitle?: string | undefined; providerId: string; kind?: string | undefined }

const MAX = 5
const EMPTY: RecentItem[] = []
const listeners = new Set<() => void>()
let cache: { raw: string | null; items: RecentItem[] } = { raw: null, items: EMPTY }

const keyOf = (userId: string | undefined) => `search.recent.v1:${userId ?? "anon"}`

function read(key: string): RecentItem[] {
  let raw: string | null = null
  try {
    raw = localStorage.getItem(key)
  } catch {
    return EMPTY
  }
  if (raw === cache.raw) return cache.items
  let items: RecentItem[] = EMPTY
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : []
    if (Array.isArray(parsed)) items = parsed.filter((i): i is RecentItem => !!i && typeof i.href === "string" && i.href.startsWith("/app")).slice(0, MAX)
  } catch {
    items = EMPTY
  }
  cache = { raw, items }
  return items
}

function subscribe(fn: () => void) {
  listeners.add(fn)
  const onStorage = (e: StorageEvent) => e.key?.startsWith("search.recent.") && fn()
  window.addEventListener("storage", onStorage)
  return () => {
    listeners.delete(fn)
    window.removeEventListener("storage", onStorage)
  }
}

export function useRecent(userId: string | undefined) {
  const key = keyOf(userId)
  const items = useSyncExternalStore(
    subscribe,
    () => read(key),
    () => EMPTY,
  )
  const remember = useCallback(
    (item: RecentItem) => {
      const next = [item, ...read(key).filter((i) => i.href !== item.href)].slice(0, MAX)
      try {
        localStorage.setItem(key, JSON.stringify(next))
      } catch {
        return
      }
      for (const fn of listeners) fn()
    },
    [key],
  )
  return { items, remember }
}
