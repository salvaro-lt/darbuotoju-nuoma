"use client"
import type { ProjectTimesheetState } from "@digimuza/staffing"
import { StaffingTimesheetsPermissions as P } from "@digimuza/staffing/timesheets/manifest"
import { Can } from "@digimuza/system-core/react"
import { useMutation, useQuery } from "convex/react"
import { AlarmClock, CheckCircle2, ClipboardCheck, FileSpreadsheet, Send } from "lucide-react"
import Link from "next/link"
import { EmptyState } from "@/components/app/empty-state"
import { PageHeader } from "@/components/app/page-header"
import { useAction } from "@/components/app/use-action"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { useT } from "@/lib/i18n/client"
import type { MessageKey } from "@/lib/i18n/messages"
import { fmt, projectTimesheetHref, sheetHref, TimesheetsDisabled, useDateFormat, useHours, useTimesheetsEnabled } from "./timesheets-ui"

export function TimesheetsOverview() {
  const { t } = useT()
  const enabled = useTimesheetsEnabled()
  const projects = useQuery(api.timesheets.overview, enabled ? {} : "skip")
  const hours = useHours()
  const d = useDateFormat()
  if (!enabled) return <TimesheetsDisabled />
  const late = projects?.filter((p) => p.due.late) ?? []
  const actions = (
    <Can permission={P.export}>
      <Button size="sm" variant="outline" asChild>
        <Link href="/app/timesheets/subcontractors">
          <FileSpreadsheet />
          {t("timesheets.overview.subcontractors")}
        </Link>
      </Button>
    </Can>
  )
  return (
    <div className="space-y-6">
      <PageHeader title={t("timesheets.overview.title")} lead={t("timesheets.overview.lead")} actions={actions} />

      <Card className={late.length ? "border-marking-foreground/50 dark:border-marking-foreground/50" : undefined}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlarmClock className="size-4 text-marking-foreground dark:text-marking" />
            {t("timesheets.late.title")}
            {late.length > 0 && <Badge variant="destructive">{late.length}</Badge>}
          </CardTitle>
          <CardDescription>{t("timesheets.late.lead")}</CardDescription>
        </CardHeader>
        <CardContent>
          {!projects ? (
            <Skeleton className="h-16 w-full" />
          ) : late.length === 0 ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <CheckCircle2 className="size-4 text-steel-green" />
              {t("timesheets.late.none")}
            </p>
          ) : (
            <ul className="divide-y">
              {late.map((p) => (
                <LateRow key={p.id} p={p} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <section>
        <h2 className="mb-3 text-sm font-medium text-muted-foreground">{t("timesheets.overview.projects")}</h2>
        {!projects ? (
          <Skeleton className="h-48 w-full rounded-xl" />
        ) : projects.length === 0 ? (
          <EmptyState icon={<ClipboardCheck />} title={t("timesheets.overview.empty")} body={t("timesheets.overview.emptyBody")} />
        ) : (
          <div className="overflow-x-auto rounded-xl border bg-card">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="px-4">{t("staffing.common.code")}</TableHead>
                  <TableHead>{t("staffing.common.name")}</TableHead>
                  <TableHead className="text-right">{t("timesheets.overview.thisWeek")}</TableHead>
                  <TableHead>{t("timesheets.overview.lastWeek")}</TableHead>
                  <TableHead>{t("timesheets.overview.clientSheet")}</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {projects.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="px-4 font-mono text-xs">{p.code}</TableCell>
                    <TableCell>
                      <Link href={projectTimesheetHref(p.id)} className="font-medium hover:underline">
                        {p.name}
                      </Link>
                      <div className="text-xs text-muted-foreground">
                        {p.clientName} · {t(`timesheets.cadence.${p.cadence}` as MessageKey)}
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{hours(p.weekHours, true)} h</TableCell>
                    <TableCell>{p.lastWeekApproved ? <Badge variant="secondary">{t("timesheets.overview.approved")}</Badge> : <Badge variant="outline">{t("timesheets.overview.notApproved")}</Badge>}</TableCell>
                    <TableCell className="whitespace-nowrap text-sm">
                      {p.due.late ? (
                        <Badge variant="destructive">{fmt(t("timesheets.late.daysLate"), { n: p.due.daysLate })}</Badge>
                      ) : (
                        <Badge variant="secondary">{t("timesheets.overview.onTime")}</Badge>
                      )}{" "}
                      {p.lastSheet ? (
                        <Link href={sheetHref(p.lastSheet.id)} className="text-muted-foreground hover:underline">
                          {fmt(t("timesheets.overview.receivedTo"), { date: d.full(p.lastSheet.periodTo) })}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">{t("timesheets.overview.noneReceived")}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" asChild>
                        <Link href={projectTimesheetHref(p.id)}>{t("timesheets.overview.open")}</Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
    </div>
  )
}

function LateRow({ p }: { p: ProjectTimesheetState }) {
  const { t } = useT()
  const d = useDateFormat()
  const send = useMutation(api.timesheets.sendReminder)
  const { run, busy } = useAction()
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs">{p.code}</span>
          <Link href={projectTimesheetHref(p.id)} className="font-medium hover:underline">
            {p.name}
          </Link>
          <Badge variant="destructive">{fmt(t("timesheets.late.daysLate"), { n: p.due.daysLate })}</Badge>
        </div>
        <div className="mt-0.5 text-sm text-muted-foreground">
          {p.clientName} · {fmt(t("timesheets.late.missing"), { from: d.full(p.due.missingFrom ?? p.startDate), to: d.full(p.due.expectedTo ?? p.startDate) })}
        </div>
        <div className="text-xs text-muted-foreground">
          {p.contactEmail ? `${t("timesheets.late.contact")}: ${p.contactName ? `${p.contactName} <${p.contactEmail}>` : p.contactEmail}` : t("timesheets.late.noContact")}
          {p.lastReminder && ` · ${fmt(t("timesheets.late.lastReminder"), { date: d.stamp(p.lastReminder.createdAt) })} (${t(`timesheets.reminder.status.${p.lastReminder.status}` as MessageKey)})`}
        </div>
      </div>
      <Can permission={P.clientManage}>
        <Button size="sm" variant="outline" disabled={busy || !p.contactEmail} onClick={() => run(() => send({ projectId: p.id as Id<"staffing_projects"> }), { success: t("timesheets.reminder.queued") })}>
          <Send />
          {t("timesheets.late.remind")}
        </Button>
      </Can>
    </li>
  )
}
