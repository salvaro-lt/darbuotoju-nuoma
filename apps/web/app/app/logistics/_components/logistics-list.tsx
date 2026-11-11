"use client"
import { useQuery } from "convex/react"
import { BedDouble, CheckCircle2 } from "lucide-react"
import Link from "next/link"
import { EmptyState } from "@/components/app/empty-state"
import { PageHeader } from "@/components/app/page-header"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { api } from "@/convex/_generated/api"
import { useT } from "@/lib/i18n/client"
import { Period, ProjectStatusBadge } from "../../staffing/_components/staffing-ui"
import { CountPill, logisticsHref, useLogisticsEnabled } from "./logistics-ui"

export function LogisticsList() {
  const { t } = useT()
  const enabled = useLogisticsEnabled()
  const projects = useQuery(api.logistics.listProjects, enabled ? {} : "skip")
  if (!enabled) return <p className="text-sm text-muted-foreground">{t("logistics.disabled")}</p>
  return (
    <div>
      <PageHeader title={t("logistics.title")} lead={t("logistics.lead")} />
      {!projects ? (
        <Skeleton className="h-64 w-full rounded-xl" />
      ) : projects.length === 0 ? (
        <EmptyState icon={<BedDouble />} title={t("logistics.empty")} body={t("logistics.emptyBody")} />
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="px-4">{t("logistics.col.project")}</TableHead>
                <TableHead>{t("logistics.col.site")}</TableHead>
                <TableHead>{t("logistics.team.period")}</TableHead>
                <TableHead className="text-right">{t("logistics.col.people")}</TableHead>
                <TableHead className="text-right">{t("logistics.col.vehicles")}</TableHead>
                <TableHead>{t("logistics.col.warnings")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {projects.map((p) => (
                <TableRow key={p.projectId}>
                  <TableCell className="px-4">
                    <Link href={logisticsHref(p.projectId)} className="font-medium hover:underline">
                      {p.name}
                    </Link>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="font-mono">{p.code}</span>
                      <span>·</span>
                      <span>{p.clientName}</span>
                    </div>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {p.city}, {p.country}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-1">
                      <Period from={p.startDate} to={p.endDate} />
                      <span>
                        <ProjectStatusBadge status={p.status} />
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className={`text-right tabular-nums ${p.peopleToday > p.bedsToday ? "font-semibold text-destructive dark:text-destructive" : ""}`}>
                    {p.peopleToday} / {p.bedsToday}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{p.vehicles}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <CountPill n={p.errors} tone="error" label={t("logistics.errors")} />
                      <CountPill n={p.warnings} tone="warning" label={t("logistics.warningsShort")} />
                      {p.errors + p.warnings === 0 && (
                        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                          <CheckCircle2 className="size-3.5 text-steel-green" />
                          {t("logistics.noWarnings")}
                        </span>
                      )}
                      {p.changed && <Badge variant="outline">{t("logistics.changed")}</Badge>}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
