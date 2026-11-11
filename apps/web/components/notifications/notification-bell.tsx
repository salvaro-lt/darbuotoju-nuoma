"use client"
import { useQuery_experimental as useQueryState } from "convex/react"
import { Bell, CheckCheck, Settings2 } from "lucide-react"
import Link from "next/link"
import { useRef, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { SidebarMenuBadge, SidebarMenuButton, SidebarMenuItem, useSidebar } from "@/components/ui/sidebar"
import { api } from "@/convex/_generated/api"
import { useT } from "@/lib/i18n/client"
import { NotificationsError, NotificationsSkeleton, NotificationsEmpty } from "./notification-states"
import { NotificationItem } from "./notification-item"
import { countLabel, fill } from "./render"
import { useMarkRead, useNow } from "./use-notifications"

const POPOVER_LIMIT = 10
const SETTINGS_HREF = "/app/settings/notifications"

/** Sidebar entry with the live unread count; opens the latest notifications. */
export function NotificationsNavItem() {
  const { t } = useT()
  const { isMobile, setOpenMobile } = useSidebar()
  const [open, setOpen] = useState(false)
  const countState = useQueryState({ query: api.notifications.unreadNotificationCount, args: {} })
  const unread = countState.status === "success" ? countState.data : 0
  const label = t("nav.notifications")

  // Announce arrivals politely, never the initial count or decreases.
  const [seen, setSeen] = useState<number | null>(null)
  const [announcement, setAnnouncement] = useState("")
  if (countState.status === "success" && countState.data !== seen) {
    if (seen !== null && countState.data > seen) setAnnouncement(fill(t("notif.announce"), { count: countLabel(countState.data) }))
    setSeen(countState.data)
  }

  const close = () => {
    setOpen(false)
    if (isMobile) setOpenMobile(false)
  }

  return (
    <SidebarMenuItem>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <SidebarMenuButton
            tooltip={unread ? `${label} · ${countLabel(unread)}` : label}
            aria-label={unread ? fill(t("notif.triggerLabel"), { count: countLabel(unread) }) : label}
            className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
          >
            <span className="relative flex">
              <Bell />
              {unread > 0 && <span aria-hidden className="absolute -top-0.5 -right-0.5 hidden size-2 rounded-full bg-primary ring-2 ring-sidebar group-data-[collapsible=icon]:block" />}
            </span>
            <span>{label}</span>
          </SidebarMenuButton>
        </PopoverTrigger>
        <NotificationsPopover unread={unread} onClose={close} side={isMobile ? "bottom" : "right"} />
      </Popover>
      {unread > 0 && (
        <SidebarMenuBadge aria-hidden className="rounded-full bg-primary px-1.5 text-primary-foreground peer-hover/menu-button:text-primary-foreground peer-data-active/menu-button:text-primary-foreground">
          {countLabel(unread)}
        </SidebarMenuBadge>
      )}
      <span role="status" aria-live="polite" className="sr-only">
        {announcement}
      </span>
    </SidebarMenuItem>
  )
}

function NotificationsPopover({ unread, onClose, side }: { unread: number; onClose: () => void; side: "right" | "bottom" }) {
  const { t } = useT()
  const headingRef = useRef<HTMLHeadingElement>(null)
  const { markAllRead, busy } = useMarkRead()

  return (
    <PopoverContent
      side={side}
      align="start"
      sideOffset={8}
      collisionPadding={12}
      aria-labelledby="notif-popover-title"
      // Land on the heading, not on "mark all": an accidental Enter must not clear the list.
      onOpenAutoFocus={(e) => {
        e.preventDefault()
        headingRef.current?.focus()
      }}
      className="w-[min(24rem,calc(100vw-1.5rem))] gap-0 p-0"
    >
      <header className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 border-b py-2 pr-1.5 pl-3">
        <h2 id="notif-popover-title" ref={headingRef} tabIndex={-1} className="rounded-sm text-sm font-semibold outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
          {t("nav.notifications")}
          {unread > 0 && (
            <Badge variant="secondary" className="ml-2 tabular-nums">
              <span aria-hidden>{countLabel(unread)}</span>
              <span className="sr-only">{fill(t("notif.unreadCount"), { count: countLabel(unread) })}</span>
            </Badge>
          )}
        </h2>
        <Button size="sm" variant="ghost" disabled={busy || unread === 0} onClick={() => void markAllRead()}>
          <CheckCheck />
          {t("notif.markAllRead")}
        </Button>
      </header>

      {/* Content children mount only while open, so the list is subscribed only then. */}
      <PopoverList onClose={onClose} />

      <footer className="flex items-center justify-between gap-2 border-t px-1.5 py-1.5">
        <Button size="sm" variant="ghost" asChild>
          <Link href={SETTINGS_HREF} onClick={onClose}>
            {t("notif.viewAll")}
          </Link>
        </Button>
        <Button size="sm" variant="ghost" asChild>
          <Link href={`${SETTINGS_HREF}?tab=preferences`} onClick={onClose}>
            <Settings2 />
            {t("notif.settings")}
          </Link>
        </Button>
      </footer>
    </PopoverContent>
  )
}

function PopoverList({ onClose }: { onClose: () => void }) {
  const { t } = useT()
  const now = useNow()
  const list = useQueryState({ query: api.notifications.listNotifications, args: { limit: POPOVER_LIMIT } })
  const { markRead } = useMarkRead()
  return (
    <div className="max-h-[min(28rem,60vh)] overflow-y-auto overscroll-contain p-1.5">
      {list.status === "pending" ? (
        <NotificationsSkeleton rows={3} dense />
      ) : list.status === "error" ? (
        <NotificationsError error={list.error} compact />
      ) : list.data.items.length === 0 ? (
        <NotificationsEmpty compact />
      ) : (
        <ul className="grid gap-0.5" aria-label={t("nav.notifications")}>
          {list.data.items.map((n) => (
            <NotificationItem key={n.id} n={n} now={now} dense onOpen={n.href ? onClose : undefined} onMarkRead={markRead} />
          ))}
        </ul>
      )}
    </div>
  )
}
