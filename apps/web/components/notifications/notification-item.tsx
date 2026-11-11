"use client"
import { Bell, Check, MailWarning, Receipt, ShieldCheck } from "lucide-react"
import Link from "next/link"
import { useId, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { formatDate, formatTime } from "@/lib/format"
import { useT } from "@/lib/i18n/client"
import { cn } from "@/lib/utils"
import { relativeTime, renderNotification } from "./render"
import type { Notification } from "./use-notifications"

function TypeIcon({ type, moduleId }: { type: string; moduleId: string }) {
  const area = type.split(".")[0] ?? moduleId
  if (area === "finance") return <Receipt />
  if (area === "roles") return <ShieldCheck />
  return <Bell />
}

/**
 * One notification row. The title is a stretched link (or button without href)
 * covering the row; "mark as read" sits above it as its own control.
 * `dense` is the popover variant: body clamped to two lines.
 */
export function NotificationItem({ n, now, dense, onOpen, onMarkRead }: { n: Notification; now: number; dense?: boolean; onOpen?: () => void; onMarkRead: (id: Notification["id"]) => void }) {
  const { t, locale } = useT()
  const bodyId = useId()
  const rowRef = useRef<HTMLLIElement>(null)
  const { title, body } = renderNotification(n.type, n.params, locale)
  const unread = n.readAt === null
  // The control that was used disappears once read: keep focus on the row instead of losing it to <body>.
  const markRead = () => {
    onMarkRead(n.id)
    rowRef.current?.focus()
  }
  const open = () => {
    if (unread) onMarkRead(n.id)
    if (onOpen) onOpen()
    else if (!n.href) rowRef.current?.focus()
  }
  const target = cn(
    "rounded-sm text-left outline-none after:absolute after:inset-0 after:rounded-lg focus-visible:after:ring-[3px] focus-visible:after:ring-ring/50",
    unread ? "font-medium text-foreground" : "text-foreground/80",
  )

  return (
    <li ref={rowRef} tabIndex={-1} className={cn("group/notif relative flex gap-3 rounded-lg px-3 outline-none transition-colors hover:bg-accent/60 focus-visible:ring-[3px] focus-visible:ring-ring/50", dense ? "py-2.5" : "py-3.5", unread && "bg-accent/30")}>
      <span aria-hidden className={cn("mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md [&>svg]:size-4", unread ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}>
        <TypeIcon type={n.type} moduleId={n.moduleId} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          {unread && (
            <span className="relative top-[-1px] size-2 shrink-0 self-center rounded-full bg-primary">
              <span className="sr-only">{t("notif.unread")}</span>
            </span>
          )}
          {n.href ? (
            <Link href={n.href} onClick={open} aria-describedby={bodyId} className={cn(target, "min-w-0 flex-1 truncate text-sm")}>
              {title}
            </Link>
          ) : unread ? (
            <button type="button" onClick={open} aria-describedby={bodyId} className={cn(target, "min-w-0 flex-1 truncate text-sm")}>
              {title}
            </button>
          ) : (
            <span className={cn("min-w-0 flex-1 truncate text-sm", unread ? "font-medium" : "text-foreground/80")}>{title}</span>
          )}
          <time dateTime={new Date(n.createdAt).toISOString()} title={`${formatDate(n.createdAt, locale)} ${formatTime(n.createdAt, locale)}`} className="shrink-0 text-xs text-muted-foreground tabular-nums">
            {relativeTime(n.createdAt, now, locale)}
          </time>
        </div>
        <p id={bodyId} className={cn("mt-0.5 text-sm text-muted-foreground", dense && "line-clamp-2", unread && "pr-8")}>
          {body}
        </p>
        {n.emailStatus === "failed" && (
          <p className="mt-1 inline-flex items-center gap-1 text-xs text-destructive">
            <MailWarning className="size-3.5" aria-hidden />
            {t("notif.email.failed")}
          </p>
        )}
        {!dense && n.emailStatus === "sent" && <p className="mt-1 text-xs text-muted-foreground">{t("notif.email.sent")}</p>}
      </div>
      {unread && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="icon-sm"
              variant="ghost"
              className="absolute right-2 bottom-2 z-10 text-muted-foreground hover:text-foreground"
              aria-label={`${t("notif.markRead")}: ${title}`}
              onClick={markRead}
            >
              <Check />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t("notif.markRead")}</TooltipContent>
        </Tooltip>
      )}
    </li>
  )
}
