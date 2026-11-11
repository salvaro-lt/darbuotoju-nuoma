"use client"
import type { LogisticsPlan, MemberRow } from "@digimuza/staffing"
import { StaffingLogisticsPermissions } from "@digimuza/staffing/logistics/manifest"
import { addDays } from "@digimuza/staffing/pure"
import { Can, useCan } from "@digimuza/system-core/react"
import { useMutation, useQuery } from "convex/react"
import { ArrowLeft, BedDouble, Bus, CalendarRange, Car, CheckCheck, ChevronLeft, ChevronRight, RefreshCw, Send, Shirt, Wand2 } from "lucide-react"
import Link from "next/link"
import { useState } from "react"
import { PageHeader } from "@/components/app/page-header"
import { useAction } from "@/components/app/use-action"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { useT } from "@/lib/i18n/client"
import type { MessageKey } from "@/lib/i18n/messages"
import { Period, ProjectStatusBadge, workerHref } from "../../staffing/_components/staffing-ui"
import { eur, planNames, Select, SeverityIcon, shortDate, useLogisticsEnabled, useWarningText } from "./logistics-ui"
import { Resources } from "./resources"
import { Timeline } from "./timeline"
import { Travel } from "./travel"
import { Workwear } from "./workwear"

export function ProjectLogistics({ projectId }: { projectId: string }) {
  const { t } = useT()
  const enabled = useLogisticsEnabled()
  const [from, setFrom] = useState<string | undefined>(undefined)
  const plan = useQuery(api.logistics.getPlan, enabled ? { projectId: projectId as Id<"staffing_projects">, ...(from ? { from } : {}) } : "skip")
  if (!enabled) return <p className="text-sm text-muted-foreground">{t("logistics.disabled")}</p>
  if (plan === undefined) return <Skeleton className="h-96 w-full rounded-xl" />
  if (plan === null) return <p className="text-sm text-muted-foreground">{t("logistics.common.notFound")}</p>
  const p = plan.project
  const shift = (days: number) => setFrom(addDays(plan.window.from, days))
  const windowNav = (
    <div className="flex items-center gap-1">
      <Button variant="outline" size="icon-sm" onClick={() => shift(-14)} aria-label={t("logistics.window.prev")}>
        <ChevronLeft />
      </Button>
      <Button variant="outline" size="sm" onClick={() => setFrom(undefined)}>
        {t("logistics.window.today")}
      </Button>
      <Button variant="outline" size="icon-sm" onClick={() => shift(14)} aria-label={t("logistics.window.next")}>
        <ChevronRight />
      </Button>
      <span className="ml-2 text-xs text-muted-foreground tabular-nums">
        {t("logistics.window")}: {plan.window.from} – {plan.window.to}
      </span>
    </div>
  )
  return (
    <div>
      <Link href="/app/logistics" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" />
        {t("logistics.back")}
      </Link>
      <PageHeader
        title={p.name}
        lead={`${p.code} · ${p.clientName} · ${p.city}, ${p.country}`}
        actions={
          <div className="flex items-center gap-2 text-sm">
            <Period from={p.startDate} to={p.endDate} />
            <ProjectStatusBadge status={p.status} />
          </div>
        }
      />
      <ChangeBanner plan={plan} />
      <Tabs defaultValue="plan" className="mt-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TabsList>
            <TabsTrigger value="plan">
              <CalendarRange />
              {t("logistics.tab.plan")}
            </TabsTrigger>
            <TabsTrigger value="timeline">
              <RefreshCw />
              {t("logistics.tab.timeline")}
            </TabsTrigger>
            <TabsTrigger value="resources">
              <BedDouble />
              {t("logistics.tab.resources")}
            </TabsTrigger>
            <TabsTrigger value="travel">
              <Bus />
              {t("logistics.tab.travel")}
            </TabsTrigger>
            <TabsTrigger value="workwear">
              <Shirt />
              {t("logistics.tab.workwear")}
            </TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="plan" className="mt-4 space-y-6">
          <WarningsCard plan={plan} />
          <TeamTable plan={plan} />
          <CostsCard plan={plan} />
        </TabsContent>
        <TabsContent value="timeline" className="mt-4 space-y-3">
          {windowNav}
          <Timeline plan={plan} />
        </TabsContent>
        <TabsContent value="resources" className="mt-4">
          <Resources plan={plan} />
        </TabsContent>
        <TabsContent value="travel" className="mt-4">
          <Travel plan={plan} />
        </TabsContent>
        <TabsContent value="workwear" className="mt-4">
          <Workwear plan={plan} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

// ---------------------------------------------------------------- plan changed

function ChangeBanner({ plan }: { plan: LogisticsPlan }) {
  const { t } = useT()
  const ack = useMutation(api.logistics.acknowledgePlan)
  const { run, busy } = useAction()
  const canManage = useCan(StaffingLogisticsPermissions.planManage)
  const d = plan.diff
  const doAck = () => void run(() => ack({ projectId: plan.project.id }), { success: t("logistics.diff.acked") })
  if (!d) {
    if (plan.members.length === 0) return null
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed px-4 py-3 text-sm text-muted-foreground">
        {t("logistics.diff.never")}
        {canManage && (
          <Button size="sm" variant="outline" disabled={busy} onClick={doAck}>
            <CheckCheck />
            {t("logistics.diff.ackFirst")}
          </Button>
        )}
      </div>
    )
  }
  if (d.added.length + d.removed.length + d.changed.length === 0) return null
  return (
    <div className="rounded-xl border border-marking-foreground/50 bg-marking/15 px-4 py-3 dark:border-marking-foreground/50 dark:bg-marking/20" role="status">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium text-marking-foreground dark:text-marking dark:text-marking">{t("logistics.diff.title")}</p>
          <p className="text-sm text-marking-foreground dark:text-marking dark:text-marking">{t("logistics.diff.lead")}</p>
          <ul className="mt-2 space-y-0.5 text-sm">
            {d.added.map((e) => (
              <li key={`a${e.workerId}`}>
                <span className="font-medium text-steel-green dark:text-steel-green">+ {t("logistics.diff.added")}:</span> {e.name} <span className="text-muted-foreground tabular-nums">({e.ranges.replaceAll("..", " – ")})</span>
              </li>
            ))}
            {d.removed.map((e) => (
              <li key={`r${e.workerId}`}>
                <span className="font-medium text-destructive dark:text-destructive">− {t("logistics.diff.removed")}:</span> {e.name}
              </li>
            ))}
            {d.changed.map((c) => (
              <li key={`c${c.after.workerId}`}>
                <span className="font-medium">~ {t("logistics.diff.changed")}:</span> {c.after.name}{" "}
                <span className="text-muted-foreground tabular-nums">
                  {c.before.ranges.replaceAll("..", " – ")} → {c.after.ranges.replaceAll("..", " – ")}
                </span>
              </li>
            ))}
          </ul>
        </div>
        {canManage && (
          <Button size="sm" disabled={busy} onClick={doAck}>
            <CheckCheck />
            {t("logistics.diff.ack")}
          </Button>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- warnings and notifications

function WarningsCard({ plan }: { plan: LogisticsPlan }) {
  const { t, locale } = useT()
  const text = useWarningText()
  const names = planNames(plan)
  const notify = useMutation(api.logistics.notifyCoordinator)
  const setDaily = useMutation(api.logistics.setDailyDigest)
  const { run, busy } = useAction()
  const ws = plan.plan.warnings
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle>
            {t("logistics.warnings.title")} <span className="text-muted-foreground tabular-nums">({ws.length})</span>
          </CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">{t("logistics.warnings.lead")}</p>
        </div>
        <Can permission={StaffingLogisticsPermissions.planManage}>
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <Switch id="daily-digest" checked={plan.dailyDigest} disabled={busy} onCheckedChange={(v) => void run(() => setDaily({ projectId: plan.project.id, enabled: v }), { success: t("logistics.common.saved") })} />
              <Label htmlFor="daily-digest" className="text-sm font-normal">
                {t("logistics.notify.daily")}
              </Label>
            </div>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void run(() => notify({ projectId: plan.project.id }), { success: t("logistics.notify.queued") })}>
              <Send />
              {t("logistics.notify.button")}
            </Button>
          </div>
        </Can>
      </CardHeader>
      <CardContent className="space-y-4">
        {ws.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("logistics.warnings.none")}</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {ws.map((w, i) => (
              <li key={i} className="flex items-start gap-2.5 px-3 py-2 text-sm">
                <SeverityIcon severity={w.severity} />
                <span>{text(w, names)}</span>
              </li>
            ))}
          </ul>
        )}
        {plan.notifications.length > 0 && (
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">{t("logistics.notify.last")}</p>
            <ul className="space-y-0.5 text-xs text-muted-foreground">
              {plan.notifications.map((n) => (
                <li key={n.id} className="flex flex-wrap gap-x-2">
                  <span className="tabular-nums">{new Date(n.createdAt).toLocaleString(locale === "en" ? "en-GB" : "lt-LT")}</span>
                  <span>{n.title}</span>
                  <span>→ {n.to || "?"}</span>
                  <Badge variant={n.status === "sent" ? "secondary" : n.status === "failed" ? "destructive" : "outline"}>{t(`logistics.notify.status.${n.status}` as MessageKey)}</Badge>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------- team: who, where, when

function arrivalOf(plan: LogisticsPlan, m: MemberRow) {
  return plan.travelLegs.find((l) => l.workerId === m.workerId && l.direction === "arrival" && l.date <= m.startDate && l.date >= addDays(m.startDate, -7)) ?? null
}

function TeamTable({ plan }: { plan: LogisticsPlan }) {
  const { t, locale } = useT()
  const canManage = useCan(StaffingLogisticsPermissions.planManage)
  const setAllocation = useMutation(api.logistics.setAllocation)
  const autoAssign = useMutation(api.logistics.autoAssign)
  const { run, busy } = useAction()
  const pid = plan.project.id
  const today = plan.window.today
  const auto = (kind: "beds" | "seats") => void run(() => autoAssign({ projectId: pid, kind }).then((r) => r), { success: t("logistics.auto.done") })
  const set = (m: MemberRow, patch: { accommodationId?: string | null; vehicleId?: string | null; driver?: boolean }) =>
    void run(
      () =>
        setAllocation({
          projectId: pid,
          workerId: m.workerId as Id<"staffing_workers">,
          ...(patch.accommodationId !== undefined ? { accommodationId: patch.accommodationId as Id<"staffing_logistics_accommodations"> | null } : {}),
          ...(patch.vehicleId !== undefined ? { vehicleId: patch.vehicleId as Id<"staffing_logistics_vehicles"> | null } : {}),
          ...(patch.driver !== undefined ? { driver: patch.driver } : {}),
        }),
      { success: t("logistics.common.saved") },
    )
  const noBedIds = new Set(plan.plan.warnings.filter((w) => w.kind === "no_bed").map((w) => w.workerId))
  const members = plan.members.filter((m) => !m.endDate || m.endDate >= addDays(today, -7))
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle>{t("logistics.team.title")}</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">{t("logistics.team.driverHint")}</p>
        </div>
        {canManage && members.length > 0 && (
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={busy || plan.accommodations.length === 0} onClick={() => auto("beds")}>
              <Wand2 />
              {t("logistics.auto.beds")}
            </Button>
            <Button size="sm" variant="outline" disabled={busy || plan.vehicles.length === 0} onClick={() => auto("seats")}>
              <Car />
              {t("logistics.auto.seats")}
            </Button>
          </div>
        )}
      </CardHeader>
      <CardContent>
        {members.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("logistics.team.empty")}</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>{t("logistics.team.worker")}</TableHead>
                  <TableHead>{t("logistics.team.period")}</TableHead>
                  <TableHead>{t("logistics.team.arrival")}</TableHead>
                  <TableHead>{t("logistics.team.bed")}</TableHead>
                  <TableHead>{t("logistics.team.seat")}</TableHead>
                  <TableHead>{t("logistics.team.driver")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.map((m) => {
                  const leg = arrivalOf(plan, m)
                  const upcoming = m.startDate >= today
                  const eligible = m.isDriver && m.licenceOk
                  return (
                    <TableRow key={m.assignmentId}>
                      <TableCell>
                        <Link href={workerHref(m.workerId)} className="font-medium hover:underline">
                          {m.name}
                        </Link>
                        <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                          {locale === "en" ? m.tradeNameEn : m.tradeName}
                          {m.isDriver && (
                            <Badge variant={m.licenceOk ? "secondary" : "destructive"} className="h-4 px-1.5 text-[10px]">
                              <Car className="size-3" />
                              {m.licenceOk ? t("logistics.team.licence") : t("logistics.team.noLicence")}
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm">
                        <Period from={m.startDate} to={m.endDate} />
                        {upcoming && <Badge variant="outline" className="ml-1.5">{shortDate(m.startDate)}</Badge>}
                      </TableCell>
                      <TableCell className="text-sm whitespace-nowrap">
                        {leg ? (
                          <span className="inline-flex items-center gap-1.5">
                            <span className="tabular-nums">{shortDate(leg.date)}</span>
                            <Badge variant={leg.booked ? "secondary" : "destructive"}>{leg.booked ? t("logistics.team.booked") : t("logistics.team.unbooked")}</Badge>
                          </span>
                        ) : upcoming ? (
                          <Badge variant="destructive">{t("logistics.team.noTrip")}</Badge>
                        ) : (
                          <span className="text-muted-foreground">{t("logistics.common.none")}</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Select
                          aria-label={t("logistics.team.bed")}
                          value={m.accommodationId ?? ""}
                          onChange={(v) => set(m, { accommodationId: v || null })}
                          className={`w-48 ${noBedIds.has(m.workerId) ? "border-destructive/60 text-destructive dark:text-destructive" : ""}`}
                          disabled={!canManage || busy}
                        >
                          <option value="">{t("logistics.team.noBed")}</option>
                          {plan.accommodations.map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.name}
                            </option>
                          ))}
                        </Select>
                      </TableCell>
                      <TableCell>
                        <Select aria-label={t("logistics.team.seat")} value={m.vehicleId ?? ""} onChange={(v) => set(m, { vehicleId: v || null })} className="w-44" disabled={!canManage || busy}>
                          <option value="">{t("logistics.team.noSeat")}</option>
                          {plan.vehicles.map((v) => (
                            <option key={v.id} value={v.id}>
                              {v.model} {v.plate}
                            </option>
                          ))}
                        </Select>
                      </TableCell>
                      <TableCell>
                        <Checkbox aria-label={t("logistics.team.driver")} checked={m.driver} disabled={!canManage || busy || !m.vehicleId || (!eligible && !m.driver)} onCheckedChange={(c) => set(m, { driver: c === true })} />
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------- costs

function CostsCard({ plan }: { plan: LogisticsPlan }) {
  const { t } = useT()
  const c = plan.plan.costs
  const items: [string, number, boolean][] = [
    [t("logistics.costs.accommodation"), c.accommodationCents, false],
    [t("logistics.costs.vehicles"), c.vehicleCents, false],
    [t("logistics.costs.tickets"), c.ticketCents, false],
    [t("logistics.costs.waste"), c.emptyBedCents, true],
  ]
  return (
    <div>
      <p className="mb-2 text-sm font-medium">
        {t("logistics.costs.title")}{" "}
        <span className="font-normal text-muted-foreground tabular-nums">
          ({plan.window.from} – {plan.window.to})
        </span>
      </p>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {items.map(([label, cents, waste]) => (
          <div key={label} className="rounded-xl border bg-card px-4 py-3">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className={`text-lg font-semibold tabular-nums ${waste && cents > 0 ? "text-marking-foreground dark:text-marking dark:text-marking" : ""}`}>{eur(cents)}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
