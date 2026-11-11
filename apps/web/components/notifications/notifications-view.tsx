"use client"
import { useQuery_experimental as useQueryState } from "convex/react"
import { CheckCheck } from "lucide-react"
import { useSearchParams } from "next/navigation"
import { useId, useState } from "react"
import { PageHeader } from "@/components/app/page-header"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { api } from "@/convex/_generated/api"
import { useT } from "@/lib/i18n/client"
import { NotificationList } from "./notification-list"
import { NotificationPreferences } from "./notification-preferences"
import { useMarkRead } from "./use-notifications"

type Tab = "list" | "preferences"

/** /app/settings/notifications: the full list and the per-type preferences, one tab each (`?tab=preferences`). */
export function NotificationsView() {
  const { t } = useT()
  const params = useSearchParams()
  const tab: Tab = params.get("tab") === "preferences" ? "preferences" : "list"
  const filterId = useId()
  const [unreadOnly, setUnreadOnly] = useState(false)
  const count = useQueryState({ query: api.notifications.unreadNotificationCount, args: {} })
  const unread = count.status === "success" ? count.data : 0
  const { markAllRead, busy } = useMarkRead()

  // Native history keeps useSearchParams in sync without a server round trip.
  const select = (v: string) => window.history.replaceState(null, "", v === "preferences" ? "?tab=preferences" : window.location.pathname)

  return (
    <>
      <PageHeader title={t("nav.notifications")} lead={t("notif.page.lead")} />
      <Tabs value={tab} onValueChange={select} className="gap-4">
        <TabsList>
          <TabsTrigger value="list">{t("notif.tab.list")}</TabsTrigger>
          <TabsTrigger value="preferences">{t("notif.tab.preferences")}</TabsTrigger>
        </TabsList>

        <TabsContent value="list" className="grid gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Switch id={filterId} checked={unreadOnly} onCheckedChange={setUnreadOnly} />
              <Label htmlFor={filterId} className="font-normal">
                {t("notif.filter.unread")}
              </Label>
            </div>
            <Button size="sm" variant="outline" disabled={busy || unread === 0} onClick={() => void markAllRead()}>
              <CheckCheck />
              {t("notif.markAllRead")}
            </Button>
          </div>
          <NotificationList key={String(unreadOnly)} unreadOnly={unreadOnly} />
        </TabsContent>

        <TabsContent value="preferences">
          <NotificationPreferences />
        </TabsContent>
      </Tabs>
    </>
  )
}
