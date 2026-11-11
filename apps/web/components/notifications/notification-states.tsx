"use client"
import { systemErrorOf } from "@digimuza/system-core/react"
import { BellOff, CheckCheck, CircleAlert } from "lucide-react"
import { EmptyState } from "@/components/app/empty-state"
import { Skeleton } from "@/components/ui/skeleton"
import { useT } from "@/lib/i18n/client"
import { cn } from "@/lib/utils"

export function NotificationsSkeleton({ rows, dense }: { rows: number; dense?: boolean }) {
  const { t } = useT()
  return (
    <div role="status" aria-label={t("common.loading")} className="grid gap-0.5">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className={cn("flex gap-3 px-3", dense ? "py-2.5" : "py-3.5")}>
          <Skeleton className="size-8 shrink-0 rounded-md" />
          <div className="grid flex-1 gap-2 pt-1">
            <Skeleton className="h-3.5 w-2/3" />
            <Skeleton className="h-3 w-11/12" />
          </div>
        </div>
      ))}
    </div>
  )
}

/** Small inline message for the popover; the page uses the bordered EmptyState. */
function Compact({ icon, title, body, tone }: { icon: React.ReactNode; title: string; body: string; tone?: "error" }) {
  return (
    <div role={tone === "error" ? "alert" : undefined} className="flex flex-col items-center gap-1 px-6 py-8 text-center">
      <span aria-hidden className={cn("mb-2 flex size-9 items-center justify-center rounded-full [&>svg]:size-4", tone === "error" ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground")}>
        {icon}
      </span>
      <p className="text-sm font-medium">{title}</p>
      <p className="max-w-[32ch] text-sm text-pretty text-muted-foreground">{body}</p>
    </div>
  )
}

export function NotificationsEmpty({ compact, unreadOnly }: { compact?: boolean; unreadOnly?: boolean }) {
  const { t } = useT()
  const title = unreadOnly ? t("notif.emptyUnread.title") : t("notif.empty.title")
  const body = unreadOnly ? t("notif.emptyUnread.body") : t("notif.empty.body")
  const icon = unreadOnly ? <CheckCheck /> : <BellOff />
  return compact ? <Compact icon={icon} title={title} body={body} /> : <EmptyState icon={icon} title={title} body={body} />
}

export function NotificationsError({ error, compact }: { error: Error; compact?: boolean }) {
  const { t } = useT()
  const se = systemErrorOf(error)
  const body = `${t("notif.error.body")}${se?.operationId ? ` ${t("state.operation")} ${se.operationId}` : ""}`
  return compact ? <Compact tone="error" icon={<CircleAlert />} title={t("notif.error.title")} body={body} /> : <EmptyState icon={<CircleAlert />} title={t("notif.error.title")} body={body} />
}
