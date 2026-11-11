"use client"
import { useQuery_experimental as useQueryState } from "convex/react"
import { BellOff } from "lucide-react"
import { Fragment } from "react"
import { EmptyState } from "@/components/app/empty-state"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { api } from "@/convex/_generated/api"
import { useT } from "@/lib/i18n/client"
import { NotificationsError } from "./notification-states"
import { fill, moduleLabel, typeAbout, typeName } from "./render"
import { useSetPreference, type NotificationPreference } from "./use-notifications"

/** Per-type channels, grouped by module. Each switch saves at once (optimistic; errors toast and roll back). */
export function NotificationPreferences() {
  const { t, locale } = useT()
  const state = useQueryState({ query: api.notifications.getNotificationPreferences, args: {} })
  const setPreference = useSetPreference()

  if (state.status === "error") return <NotificationsError error={state.error} />
  if (state.status === "success" && state.data.length === 0) return <EmptyState icon={<BellOff />} title={t("notif.pref.empty")} />

  const groups = new Map<string, NotificationPreference[]>()
  for (const p of state.status === "success" ? state.data : []) groups.set(p.moduleId, [...(groups.get(p.moduleId) ?? []), p])

  const channels = (d: NotificationPreference["defaultChannels"]) => {
    const on = [d.inApp && t("notif.pref.inApp"), d.email && t("notif.pref.email")].filter((x): x is string => !!x).map((x) => x.toLocaleLowerCase(locale))
    return on.length ? fill(t("notif.pref.defaults"), { channels: on.join(", ") }) : t("notif.pref.defaultsNone")
  }

  return (
    <div className="grid gap-3">
      <p className="max-w-[65ch] text-sm text-muted-foreground">{t("notif.pref.lead")}</p>
      <div className="overflow-hidden rounded-xl border bg-card">
        <Table>
          <TableHeader className="bg-muted/50">
            <TableRow className="hover:bg-transparent">
              <TableHead className="h-10 px-4 text-xs font-medium text-muted-foreground">{t("notif.pref.type")}</TableHead>
              <TableHead className="h-10 w-28 px-4 text-center text-xs font-medium text-muted-foreground">{t("notif.pref.inApp")}</TableHead>
              <TableHead className="h-10 w-28 px-4 text-center text-xs font-medium text-muted-foreground">{t("notif.pref.email")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {state.status === "pending"
              ? Array.from({ length: 2 }, (_, i) => (
                  <TableRow key={i} className="hover:bg-transparent">
                    <TableCell className="px-4 py-4">
                      <Skeleton className="h-4 w-1/3" />
                      <Skeleton className="mt-2 h-3 w-2/3" />
                    </TableCell>
                    <TableCell className="px-4 text-center">
                      <Skeleton className="mx-auto h-[18px] w-8 rounded-full" />
                    </TableCell>
                    <TableCell className="px-4 text-center">
                      <Skeleton className="mx-auto h-[18px] w-8 rounded-full" />
                    </TableCell>
                  </TableRow>
                ))
              : [...groups].map(([moduleId, prefs]) => (
                  <Fragment key={moduleId}>
                    <TableRow className="hover:bg-transparent">
                      <TableHead colSpan={3} scope="colgroup" className="h-9 bg-muted/30 px-4 text-xs font-semibold text-foreground">
                        {moduleLabel(moduleId, locale)}
                      </TableHead>
                    </TableRow>
                    {prefs.map((p) => {
                      const name = typeName(p.type, p.description, locale)
                      const about = typeAbout(p.type, locale) ?? (p.description !== name ? p.description : null)
                      return (
                        <TableRow key={p.type} className="hover:bg-transparent">
                          <TableCell className="px-4 py-3.5 align-top whitespace-normal">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-medium">{name}</span>
                              {p.customized ? <Badge variant="secondary">{t("notif.pref.customized")}</Badge> : <Badge variant="outline">{t("notif.pref.default")}</Badge>}
                            </div>
                            {about && <p className="mt-1 max-w-[60ch] text-sm text-pretty text-muted-foreground">{about}</p>}
                            {p.customized && <p className="mt-1 text-xs text-muted-foreground">{channels(p.defaultChannels)}</p>}
                          </TableCell>
                          <TableCell className="px-4 py-3.5 text-center align-top">
                            <Switch className="mt-0.5" checked={p.inApp} aria-label={`${name}: ${t("notif.pref.inApp")}`} onCheckedChange={(v) => setPreference(p, { inApp: v })} />
                          </TableCell>
                          <TableCell className="px-4 py-3.5 text-center align-top">
                            <Switch className="mt-0.5" checked={p.email} aria-label={`${name}: ${t("notif.pref.email")}`} onCheckedChange={(v) => setPreference(p, { email: v })} />
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </Fragment>
                ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
