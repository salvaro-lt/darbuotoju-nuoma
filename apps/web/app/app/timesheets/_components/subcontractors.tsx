"use client"
import type { SubcontractorTimesheet } from "@digimuza/staffing"
import { addDays, addMonths, todayIso } from "@digimuza/staffing/pure"
import { useQuery } from "convex/react"
import { ArrowLeft, Download, FileSpreadsheet, Moon, Printer } from "lucide-react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useEffect } from "react"
import { EmptyState } from "@/components/app/empty-state"
import { PageHeader } from "@/components/app/page-header"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { useT } from "@/lib/i18n/client"
import { NativeSelect } from "../../staffing/_components/staffing-ui"
import { timesheetsHref, TimesheetsDisabled, useDateFormat, useHours, useTimesheetsEnabled } from "./timesheets-ui"

/** Default period: last month. */
function defaults() {
  const firstThis = `${todayIso().slice(0, 7)}-01`
  return { from: addMonths(firstThis, -1), to: addDays(firstThis, -1) }
}

function useParams() {
  const params = useSearchParams()
  const d = defaults()
  return { sub: params.get("sub") ?? "", from: params.get("from") || d.from, to: params.get("to") || d.to, params }
}

export function SubcontractorExport() {
  const { t } = useT()
  const enabled = useTimesheetsEnabled()
  const router = useRouter()
  const pathname = usePathname()
  const { sub, from, to, params } = useParams()
  const subs = useQuery(api.timesheets.listSubcontractors, enabled ? {} : "skip")
  const chosen = sub || subs?.[0]?.id || ""
  const data = useQuery(api.timesheets.subcontractorTimesheet, enabled && chosen && from <= to ? { subcontractorId: chosen as Id<"staffing_clients">, from, to } : "skip")
  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params)
    next.set(k, v)
    router.replace(`${pathname}?${next}`, { scroll: false })
  }
  if (!enabled) return <TimesheetsDisabled />
  const q = new URLSearchParams({ sub: chosen, from, to })
  return (
    <div className="space-y-4">
      <Link href={timesheetsHref} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" />
        {t("timesheets.grid.back")}
      </Link>
      <PageHeader
        title={t("timesheets.sub.title")}
        lead={t("timesheets.sub.lead")}
        actions={
          data && data.rows.length > 0 ? (
            <>
              <Button size="sm" variant="outline" onClick={() => downloadCsv(data)}>
                <Download />
                {t("timesheets.sub.csv")}
              </Button>
              <Button size="sm" variant="outline" asChild>
                <Link href={`/print/timesheets/subcontractor?${q}`} target="_blank">
                  <Printer />
                  {t("timesheets.sub.print")}
                </Link>
              </Button>
            </>
          ) : undefined
        }
      />
      <div className="flex flex-wrap items-end gap-2">
        <NativeSelect aria-label={t("timesheets.sub.subcontractor")} value={chosen} onChange={(v) => set("sub", v)}>
          {!subs?.length && <option value="">{t("timesheets.sub.choose")}</option>}
          {subs?.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </NativeSelect>
        <Input type="date" className="w-40" aria-label={t("staffing.common.from")} value={from} onChange={(e) => e.target.value && set("from", e.target.value)} />
        <Input type="date" className="w-40" aria-label={t("staffing.common.to")} value={to} onChange={(e) => e.target.value && set("to", e.target.value)} />
      </div>
      <p className="text-xs text-muted-foreground">{t("timesheets.sub.onlyApproved")}</p>
      {!subs || (chosen && data === undefined) ? <Skeleton className="h-64 w-full rounded-xl" /> : !data || data.rows.length === 0 ? <EmptyState icon={<FileSpreadsheet />} title={t("timesheets.sub.empty")} /> : <SubcontractorTables data={data} />}
    </div>
  )
}

export function SubcontractorTables({ data, print }: { data: SubcontractorTimesheet; print?: boolean }) {
  const { t } = useT()
  const d = useDateFormat()
  const hours = useHours()
  const cell = print ? "px-2 py-1" : ""
  return (
    <div className="space-y-6">
      <section>
        <h2 className="mb-2 text-sm font-medium">{t("timesheets.sub.summary")}</h2>
        <div className={print ? "" : "overflow-x-auto rounded-xl border bg-card"}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className={`px-4 ${cell}`}>{t("timesheets.grid.worker")}</TableHead>
                <TableHead className={`text-right ${cell}`}>{t("timesheets.sub.days")}</TableHead>
                <TableHead className={`text-right ${cell}`}>{t("timesheets.grid.regular")}</TableHead>
                <TableHead className={`text-right ${cell}`}>{t("timesheets.grid.overtime")}</TableHead>
                <TableHead className={`text-right ${cell}`}>{t("timesheets.grid.total")}</TableHead>
                {print && <TableHead className={cell}>{t("timesheets.sub.signature")}</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.workers.map((w) => (
                <TableRow key={w.workerId}>
                  <TableCell className={`px-4 font-medium ${cell}`}>{w.workerName}</TableCell>
                  <TableCell className={`text-right tabular-nums ${cell}`}>{w.days}</TableCell>
                  <TableCell className={`text-right tabular-nums ${cell}`}>{hours(w.regular, true)}</TableCell>
                  <TableCell className={`text-right tabular-nums ${cell}`}>{hours(w.overtime, true)}</TableCell>
                  <TableCell className={`text-right font-medium tabular-nums ${cell}`}>{hours(w.regular + w.overtime, true)}</TableCell>
                  {print && <TableCell className={`w-40 border-b border-dashed ${cell}`} />}
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell className={`px-4 ${cell}`}>{t("timesheets.grid.total")}</TableCell>
                <TableCell className={cell} />
                <TableCell className={`text-right tabular-nums ${cell}`}>{hours(data.total.regular, true)}</TableCell>
                <TableCell className={`text-right tabular-nums ${cell}`}>{hours(data.total.overtime, true)}</TableCell>
                <TableCell className={`text-right font-semibold tabular-nums ${cell}`}>{hours(data.total.regular + data.total.overtime, true)}</TableCell>
                {print && <TableCell className={cell} />}
              </TableRow>
            </TableFooter>
          </Table>
        </div>
      </section>
      <section>
        <h2 className="mb-2 text-sm font-medium">{t("timesheets.sub.details")}</h2>
        <div className={print ? "" : "overflow-x-auto rounded-xl border bg-card"}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className={`px-4 ${cell}`}>{t("timesheets.grid.worker")}</TableHead>
                <TableHead className={cell}>{t("timesheets.rec.date")}</TableHead>
                <TableHead className={cell}>{t("timesheets.sub.project")}</TableHead>
                <TableHead className={cell}>{t("timesheets.sub.trade")}</TableHead>
                <TableHead className={`text-right ${cell}`}>{t("timesheets.grid.regular")}</TableHead>
                <TableHead className={`text-right ${cell}`}>{t("timesheets.grid.overtime")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.rows.map((r, i) => (
                <TableRow key={`${r.workerId}-${r.date}-${i}`}>
                  <TableCell className={`px-4 ${cell}`}>{r.workerName}</TableCell>
                  <TableCell className={`whitespace-nowrap tabular-nums ${cell} ${r.weekend ? "font-medium" : ""}`}>
                    <span className="capitalize text-muted-foreground">{d.weekday(r.date)}</span> {d.full(r.date)} {r.night && <Moon className="inline size-3 text-indigo-500" />}
                  </TableCell>
                  <TableCell className={`font-mono text-xs ${cell}`}>{r.projectCode}</TableCell>
                  <TableCell className={cell}>{r.trade}</TableCell>
                  <TableCell className={`text-right tabular-nums ${cell}`}>{hours(r.regular, true)}</TableCell>
                  <TableCell className={`text-right tabular-nums ${cell}`}>{hours(r.overtime)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>
    </div>
  )
}

function downloadCsv(data: SubcontractorTimesheet) {
  const esc = (v: string | number) => {
    const s = String(v)
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const lines = [["Darbuotojas", "Data", "Projektas", "Specialybė", "Įprastos val.", "Viršvalandžiai", "Savaitgalis", "Naktis"].join(";")]
  for (const r of data.rows) lines.push([r.workerName, r.date, r.projectCode, r.trade, String(r.regular).replace(".", ","), String(r.overtime).replace(".", ","), r.weekend ? "taip" : "", r.night ? "taip" : ""].map(esc).join(";"))
  const blob = new Blob(["﻿", `${lines.join("\r\n")}\r\n`], { type: "text/csv;charset=utf-8" })
  const a = document.createElement("a")
  a.href = URL.createObjectURL(blob)
  a.download = `tabelis_${data.subcontractor.code}_${data.from}_${data.to}.csv`
  a.click()
  URL.revokeObjectURL(a.href)
}

export function SubcontractorPrint() {
  const { t } = useT()
  const d = useDateFormat()
  const { sub, from, to } = useParams()
  const data = useQuery(api.timesheets.subcontractorTimesheet, sub ? { subcontractorId: sub as Id<"staffing_clients">, from, to } : "skip")
  useEffect(() => {
    if (data) setTimeout(() => window.print(), 300)
  }, [data])
  if (!data) return <Skeleton className="h-96 w-full" />
  return (
    <div className="mx-auto max-w-4xl bg-white p-6 text-black print:p-0">
      <header className="mb-6 border-b pb-3">
        <h1 className="text-xl font-semibold">{t("timesheets.sub.printTitle")}</h1>
        <p className="text-sm">
          {data.subcontractor.name} ({data.subcontractor.code}) · {d.full(data.from)} – {d.full(data.to)}
        </p>
        <p className="text-xs text-neutral-600">{t("timesheets.sub.onlyApproved")}</p>
      </header>
      <SubcontractorTables data={data} print />
      <footer className="mt-10 grid grid-cols-2 gap-10 text-sm">
        <div className="border-t pt-1">{t("timesheets.sub.signature")}</div>
        <div className="border-t pt-1">{t("timesheets.sub.signature")}</div>
      </footer>
      <div className="mt-6 print:hidden">
        <Button size="sm" onClick={() => window.print()}>
          <Printer />
          {t("timesheets.sub.print")}
        </Button>
      </div>
    </div>
  )
}
