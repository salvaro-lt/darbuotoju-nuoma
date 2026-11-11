"use client"
import { useQuery_experimental as useQueryState } from "convex/react"
import { Loader2 } from "lucide-react"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { api } from "@/convex/_generated/api"
import { useT } from "@/lib/i18n/client"
import { NotificationItem } from "./notification-item"
import { NotificationsEmpty, NotificationsError, NotificationsSkeleton } from "./notification-states"
import { useMarkRead, useNow, type Notification } from "./use-notifications"

type Page = { items: Notification[]; cursor: string | null; done: boolean }

const STEP = 20
const MAX = 100 // backend limit per call

/**
 * The full list, newest first. "Show more" grows the first (live) query up to
 * the backend's 100; past that, older pages load by cursor. Remount (key) to
 * reset when the filter changes.
 */
export function NotificationList({ unreadOnly }: { unreadOnly: boolean }) {
  const now = useNow()
  const { markRead } = useMarkRead()
  const [limit, setLimit] = useState(STEP)
  const [cursors, setCursors] = useState<string[]>([])
  const state = useQueryState({ query: api.notifications.listNotifications, args: { limit, unreadOnly } })

  // Keep the last result on screen while a bigger page loads.
  const [shown, setShown] = useState<Page | null>(null)
  if (state.status === "success" && state.data !== shown) setShown(state.data)

  if (!shown) return state.status === "error" ? <NotificationsError error={state.error} /> : <Frame><NotificationsSkeleton rows={4} /></Frame>
  if (shown.items.length === 0 && cursors.length === 0) return <NotificationsEmpty unreadOnly={unreadOnly} />

  const more = shown.done || cursors.length > 0 ? null : limit < MAX ? () => setLimit((l) => Math.min(MAX, l + STEP)) : shown.cursor ? () => setCursors([shown.cursor!]) : null

  return (
    <Frame>
      <ul className="grid gap-0.5">
        {shown.items.map((n) => (
          <NotificationItem key={n.id} n={n} now={now} onMarkRead={markRead} />
        ))}
      </ul>
      {cursors.map((c, i) => (
        <OlderPage key={c} cursor={c} unreadOnly={unreadOnly} now={now} onMarkRead={markRead} onMore={i === cursors.length - 1 ? (next) => setCursors((cs) => [...cs, next]) : null} />
      ))}
      {more && <LoadMore pending={state.status === "pending"} onClick={more} />}
    </Frame>
  )
}

function Frame({ children }: { children: React.ReactNode }) {
  return <div className="rounded-xl border bg-card p-1.5">{children}</div>
}

function OlderPage({ cursor, unreadOnly, now, onMarkRead, onMore }: { cursor: string; unreadOnly: boolean; now: number; onMarkRead: (id: Notification["id"]) => void; onMore: ((next: string) => void) | null }) {
  const state = useQueryState({ query: api.notifications.listNotifications, args: { cursor, limit: MAX, unreadOnly } })
  if (state.status === "pending") return <NotificationsSkeleton rows={2} />
  if (state.status === "error") return <NotificationsError error={state.error} compact />
  const next = state.data.cursor
  return (
    <>
      <ul className="grid gap-0.5">
        {state.data.items.map((n) => (
          <NotificationItem key={n.id} n={n} now={now} onMarkRead={onMarkRead} />
        ))}
      </ul>
      {onMore && !state.data.done && next && <LoadMore pending={false} onClick={() => onMore(next)} />}
    </>
  )
}

function LoadMore({ pending, onClick }: { pending: boolean; onClick: () => void }) {
  const { t } = useT()
  return (
    <div className="flex justify-center border-t pt-1.5 mt-1.5">
      <Button variant="ghost" size="sm" disabled={pending} onClick={onClick}>
        {pending && <Loader2 className="animate-spin" />}
        {t("notif.loadMore")}
      </Button>
    </div>
  )
}
