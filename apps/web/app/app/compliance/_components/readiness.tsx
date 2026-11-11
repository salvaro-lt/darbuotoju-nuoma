"use client"
import type { ReadinessCellView } from "@digimuza/staffing"
import { useQuery } from "convex/react"
import { ArrowLeft, FolderKanban, Package, TriangleAlert } from "lucide-react"
import Link from "next/link"
import { EmptyState } from "@/components/app/empty-state"
import { PageHeader } from "@/components/app/page-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { useT } from "@/lib/i18n/client"
import { AssignmentStatusBadge, CertBadge, Period, ProjectStatusBadge, projectHref, workerHref } from "../../staffing/_components/staffing-ui"
import { ComplianceDisabled, ComplianceTabs, complianceProjectHref, fmt, ReadinessBadge, useComplianceEnabled } from "./compliance-ui"

export function ReadinessList() {
  const { t } = useT()
  const on = useComplianceEnabled()
  const rows = useQuery(api.compliance.listReadiness, on ? {} : "skip")
  if (!on) return <ComplianceDisabled />
  return (
    <div>
      <PageHeader title={t("compliance.readiness.title")} lead={t("compliance.readiness.lead")} />
      <ComplianceTabs />
      {rows === undefined ? (
        <Skeleton className="h-48 w-full" />
      ) : rows.length === 0 ? (
        <EmptyState icon={<FolderKanban />} title={t("compliance.readiness.empty")} />
      ) : (
        <div className="rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("compliance.readiness.col.project")}</TableHead>
                <TableHead>{t("compliance.readiness.col.client")}</TableHead>
                <TableHead>{t("compliance.readiness.col.period")}</TableHead>
                <TableHead className="text-right">{t("compliance.readiness.col.documents")}</TableHead>
                <TableHead className="text-right">{t("compliance.readiness.col.team")}</TableHead>
                <TableHead>{t("compliance.readiness.col.state")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>
                    <Link href={complianceProjectHref(p.id)} className="font-medium hover:underline">
                      {p.code}
                    </Link>
                    <div className="text-xs text-muted-foreground">
                      {p.name} · {p.city}, {p.country}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm">{p.clientName}</TableCell>
                  <TableCell className="text-sm">
                    <Period from={p.startDate} to={p.endDate} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{p.documents}</TableCell>
                  <TableCell className="text-right tabular-nums">{p.team}</TableCell>
                  <TableCell>
                    <div className="flex flex-col items-start gap-1">
                      {p.documents === 0 ? (
                        <span className="text-xs text-muted-foreground">{t("compliance.readiness.noRequirementsShort")}</span>
                      ) : p.team > 0 ? (
                        <ReadinessBadge readiness={p.readiness} />
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                      {p.team > 0 && p.documents > 0 && <span className="text-xs text-muted-foreground">{fmt(t("compliance.readiness.counts"), p.counts)}</span>}
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

function Cell({ cell }: { cell: ReadinessCellView }) {
  const { t } = useT()
  if (cell.status === "notRequired") return <span className="text-xs text-muted-foreground">{t("compliance.readiness.notRequired")}</span>
  return (
    <div className="flex flex-col items-start gap-0.5">
      <CertBadge status={cell.status} />
      {cell.expiresAt && <span className="text-[11px] tabular-nums text-muted-foreground">{cell.expiresAt}</span>}
      {cell.number && <span className="text-[11px] text-muted-foreground">{cell.number}</span>}
      {cell.expiresDuring && (
        <span className="inline-flex items-center gap-1 text-[11px] text-amber-700 dark:text-amber-400">
          <TriangleAlert className="size-3" />
          {t("compliance.readiness.expiresDuring")}
        </span>
      )}
    </div>
  )
}

export function ProjectReadinessView({ projectId }: { projectId: string }) {
  const { t, locale } = useT()
  const on = useComplianceEnabled()
  const r = useQuery(api.compliance.getProjectReadiness, on ? { projectId: projectId as Id<"staffing_projects"> } : "skip")
  if (!on) return <ComplianceDisabled />
  if (r === undefined) return <Skeleton className="h-64 w-full" />
  if (r === null) return <p className="text-sm text-muted-foreground">404</p>
  const p = r.project
  return (
    <div>
      <Button variant="ghost" size="sm" asChild className="mb-2 -ml-2">
        <Link href="/app/compliance">
          <ArrowLeft />
          {t("compliance.readiness.back")}
        </Link>
      </Button>
      <PageHeader
        title={`${p.code} · ${p.name}`}
        lead={`${p.clientName} · ${p.city}, ${p.country}`}
        actions={
          <>
            <ProjectStatusBadge status={p.status as never} />
            <Button size="sm" variant="outline" asChild>
              <Link href={projectHref(p.id)}>{t("compliance.readiness.col.project")}</Link>
            </Button>
            <Button size="sm" asChild>
              <Link href={`${complianceProjectHref(p.id)}/package`}>
                <Package />
                {t("compliance.readiness.package")}
              </Link>
            </Button>
          </>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-3 text-sm">
        <Period from={p.startDate} to={p.endDate} />
        {r.rows.length > 0 && <ReadinessBadge readiness={r.readiness} />}
        {r.rows.length > 0 && <span className="text-muted-foreground">{fmt(t("compliance.readiness.counts"), r.counts)}</span>}
      </div>
      <Card>
        <CardHeader>
          <CardTitle>{t("compliance.readiness.matrix")}</CardTitle>
          <p className="text-sm text-muted-foreground">{t("compliance.readiness.matrixLead")}</p>
        </CardHeader>
        <CardContent>
          {r.documents.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("compliance.readiness.noRequirements")}</p>
          ) : r.rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("compliance.readiness.noTeam")}</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-52">{t("compliance.readiness.worker")}</TableHead>
                    {r.documents.map((d) => (
                      <TableHead key={d.certificateTypeId} className="min-w-32 align-bottom whitespace-normal">
                        {locale === "en" ? (d.nameEn ?? d.name) : d.name}
                        {d.scope === "nonEea" && <div className="text-[11px] font-normal text-muted-foreground">{t("compliance.readiness.nonEea")}</div>}
                      </TableHead>
                    ))}
                    <TableHead>{t("compliance.readiness.col.state")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {r.rows.map((row) => (
                    <TableRow key={row.assignmentId} className={row.readiness === "blocked" ? "bg-red-50/60 dark:bg-red-950/20" : undefined}>
                      <TableCell className="align-top">
                        <Link href={workerHref(row.workerId)} className="font-medium hover:underline">
                          {row.workerName}
                        </Link>
                        <div className="text-xs text-muted-foreground">
                          {row.tradeName} · {row.nationality}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
                          <AssignmentStatusBadge status={row.assignmentStatus} />
                          {fmt(t("compliance.readiness.checked"), { from: row.from, to: row.to ?? "…" })}
                        </div>
                      </TableCell>
                      {row.cells.map((c, i) => (
                        <TableCell key={i} className="align-top">
                          <Cell cell={c} />
                        </TableCell>
                      ))}
                      <TableCell className="align-top">
                        <ReadinessBadge readiness={row.readiness} />
                        {row.blockers.length > 0 && (
                          <div className="mt-1 max-w-48 text-[11px] text-red-700 dark:text-red-400">
                            {t("compliance.readiness.blockers")}: {row.blockers.join(", ")}
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
      <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
        {(["valid", "expiring60", "expiring30", "expired", "missing"] as const).map((s) => (
          <CertBadge key={s} status={s} />
        ))}
        <Badge variant="outline">
          <TriangleAlert className="size-3 text-amber-600" />
          {t("compliance.readiness.expiresDuring")}
        </Badge>
      </div>
    </div>
  )
}
