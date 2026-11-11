"use client"
import type { ProjectPackage } from "@digimuza/staffing"
import { escapeHtml, printableHtml, safeFileName, zipStore } from "@digimuza/staffing/compliance/pure"
import { useQuery } from "convex/react"
import { ArrowLeft, Download, FileText, Printer, TriangleAlert } from "lucide-react"
import Link from "next/link"
import { useState } from "react"
import { toast } from "sonner"
import { PageHeader } from "@/components/app/page-header"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { useT } from "@/lib/i18n/client"
import { CertBadge, Period } from "../../staffing/_components/staffing-ui"
import { ComplianceDisabled, complianceProjectHref, fmt, openPrintable, useComplianceEnabled } from "./compliance-ui"
import { PackageSendPanel } from "./package-send"

type T = ReturnType<typeof useT>["t"]

/** The cover list as a printable HTML page (also the index file inside the ZIP). */
function coverHtml(pkg: ProjectPackage, t: T, locale: "lt" | "en", withLinks: boolean): string {
  const p = pkg.project
  const docName = (d: ProjectPackage["documents"][number]) => (locale === "en" ? (d.nameEn ?? d.name) : d.name)
  const fileOf = (row: ProjectPackage["rows"][number], i: number) => pkg.files.find((f) => f.certificateId === row.cells[i]!.certificateId)
  const rows = pkg.rows
    .map((row) => {
      const cells = row.cells
        .map((c, i) => {
          if (c.status === "notRequired") return `<td class="muted">—</td>`
          if (c.status === "missing") return `<td class="bad">${escapeHtml(t("compliance.package.missing"))}</td>`
          const f = fileOf(row, i)
          const label = `${c.number ? `${escapeHtml(t("compliance.package.number"))} ${escapeHtml(c.number)}<br>` : ""}${escapeHtml(t("compliance.package.validUntil"))}: ${escapeHtml(c.expiresAt ?? t("compliance.package.noExpiry"))}`
          const link = f && withLinks ? `<br><a href="${escapeHtml(zipPath(row.workerName, docName(pkg.documents[i]!), f.fileName))}">${escapeHtml(f.fileName)}</a>` : ""
          return `<td class="${c.status === "expired" ? "bad" : ""}">${c.status === "expired" ? `${escapeHtml(t("compliance.package.expired"))}<br>` : ""}${label}${link}</td>`
        })
        .join("")
      return `<tr><td><b>${escapeHtml(row.workerName)}</b><br><span class="muted">${escapeHtml(row.nationality)}</span></td><td>${escapeHtml(row.tradeName)}</td><td>${escapeHtml(row.startDate)} – ${escapeHtml(row.endDate ?? "…")}</td>${cells}</tr>`
    })
    .join("\n")
  const body = `<h1>${escapeHtml(t("compliance.package.coverTitle"))}</h1>
<p><b>${escapeHtml(p.code)} · ${escapeHtml(p.name)}</b><br>${escapeHtml(p.clientName)} · ${escapeHtml(p.city)}, ${escapeHtml(p.country)}<br>${escapeHtml(p.startDate)} – ${escapeHtml(p.endDate ?? "…")}</p>
<p class="muted">${escapeHtml(fmt(t("compliance.package.generated"), { date: new Date().toISOString().slice(0, 10) }))}</p>
<table><thead><tr><th>${escapeHtml(t("compliance.readiness.worker"))}</th><th></th><th>${escapeHtml(t("compliance.readiness.col.period"))}</th>${pkg.documents.map((d) => `<th>${escapeHtml(docName(d))}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table>`
  return printableHtml(`${p.code} – ${t("compliance.package.coverTitle")}`, body, locale)
}

const zipPath = (worker: string, doc: string, fileName: string) => `${safeFileName(worker)}/${safeFileName(`${doc} - ${fileName}`)}`

export function ProjectPackageView({ projectId }: { projectId: string }) {
  const { t, locale } = useT()
  const on = useComplianceEnabled()
  const pkg = useQuery(api.compliance.getProjectPackage, on ? { projectId: projectId as Id<"staffing_projects"> } : "skip")
  const [zipping, setZipping] = useState(false)
  if (!on) return <ComplianceDisabled />
  if (pkg === undefined) return <Skeleton className="h-64 w-full" />
  if (pkg === null) return <p className="text-sm text-muted-foreground">404</p>
  const p = pkg.project
  const flagged = pkg.rows.filter((r) => r.readiness === "blocked")
  const docName = (i: number) => (locale === "en" ? (pkg.documents[i]!.nameEn ?? pkg.documents[i]!.name) : pkg.documents[i]!.name)

  async function downloadZip() {
    if (!pkg) return
    setZipping(true)
    try {
      const enc = new TextEncoder()
      const files: { name: string; data: Uint8Array }[] = [{ name: `00 ${safeFileName(t("compliance.package.coverTitle"))}.html`, data: enc.encode(coverHtml(pkg, t, locale, true)) }]
      for (const row of pkg.rows)
        for (const [i, c] of row.cells.entries()) {
          const f = pkg.files.find((x) => x.certificateId === c.certificateId)
          if (!f?.url || c.status === "notRequired") continue
          const res = await fetch(f.url)
          if (res.ok) files.push({ name: zipPath(row.workerName, docName(i), f.fileName), data: new Uint8Array(await res.arrayBuffer()) })
        }
      const blob = new Blob([zipStore(files) as BlobPart], { type: "application/zip" })
      const a = document.createElement("a")
      a.href = URL.createObjectURL(blob)
      a.download = `${safeFileName(p.code)} dokumentai.zip`
      a.click()
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000)
      toast.success(fmt(t("compliance.package.zipDone"), { count: files.length }))
    } catch {
      toast.error(t("error.unknown"))
    } finally {
      setZipping(false)
    }
  }

  return (
    <div>
      <Button variant="ghost" size="sm" asChild className="mb-2 -ml-2">
        <Link href={complianceProjectHref(p.id)}>
          <ArrowLeft />
          {p.code}
        </Link>
      </Button>
      <PageHeader
        title={`${t("compliance.package.title")} · ${p.code}`}
        lead={`${p.name} · ${p.clientName} · ${t("compliance.package.lead")}`}
        actions={
          pkg.rows.length > 0 && (
            <>
              <Button size="sm" variant="outline" onClick={() => openPrintable(coverHtml(pkg, t, locale, false))}>
                <Printer />
                {t("compliance.package.print")}
              </Button>
              <Button size="sm" disabled={zipping} onClick={downloadZip}>
                <Download />
                {zipping ? t("compliance.package.zipping") : t("compliance.package.zip")}
              </Button>
            </>
          )
        }
      />
      <div className="mb-4 text-sm">
        <Period from={p.startDate} to={p.endDate} />
      </div>
      <PackageSendPanel projectId={projectId} />
      {pkg.rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("compliance.package.noTeam")}</p>
      ) : (
        <>
          {flagged.length > 0 ? (
            <Alert variant="destructive" className="mb-4">
              <TriangleAlert />
              <AlertTitle>{fmt(t("compliance.package.flagged"), { count: flagged.length })}</AlertTitle>
              <AlertDescription>
                <p>{t("compliance.package.flaggedBody")}</p>
                <ul className="mt-1 list-disc pl-5">
                  {flagged.map((r) => (
                    <li key={r.assignmentId}>
                      <b>{r.workerName}</b>: {r.blockers.join(", ")}
                    </li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          ) : (
            <Alert className="mb-4">
              <AlertTitle>{t("compliance.package.allGood")}</AlertTitle>
            </Alert>
          )}
          <Card>
            <CardHeader>
              <CardTitle>{t("compliance.package.coverTitle")}</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-48">{t("compliance.readiness.worker")}</TableHead>
                    {pkg.documents.map((d, i) => (
                      <TableHead key={d.certificateTypeId} className="min-w-36 whitespace-normal">
                        {docName(i)}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pkg.rows.map((row) => (
                    <TableRow key={row.assignmentId} className={row.readiness === "blocked" ? "bg-destructive/[0.06] dark:bg-destructive/10" : undefined}>
                      <TableCell className="align-top">
                        <div className="font-medium">{row.workerName}</div>
                        <div className="text-xs text-muted-foreground">
                          {row.tradeName} · {row.nationality}
                        </div>
                      </TableCell>
                      {row.cells.map((c, i) => {
                        const f = pkg.files.find((x) => x.certificateId === c.certificateId)
                        return (
                          <TableCell key={i} className="align-top text-xs">
                            {c.status === "notRequired" ? (
                              <span className="text-muted-foreground">—</span>
                            ) : (
                              <div className="flex flex-col items-start gap-0.5">
                                <CertBadge status={c.status} />
                                {c.number && (
                                  <span>
                                    {t("compliance.package.number")} {c.number}
                                  </span>
                                )}
                                {c.status !== "missing" && <span className="tabular-nums text-muted-foreground">{c.expiresAt ?? t("compliance.package.noExpiry")}</span>}
                                {c.status !== "missing" &&
                                  (f?.url ? (
                                    <a href={f.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                                      <FileText className="size-3" />
                                      PDF
                                    </a>
                                  ) : (
                                    <span className="text-muted-foreground italic">{t("compliance.package.noFile")}</span>
                                  ))}
                              </div>
                            )}
                          </TableCell>
                        )
                      })}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <p className="mt-3 text-xs text-muted-foreground">{fmt(t("compliance.package.files"), { count: pkg.files.length })}</p>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
