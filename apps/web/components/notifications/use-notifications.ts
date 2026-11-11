"use client"
import type { OptimisticLocalStore } from "convex/browser"
import { useMutation } from "convex/react"
import type { FunctionReturnType } from "convex/server"
import { useEffect, useState } from "react"
import { useAction } from "@/components/app/use-action"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"

export type Notification = FunctionReturnType<typeof api.notifications.listNotifications>["items"][number]
export type NotificationPreference = FunctionReturnType<typeof api.notifications.getNotificationPreferences>[number]

/** Wall clock for relative times, ticking once a minute. */
export function useNow(intervalMs = 60_000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}

type Store = OptimisticLocalStore

function optimisticMarkOne(store: Store, { notificationId }: { notificationId: Id<"notifications"> }) {
  const now = Date.now()
  let wasUnread = false
  for (const { args, value } of store.getAllQueries(api.notifications.listNotifications)) {
    if (!value) continue
    if (value.items.some((n) => n.id === notificationId && n.readAt === null)) wasUnread = true
    const items = args.unreadOnly ? value.items.filter((n) => n.id !== notificationId) : value.items.map((n) => (n.id === notificationId ? { ...n, readAt: n.readAt ?? now } : n))
    store.setQuery(api.notifications.listNotifications, args, { ...value, items })
  }
  const count = store.getQuery(api.notifications.unreadNotificationCount, {})
  if (wasUnread && typeof count === "number") store.setQuery(api.notifications.unreadNotificationCount, {}, Math.max(0, count - 1))
}

function optimisticMarkAll(store: Store) {
  const now = Date.now()
  for (const { args, value } of store.getAllQueries(api.notifications.listNotifications)) {
    if (!value) continue
    const items = args.unreadOnly ? [] : value.items.map((n) => ({ ...n, readAt: n.readAt ?? now }))
    store.setQuery(api.notifications.listNotifications, args, { ...value, items, ...(args.unreadOnly ? { done: true, cursor: null } : {}) })
  }
  store.setQuery(api.notifications.unreadNotificationCount, {}, 0)
}

/**
 * Mark one / all as read, optimistically: every open list and the unread badge
 * update at once; Convex rolls back if the call fails (useAction toasts the error).
 */
export function useMarkRead() {
  const { run, busy } = useAction()
  const markOne = useMutation(api.notifications.markNotificationRead).withOptimisticUpdate(optimisticMarkOne)
  const markBatch = useMutation(api.notifications.markAllNotificationsRead).withOptimisticUpdate(optimisticMarkAll)

  /** Fire and forget: used on click-through, the navigation must not wait. */
  const markRead = (notificationId: Id<"notifications">) => void run(() => markOne({ notificationId }))

  /** The backend marks in batches; repeat until it reports done. */
  const markAllRead = () =>
    run(async () => {
      let marked = 0
      for (let i = 0; i < 50; i++) {
        const res = await markBatch({})
        marked += res.marked
        if (res.done) break
      }
      return marked
    })

  return { markRead, markAllRead, busy }
}

/** One preference change, applied optimistically to the preferences query. */
export function useSetPreference() {
  const { run } = useAction()
  const set = useMutation(api.notifications.setNotificationPreference).withOptimisticUpdate((store, { type, inApp, email }) => {
    const prefs = store.getQuery(api.notifications.getNotificationPreferences, {})
    if (!prefs) return
    store.setQuery(
      api.notifications.getNotificationPreferences,
      {},
      prefs.map((p) => (p.type === type ? { ...p, inApp, email, customized: true } : p)),
    )
  })
  return (pref: NotificationPreference, change: { inApp?: boolean; email?: boolean }) =>
    void run(() => set({ type: pref.type, inApp: change.inApp ?? pref.inApp, email: change.email ?? pref.email }))
}
