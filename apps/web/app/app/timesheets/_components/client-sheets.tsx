"use client"
import type { ClientSheetView, ProjectTimesheetState } from "@digimuza/staffing"
import { StaffingTimesheetsPermissions as P } from "@digimuza/staffing/timesheets/manifest"
import { addDays, todayIso } from "@digimuza/staffing/pure"
import { parseCsv, rowsFromTable, TIMESHEET_CADENCES, weekStartOf, type ClientRowInput, type ClientSheetSource, type TimesheetCadence } from "@digimuza/staffing/timesheets/pure"
import { Can } from "@digimuza/system-core/react"
import { useMutation, useQuery } from "convex/react"
import { FileUp, Settings2 } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState, type FormEvent } from "react"
import { EmptyState } from "@/components/app/empty-state"
import { useAction } from "@/components/app/use-action"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { extractText, imageThumbnail, openPdf, pageImage, uploadBlob } from "@/lib/documents/pdf"
import { useT } from "@/lib/i18n/client"
import type { MessageKey } from "@/lib/i18n/messages"
import { NativeSelect } from "../../staffing/_components/staffing-ui"
import { fmt, sheetHref, useDateFormat, useHours } from "./timesheets-ui"

export function SheetStatusBadge({ s }: { s: Pick<ClientSheetView, "status" | "mismatches" | "resolved"> }) {
  const { t } = useT()
  if (s.status !== "ready") return <Badge variant={s.status === "parsing" ? "outline" : "destructive"}>{t(`timesheets.sheets.status.${s.status}` as MessageKey)}</Badge>
  if (s.mismatches === 0) return <Badge variant="secondary">{t("timesheets.sheets.allOk")}</Badge>
  const open = s.mismatches - s.resolved
  return <Badge variant={open ? "destructive" : "secondary"}>{fmt(t("timesheets.sheets.resolvedOf"), { done: s.resolved, n: s.mismatches })}</Badge>
}

export function ClientSheets({ projectId }: { projectId: string }) {
  const { t } = useT()
  const d = useDateFormat()
  const hours = useHours()
  const pid = projectId as Id<"staffing_projects">
  const sheets = useQuery(api.timesheets.listClientSheets, { projectId: pid })
  const state = useQuery(api.timesheets.overview, {})?.find((p) => p.id === projectId)
  const [importing, setImporting] = useState(false)
  const [settings, setSettings] = useState(false)
  const importButton = (
    <Can permission={P.clientManage}>
      <Button size="sm" onClick={() => setImporting(true)}>
        <FileUp />
        {t("timesheets.sheets.import")}
      </Button>
    </Can>
  )
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-[60ch] text-sm text-muted-foreground">
          {t("timesheets.sheets.lead")}
          {state && (
            <>
              {" "}
              <span className="text-foreground">
                {t(`timesheets.cadence.${state.cadence}` as MessageKey)}, +{state.graceDays} d.
              </span>
              {state.due.late && (
                <Badge variant="destructive" className="ml-2">
                  {fmt(t("timesheets.late.daysLate"), { n: state.due.daysLate })}
                </Badge>
              )}
            </>
          )}
        </p>
        <div className="flex gap-2">
          <Can permission={P.clientManage}>
            <Button size="sm" variant="outline" disabled={!state} onClick={() => setSettings(true)}>
              <Settings2 />
              {t("timesheets.sheets.settings")}
            </Button>
          </Can>
          {importButton}
        </div>
      </div>
      {!sheets ? (
        <Skeleton className="h-40 w-full rounded-xl" />
      ) : sheets.length === 0 ? (
        <EmptyState icon={<FileUp />} title={t("timesheets.sheets.empty")} body={t("timesheets.sheets.emptyBody")} action={importButton} />
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="px-4">{t("timesheets.sheets.period")}</TableHead>
                <TableHead>{t("timesheets.sheets.file")}</TableHead>
                <TableHead className="text-right">{t("timesheets.sheets.hours")}</TableHead>
                <TableHead>{t("timesheets.sheets.mismatches")}</TableHead>
                <TableHead>{t("timesheets.sheets.received")}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {sheets.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="whitespace-nowrap px-4 tabular-nums">
                    {d.full(s.periodFrom)} – {d.full(s.periodTo)}
                  </TableCell>
                  <TableCell className="max-w-56 truncate text-sm">
                    {s.fileName ?? "—"} <span className="text-xs uppercase text-muted-foreground">{s.source}</span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{hours(s.totalHours, true)}</TableCell>
                  <TableCell>
                    <SheetStatusBadge s={s} />
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-sm text-muted-foreground">{d.stamp(s.receivedAt)}</TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant={s.mismatches > s.resolved ? "default" : "outline"} asChild>
                      <Link href={sheetHref(s.id)}>{t("timesheets.sheets.open")}</Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {importing && <ImportDialog projectId={projectId} onClose={() => setImporting(false)} />}
      {settings && state && <SettingsDialog state={state} onClose={() => setSettings(false)} />}
    </div>
  )
}

const isCsv = (f: File) => /\.(csv|txt|tsv)$/i.test(f.name) || f.type === "text/csv"
const isXlsx = (f: File) => /\.xlsx$/i.test(f.name) || f.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
const isPdfFile = (f: File) => /\.pdf$/i.test(f.name) || f.type === "application/pdf"
const isImageFile = (f: File) => /^image\/(png|jpe?g|webp)$/.test(f.type)

interface Prepared {
  source: ClientSheetSource
  rows: ClientRowInput[]
  text?: string
  pageImages: Blob[]
}

async function prepare(file: File, year: number): Promise<Prepared | null> {
  if (isCsv(file)) return { source: "csv", rows: rowsFromTable(parseCsv(await file.text()), { year }), pageImages: [] }
  if (isXlsx(file)) {
    const { readSheet } = await import("read-excel-file/browser")
    return { source: "xlsx", rows: rowsFromTable(await readSheet(file), { year }), pageImages: [] }
  }
  if (isPdfFile(file)) {
    const pdf = await openPdf(await file.arrayBuffer())
    const text = await extractText(pdf, 10).catch(() => "")
    const pageImages: Blob[] = []
    if (text.trim().length < 30) for (let p = 1; p <= Math.min(pdf.numPages, 3); p++) pageImages.push(await pageImage(pdf, p, 1800, 0.85))
    await pdf.cleanup()
    return { source: "pdf", rows: [], ...(text.trim().length >= 30 ? { text } : {}), pageImages }
  }
  if (isImageFile(file)) return { source: "image", rows: [], pageImages: [await imageThumbnail(file, 2000)] }
  return null
}

function ImportDialog({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const { t } = useT()
  const router = useRouter()
  const lastMonday = addDays(weekStartOf(todayIso()), -7)
  const [period, setPeriod] = useState({ from: lastMonday, to: addDays(lastMonday, 6) })
  const [file, setFile] = useState<File | null>(null)
  const [manual, setManual] = useState(false)
  const [prepared, setPrepared] = useState<Prepared | null>(null)
  const [reading, setReading] = useState(false)
  const [failed, setFailed] = useState(false)
  const uploadUrl = useMutation(api.timesheets.generateClientSheetUploadUrl)
  const importSheet = useMutation(api.timesheets.importClientSheet)
  const { run, busy } = useAction()

  async function choose(f: File | null) {
    setFile(f)
    setPrepared(null)
    setFailed(false)
    if (!f) return
    setReading(true)
    try {
      const p = await prepare(f, Number(period.from.slice(0, 4)))
      setPrepared(p)
      setFailed(!p)
      if (p?.rows.length) {
        const dates = p.rows.map((r) => r.date).sort()
        setPeriod({ from: weekStartOf(dates[0]!), to: addDays(weekStartOf(dates.at(-1)!), 6) })
      }
    } catch {
      setFailed(true)
    } finally {
      setReading(false)
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    const res = await run(async () => {
      if (manual || !file || !prepared) return importSheet({ projectId: projectId as Id<"staffing_projects">, periodFrom: period.from, periodTo: period.to, source: "manual" })
      const fileStorageId = (await uploadBlob(await uploadUrl({}), file)) as Id<"_storage">
      const pageImageIds: Id<"_storage">[] = []
      for (const img of prepared.pageImages) pageImageIds.push((await uploadBlob(await uploadUrl({}), img)) as Id<"_storage">)
      return importSheet({
        projectId: projectId as Id<"staffing_projects">,
        periodFrom: period.from,
        periodTo: period.to,
        source: prepared.source,
        fileStorageId,
        fileName: file.name,
        ...(prepared.source === "csv" || prepared.source === "xlsx" ? { rows: prepared.rows } : {}),
        ...(pageImageIds.length ? { pageImageIds } : {}),
        ...(prepared.text ? { text: prepared.text } : {}),
      })
    }, { success: t("timesheets.import.done") })
    if (res) router.push(sheetHref(res.id))
  }

  const viaAi = prepared?.source === "pdf" || prepared?.source === "image"
  const tableWithoutRows = (prepared?.source === "csv" || prepared?.source === "xlsx") && prepared.rows.length === 0
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("timesheets.import.title")}</DialogTitle>
          <DialogDescription>{t("timesheets.import.lead")}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit}>
          <FieldGroup>
            {!manual && (
              <Field>
                <FieldLabel htmlFor="ts-file">{t("timesheets.import.file")}</FieldLabel>
                <Input id="ts-file" type="file" accept=".csv,.txt,.xlsx,.pdf,image/png,image/jpeg,image/webp" onChange={(e) => void choose(e.target.files?.[0] ?? null)} />
                {reading && <p className="text-sm text-muted-foreground">{t("timesheets.import.reading")}</p>}
                {prepared && !viaAi && !tableWithoutRows && <p className="text-sm text-emerald-700 dark:text-emerald-400">{fmt(t("timesheets.import.preview"), { n: prepared.rows.length })}</p>}
                {(failed || tableWithoutRows) && <p className="text-sm text-destructive">{t("timesheets.import.noRows")}</p>}
                {viaAi && <p className="text-sm text-muted-foreground">{t("timesheets.import.viaAi")}</p>}
              </Field>
            )}
            <Label className="flex items-center gap-2 font-normal">
              <Checkbox checked={manual} onCheckedChange={(c) => setManual(c === true)} />
              {t("timesheets.import.manual")}
            </Label>
            <div className="grid grid-cols-2 gap-3">
              <Field>
                <FieldLabel htmlFor="ts-from">{t("timesheets.import.from")}</FieldLabel>
                <Input id="ts-from" type="date" required value={period.from} onChange={(e) => setPeriod({ ...period, from: e.target.value })} />
              </Field>
              <Field>
                <FieldLabel htmlFor="ts-to">{t("timesheets.import.to")}</FieldLabel>
                <Input id="ts-to" type="date" required value={period.to} onChange={(e) => setPeriod({ ...period, to: e.target.value })} />
              </Field>
            </div>
          </FieldGroup>
          <DialogFooter className="mt-4">
            <Button type="button" variant="outline" onClick={onClose}>
              {t("staffing.common.cancel")}
            </Button>
            <Button type="submit" disabled={busy || reading || (!manual && (!prepared || tableWithoutRows))}>
              {t("timesheets.import.submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function SettingsDialog({ state, onClose }: { state: ProjectTimesheetState; onClose: () => void }) {
  const { t } = useT()
  const save = useMutation(api.timesheets.saveSettings)
  const { run, busy } = useAction()
  const [f, setF] = useState({ cadence: state.cadence as TimesheetCadence, graceDays: String(state.graceDays), contactEmail: state.contactEmail ?? "", contactName: state.contactName ?? "" })
  async function submit(e: FormEvent) {
    e.preventDefault()
    const ok = await run(() => save({ projectId: state.id, cadence: f.cadence, graceDays: Number(f.graceDays), contactEmail: f.contactEmail, contactName: f.contactName }), { success: t("staffing.common.saved") })
    if (ok) onClose()
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("timesheets.sheets.settings")}</DialogTitle>
          <DialogDescription>{t("timesheets.sheets.settingsLead")}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit}>
          <FieldGroup>
            <div className="grid grid-cols-2 gap-3">
              <Field>
                <FieldLabel htmlFor="ts-cadence">{t("timesheets.sheets.cadence")}</FieldLabel>
                <NativeSelect id="ts-cadence" value={f.cadence} onChange={(v) => setF({ ...f, cadence: v as TimesheetCadence })}>
                  {TIMESHEET_CADENCES.map((c) => (
                    <option key={c} value={c}>
                      {t(`timesheets.cadence.${c}` as MessageKey)}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field>
                <FieldLabel htmlFor="ts-grace">{t("timesheets.sheets.graceDays")}</FieldLabel>
                <Input id="ts-grace" type="number" min={0} max={30} value={f.graceDays} onChange={(e) => setF({ ...f, graceDays: e.target.value })} />
              </Field>
            </div>
            <Field>
              <FieldLabel htmlFor="ts-contact-name">{t("timesheets.sheets.contactName")}</FieldLabel>
              <Input id="ts-contact-name" value={f.contactName} onChange={(e) => setF({ ...f, contactName: e.target.value })} />
            </Field>
            <Field>
              <FieldLabel htmlFor="ts-contact-email">{t("timesheets.sheets.contactEmail")}</FieldLabel>
              <Input id="ts-contact-email" type="email" value={f.contactEmail} onChange={(e) => setF({ ...f, contactEmail: e.target.value })} />
            </Field>
          </FieldGroup>
          <DialogFooter className="mt-4">
            <Button type="button" variant="outline" onClick={onClose}>
              {t("staffing.common.cancel")}
            </Button>
            <Button type="submit" disabled={busy}>
              {t("staffing.common.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
