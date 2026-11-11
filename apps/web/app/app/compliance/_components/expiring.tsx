"use client"
import { StaffingCompliancePermissions } from "@digimuza/staffing/compliance/manifest"
import { fold } from "@digimuza/staffing/pure"
import { Can } from "@digimuza/system-core/react"
import { useMutation, useQuery } from "convex/react"
import { BellRing, CalendarClock, Search, TriangleAlert } from "lucide-react"
import Link from "next/link"
import { useState } from "react"
import { toast } from "sonner"
import { EmptyState } from "@/components/app/empty-state"
import { PageHeader } from "@/components/app/page-header"
import { useAction } from "@/components/app/use-action"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { api } from "@/convex/_generated/api"
import { useT } from "@/lib/i18n/client"
import type { MessageKey } from "@/lib/i18n/messages"
import { CertBadge, NativeSelect, workerHref } from "../../staffing/_components/staffing-ui"
import { ComplianceDisabled, ComplianceTabs, complianceProjectHref, fmt, useComplianceEnabled } from "./compliance-ui"

type Window = "all" | "30" | "60" | "expired"

export function ExpiringView() {
  const { t, locale } = useT()
  const on = useComplianceEnabled()
  const items = useQuery(api.compliance.listExpiring, on ? {} : "skip")
  const runs = useQuery(api.compliance.listDigestRuns, on ? {} : "skip")
  const send = useMutation(api.compliance.sendDigest)
  const { run, busy } = useAction()
  const [win, setWin] = useState<Window>("all")
  const [onlyProject, setOnlyProject] = useState(false)
  const [search, setSearch] = useState("")
  if (!on) return <ComplianceDisabled />

  const needle = fold(search.trim())
  const shown = (items ?? []).filter(
    (i) =>
      (win === "all" || (win === "expired" ? i.daysLeft < 0 : win === "30" ? i.daysLeft >= 0 && i.daysLeft <= 30 : i.daysLeft > 30)) &&
      (!onlyProject || i.hitsProject) &&
      (!needle || fold(`${i.workerName} ${i.typeName} ${i.typeNameEn ?? ""} ${i.project?.code ?? ""}`).includes(needle)),
  )
  const count = (w: Window) => (items ?? []).filter((i) => (w === "expired" ? i.daysLeft < 0 : w === "30" ? i.daysLeft >= 0 && i.daysLeft <= 30 : w === "60" ? i.daysLeft > 30 : true)).length

  async function sendNow() {
    const r = await run(() => send({}))
    if (!r) return
    if (r.items) toast.success(fmt(t("compliance.expiring.sent"), { count: r.items }))
    else toast.info(t("compliance.expiring.nothing"))
  }

  return (
    <div>
      <PageHeader
        title={t("compliance.expiring.title")}
        lead={t("compliance.expiring.lead")}
        actions={
          <Can permission={StaffingCompliancePermissions.digestSend}>
            <Button size="sm" disabled={busy} onClick={sendNow}>
              <BellRing />
              {t("compliance.expiring.send")}
            </Button>
          </Can>
        }
      />
      <ComplianceTabs />
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        {(
          [
            ["expired", "compliance.expiring.expired", "text-destructive"],
            ["30", "compliance.expiring.in30", "text-marking-foreground dark:text-marking"],
            ["60", "compliance.expiring.in60", "text-marking-foreground dark:text-marking"],
          ] as const
        ).map(([w, key, color]) => (
          <button key={w} type="button" onClick={() => setWin(win === w ? "all" : w)} className={`rounded-xl border p-4 text-left transition-colors hover:bg-muted/50 ${win === w ? "ring-2 ring-ring" : ""}`}>
            <div className="text-sm text-muted-foreground">{t(key)}</div>
            <div className={`text-3xl font-semibold tabular-nums ${color}`}>{items === undefined ? "…" : count(w)}</div>
          </button>
        ))}
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-8" placeholder={t("compliance.expiring.search")} aria-label={t("compliance.expiring.search")} value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <NativeSelect aria-label={t("compliance.expiring.window")} value={win} onChange={(v) => setWin(v as Window)}>
          <option value="all">{t("compliance.expiring.all")}</option>
          <option value="expired">{t("compliance.expiring.expired")}</option>
          <option value="30">{t("compliance.expiring.in30")}</option>
          <option value="60">{t("compliance.expiring.in60")}</option>
        </NativeSelect>
        <div className="flex items-center gap-2">
          <Checkbox id="only-project" checked={onlyProject} onCheckedChange={(v) => setOnlyProject(v === true)} />
          <Label htmlFor="only-project" className="text-sm font-normal">
            {t("compliance.expiring.onlyProject")}
          </Label>
        </div>
      </div>
      {items === undefined ? (
        <Skeleton className="h-64 w-full" />
      ) : shown.length === 0 ? (
        <EmptyState icon={<CalendarClock />} title={t("compliance.expiring.empty")} />
      ) : (
        <div className="rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("compliance.expiring.col.worker")}</TableHead>
                <TableHead>{t("compliance.expiring.col.document")}</TableHead>
                <TableHead>{t("compliance.expiring.col.expires")}</TableHead>
                <TableHead className="text-right">{t("compliance.expiring.col.left")}</TableHead>
                <TableHead>{t("compliance.expiring.col.project")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map((i) => (
                <TableRow key={i.certificateId}>
                  <TableCell>
                    <Link href={workerHref(i.workerId)} className="font-medium hover:underline">
                      {i.workerName}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <div>{locale === "en" ? (i.typeNameEn ?? i.typeName) : i.typeName}</div>
                    {i.number && <div className="text-xs text-muted-foreground">{i.number}</div>}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col items-start gap-1">
                      <span className="tabular-nums">{i.expiresAt}</span>
                      <CertBadge status={i.status} />
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{i.daysLeft < 0 ? fmt(t("compliance.expiring.ago"), { n: -i.daysLeft }) : fmt(t("compliance.expiring.days"), { n: i.daysLeft })}</TableCell>
                  <TableCell>
                    {i.project ? (
                      <div className="flex flex-col items-start gap-0.5">
                        <Link href={complianceProjectHref(i.project.id)} className="hover:underline">
                          {i.project.code} <span className="text-muted-foreground">· {i.project.name}</span>
                        </Link>
                        <span className="text-xs text-muted-foreground">
                          {t(i.project.when === "current" ? "compliance.expiring.current" : "compliance.expiring.next")} · {i.project.startDate} – {i.project.endDate ?? "…"}
                        </span>
                        {i.hitsProject && (
                          <span className="inline-flex items-center gap-1 text-xs text-destructive dark:text-destructive">
                            <TriangleAlert className="size-3" />
                            {t("compliance.expiring.hits")}
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>{t("compliance.expiring.runs")}</CardTitle>
          <p className="text-sm text-muted-foreground">{t("compliance.expiring.runsLead")}</p>
        </CardHeader>
        <CardContent>
          {!runs?.length ? (
            <p className="text-sm text-muted-foreground">{t("compliance.expiring.noRuns")}</p>
          ) : (
            <ul className="divide-y text-sm">
              {runs.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-2 py-2">
                  <span className="tabular-nums text-muted-foreground">{new Date(r.createdAt).toLocaleString(locale === "en" ? "en-GB" : "lt-LT")}</span>
                  <Badge variant="outline">{t(`compliance.run.${r.trigger}` as MessageKey)}</Badge>
                  <Badge variant={r.status === "sent" ? "secondary" : r.status === "failed" ? "destructive" : "outline"}>{t(`compliance.run.${r.status}` as MessageKey)}</Badge>
                  {r.items.length > 0 && <span>{fmt(t("compliance.run.items"), { count: r.items.length })}</span>}
                  {r.to && <span className="text-muted-foreground">→ {r.to}</span>}
                  {r.error && <span className="text-xs text-muted-foreground">({r.error})</span>}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
