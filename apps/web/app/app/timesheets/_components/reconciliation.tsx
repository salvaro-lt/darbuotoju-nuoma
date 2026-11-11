"use client"
import type { ReconcileLine, ReconciliationView, ResolutionAction } from "@digimuza/staffing"
import { StaffingTimesheetsPermissions as P } from "@digimuza/staffing/timesheets/manifest"
import { weekStartOf, type RawClientRow } from "@digimuza/staffing/timesheets/pure"
import { Can, useCan } from "@digimuza/system-core/react"
import { useMutation, useQuery } from "convex/react"
import { AlertTriangle, ArrowLeft, Check, ExternalLink, Gavel, ListTree, Loader2, MailCheck, MessageSquare, Plus, RotateCcw, Trash2, Undo2 } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Fragment, useMemo, useState, type FormEvent } from "react"
import { useAction } from "@/components/app/use-action"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { useT } from "@/lib/i18n/client"
import type { MessageKey } from "@/lib/i18n/messages"
import { ConfirmDelete, NativeSelect } from "../../staffing/_components/staffing-ui"
import { SheetStatusBadge } from "./client-sheets"
import { disputeHref, fmt, parseHoursInput, projectTimesheetHref, TimesheetsDisabled, useDateFormat, useHours, useTimesheetsEnabled } from "./timesheets-ui"

const KIND_STYLE: Record<ReconcileLine["kind"], string> = {
  ok: "bg-steel-green/15 text-steel-green dark:bg-steel-green/15 dark:text-steel-green",
  diff: "bg-marking/15 text-marking-foreground dark:text-marking dark:bg-marking/15 dark:text-marking",
  missing_ours: "bg-destructive/15 text-destructive dark:bg-destructive/15 dark:text-destructive",
  missing_theirs: "bg-secondary text-foreground dark:bg-secondary dark:text-foreground",
  unknown_worker: "bg-muted text-muted-foreground dark:bg-muted dark:text-muted-foreground",
}

export function Reconciliation({ sheetId }: { sheetId: string }) {
  const { t } = useT()
  const enabled = useTimesheetsEnabled()
  const id = sheetId as Id<"staffing_timesheets_clientSheets">
  const view = useQuery(api.timesheets.getReconciliation, enabled ? { sheetId: id } : "skip")
  const fileUrl = useQuery(api.timesheets.getClientSheetFileUrl, enabled ? { sheetId: id } : "skip")
  const [onlyMismatches, setOnlyMismatches] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)
  const hours = useHours()
  const d = useDateFormat()
  const rawBy = useMemo(() => {
    const m = new Map<string, RawClientRow[]>()
    for (const r of view?.sheet.rawRows ?? []) {
      const k = `${r.name.trim().replace(/\s+/g, " ")}|${r.date}`
      m.set(k, [...(m.get(k) ?? []), r])
    }
    return m
  }, [view?.sheet.rawRows])
  if (!enabled) return <TimesheetsDisabled />
  if (view === null) return <p className="text-sm text-muted-foreground">{t("staffing.common.notFound")}</p>
  if (!view) return <Skeleton className="h-96 w-full rounded-xl" />
  const { sheet, reconciliation: rec } = view
  const lines = onlyMismatches ? rec.lines.filter((l) => l.kind !== "ok") : rec.lines
  const workerName = new Map(view.workers.map((w) => [w.id, w.name]))
  const open = rec.lines.filter((l) => l.kind !== "ok" && !view.resolutions[l.key]).length
  return (
    <div className="space-y-5">
      <Link href={`${projectTimesheetHref(view.project.id)}?tab=client`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" />
        {t("timesheets.rec.back")}
      </Link>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="font-mono text-xs text-muted-foreground">{view.project.code}</div>
          <h1 className="font-stencil-title text-[2.1rem] sm:text-[2.4rem]">{t("timesheets.rec.title")}</h1>
          <p className="text-sm text-muted-foreground">
            {view.project.name} · {view.project.clientName} · {d.full(sheet.periodFrom)} – {d.full(sheet.periodTo)}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
            <SheetStatusBadge s={sheet} />
            {sheet.fileName && <span className="text-muted-foreground">{sheet.fileName}</span>}
            {fileUrl && (
              <a href={fileUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                <ExternalLink className="size-3.5" />
                {t("timesheets.rec.openFile")}
              </a>
            )}
          </div>
        </div>
        <DeleteSheet sheetId={id} projectId={view.project.id} />
      </header>

      <ReviewBanner view={view} />
      <SheetState view={view} />

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label={t("timesheets.rec.oursTotal")} value={`${hours(rec.totals.ours, true)} h`} />
        <Stat label={t("timesheets.rec.theirsTotal")} value={`${hours(rec.totals.theirs, true)} h`} hint={rec.totals.theirs !== rec.totals.ours ? `${rec.totals.theirs > rec.totals.ours ? "+" : ""}${hours(rec.totals.theirs - rec.totals.ours)} h` : undefined} />
        <Stat label={t("timesheets.rec.mismatches")} value={String(rec.totals.mismatches)} hint={rec.totals.mismatches ? fmt(t("timesheets.sheets.resolvedOf"), { done: rec.totals.mismatches - open, n: rec.totals.mismatches }) : undefined} warn={open > 0} />
      </div>

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="flex items-center gap-2 text-sm font-normal">
            <Checkbox checked={onlyMismatches} onCheckedChange={(c) => setOnlyMismatches(c === true)} />
            {t("timesheets.rec.onlyMismatches")}
          </Label>
        </div>
        {lines.length === 0 ? (
          <p className="flex items-center gap-2 rounded-xl border bg-card p-4 text-sm text-muted-foreground">
            <Check className="size-4 text-steel-green" />
            {t("timesheets.rec.allGood")}
          </p>
        ) : (
          <div className="overflow-x-auto rounded-xl border bg-card">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="px-4">{t("timesheets.rec.worker")}</TableHead>
                  <TableHead>{t("timesheets.rec.date")}</TableHead>
                  <TableHead className="text-right">{t("timesheets.rec.ours")}</TableHead>
                  <TableHead className="text-right">{t("timesheets.rec.theirs")}</TableHead>
                  <TableHead className="text-right">{t("timesheets.rec.diff")}</TableHead>
                  <TableHead>{t("timesheets.rec.status")}</TableHead>
                  <TableHead>{t("timesheets.rec.actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.map((l) => {
                  const raw = l.clientName ? (rawBy.get(`${l.clientName}|${l.date}`) ?? []) : []
                  return (
                  <Fragment key={l.key}>
                  <TableRow>
                    <TableCell className="px-4">
                      <div className="font-medium">{l.workerId ? workerName.get(l.workerId) : l.clientName}</div>
                      {l.clientName && l.workerId && <div className="text-xs text-muted-foreground">„{l.clientName}“</div>}
                    </TableCell>
                    <TableCell className="whitespace-nowrap tabular-nums">
                      <span className="capitalize text-muted-foreground">{d.weekday(l.date)}</span> {d.full(l.date)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{l.ours === null ? "—" : hours(l.ours, true)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {l.theirs === null ? "—" : hours(l.theirs, true)}
                      {raw.length > 1 && (
                        <button type="button" className="ml-1.5 inline-flex items-center gap-0.5 rounded px-1 text-xs text-primary hover:bg-primary/10" aria-expanded={expanded === l.key} onClick={() => setExpanded(expanded === l.key ? null : l.key)}>
                          <ListTree className="size-3" />
                          {fmt(t("timesheets.raw.lines"), { n: raw.length })}
                        </button>
                      )}
                    </TableCell>
                    <TableCell className={`text-right font-medium tabular-nums ${l.diff > 0 ? "text-destructive" : l.diff < 0 ? "text-foreground dark:text-foreground" : "text-muted-foreground"}`}>
                      {l.diff ? `${l.diff > 0 ? "+" : ""}${hours(l.diff)}` : "0"}
                    </TableCell>
                    <TableCell>
                      <span className={`inline-flex rounded-md px-2 py-0.5 text-xs font-medium ${KIND_STYLE[l.kind]}`}>{t(`timesheets.rec.kind.${l.kind}` as MessageKey)}</span>
                    </TableCell>
                    <TableCell>{l.kind !== "ok" && <LineActions view={view} line={l} />}</TableCell>
                  </TableRow>
                  {expanded === l.key && (
                    <TableRow className="bg-muted/40 hover:bg-muted/40">
                      <TableCell colSpan={7} className="px-4 py-2">
                        <RawLines rows={raw} />
                      </TableCell>
                    </TableRow>
                  )}
                  </Fragment>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      {rec.names.length > 0 && <NameMatching view={view} />}
      <ClientRows view={view} />
    </div>
  )
}

function RawLines({ rows }: { rows: RawClientRow[] }) {
  const { t } = useT()
  const hours = useHours()
  const total = rows.reduce((s, r) => s + r.minutes, 0)
  return (
    <div className="space-y-1.5">
      <div className="text-xs font-medium text-muted-foreground">
        {t("timesheets.raw.title")} · {fmt(t("timesheets.raw.minutes"), { n: total })} = {hours(Math.round((total / 60) * 100) / 100, true)} h
      </div>
      <ol className="grid gap-x-4 gap-y-0.5 text-xs tabular-nums sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((r, i) => (
          <li key={i} className="flex justify-between gap-2 border-b border-dashed py-0.5">
            <span className="truncate text-muted-foreground">{r.ref ?? "—"}</span>
            <span>{fmt(t("timesheets.raw.minutes"), { n: r.minutes })}</span>
          </li>
        ))}
      </ol>
    </div>
  )
}

function ReviewBanner({ view }: { view: ReconciliationView }) {
  const { t } = useT()
  const confirm = useMutation(api.timesheets.confirmSheetReview)
  const { run, busy } = useAction()
  const s = view.sheet
  if (!s.email && !s.rawRowCount) return null
  return (
    <div className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4 ${s.review === "pending" ? "border-marking-foreground/40 bg-marking/15" : "bg-card"}`}>
      <div className="min-w-0 space-y-0.5 text-sm">
        {s.review === "pending" && (
          <div className="flex items-center gap-2 font-medium">
            <MailCheck className="size-4" />
            {t("timesheets.review.pending")}
          </div>
        )}
        {s.review === "pending" && <p className="text-muted-foreground">{t("timesheets.review.pendingLead")}</p>}
        {s.email && <p className="text-muted-foreground">{fmt(t("timesheets.review.email"), { from: s.email.from, subject: s.email.subject })}</p>}
        {s.rawRowCount > 0 && <p className="text-muted-foreground">{fmt(t("timesheets.raw.count"), { raw: s.rawRowCount, rows: s.rowCount })}</p>}
      </div>
      {s.review === "pending" && (
        <Can permission={P.clientManage}>
          <Button size="sm" disabled={busy || s.status === "parsing"} onClick={() => run(() => confirm({ sheetId: s.id as Id<"staffing_timesheets_clientSheets"> }), { success: t("timesheets.review.confirmed") })}>
            <Check />
            {t("timesheets.review.confirm")}
          </Button>
        </Can>
      )}
    </div>
  )
}

function DisputeLine({ view, line }: { view: ReconciliationView; line: ReconcileLine }) {
  const { t } = useT()
  const create = useMutation(api.timesheets.createDispute)
  const { run, busy } = useAction()
  const router = useRouter()
  if (!line.workerId || line.diff >= 0) return null
  return (
    <Button
      size="sm"
      variant="ghost"
      className="h-7"
      disabled={busy}
      onClick={async () => {
        const res = await run(() => create({ workerId: line.workerId as Id<"staffing_workers">, projectId: view.project.id as Id<"staffing_projects">, periodFrom: view.sheet.periodFrom, periodTo: view.sheet.periodTo, kind: "mismatch", sheetId: view.sheet.id as Id<"staffing_timesheets_clientSheets"> }))
        if (res) router.push(disputeHref(res.id))
      }}
    >
      <Gavel />
      {t("timesheets.rec.dispute")}
    </Button>
  )
}

function Stat({ label, value, hint, warn }: { label: string; value: string; hint?: string | undefined; warn?: boolean }) {
  return (
    <div className={`rounded-xl border bg-card p-4 ${warn ? "border-marking-foreground/50 dark:border-marking-foreground/50" : ""}`}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
    </div>
  )
}

function SheetState({ view }: { view: ReconciliationView }) {
  const { t } = useT()
  const retry = useMutation(api.timesheets.retryAiParse)
  const { run, busy } = useAction()
  const s = view.sheet
  if (s.status === "ready") return null
  if (s.status === "parsing")
    return (
      <Alert>
        <Loader2 className="animate-spin" />
        <AlertDescription>{t("timesheets.rec.parsing")}</AlertDescription>
      </Alert>
    )
  return (
    <Alert variant="destructive">
      <AlertTriangle />
      <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
        <span>
          {s.status === "ai_not_configured"
            ? t("timesheets.rec.aiNotConfigured")
            : s.email && !s.hasFile
              ? fmt(t("timesheets.review.noFile"), { error: s.error ?? "?" })
              : `${t("timesheets.rec.aiFailed")}${s.error ? ` (${s.error})` : ""}`}
        </span>
        {s.hasFile && (
          <Can permission={P.clientManage}>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => run(() => retry({ sheetId: s.id as Id<"staffing_timesheets_clientSheets"> }))}>
              <RotateCcw />
              {t("timesheets.rec.retry")}
            </Button>
          </Can>
        )}
      </AlertDescription>
    </Alert>
  )
}

function LineActions({ view, line }: { view: ReconciliationView; line: ReconcileLine }) {
  const { t } = useT()
  const can = useCan(P.clientManage)
  const resolve = useMutation(api.timesheets.resolveLine)
  const { run, busy } = useAction()
  const [editing, setEditing] = useState(false)
  const [noting, setNoting] = useState(false)
  const done = view.resolutions[line.key]
  const locked = view.lockedWeeks.includes(weekStartOf(line.date))
  const sheetId = view.sheet.id as Id<"staffing_timesheets_clientSheets">
  const act = async (action: ResolutionAction, note?: string) => {
    const ok = await run(() => resolve({ sheetId, key: line.key, action, ...(note ? { note } : {}) }))
    if (ok) setEditing(false)
    return ok
  }
  if (done && !editing)
    return (
      <div className="flex items-center gap-2 text-sm">
        <Check className="size-4 text-steel-green" />
        <span>{t(`timesheets.rec.resolved.${done.action}` as MessageKey)}</span>
        {done.note && <span className="max-w-48 truncate text-muted-foreground" title={done.note}>„{done.note}“</span>}
        {can && (
          <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setEditing(true)}>
            <Undo2 />
            {t("timesheets.rec.undo")}
          </Button>
        )}
      </div>
    )
  if (!can) return null
  return (
    <div className="flex flex-wrap gap-1.5">
      <Button size="sm" className="h-7" disabled={busy || locked || !line.workerId} title={locked ? t("timesheets.rec.locked") : undefined} onClick={() => act("accept_client")}>
        {t("timesheets.rec.acceptClient")}
      </Button>
      <Button size="sm" variant="outline" className="h-7" disabled={busy} onClick={() => act("keep_ours")}>
        {t("timesheets.rec.keepOurs")}
      </Button>
      <Button size="sm" variant="ghost" className="h-7" disabled={busy} onClick={() => setNoting(true)}>
        <MessageSquare />
        {t("timesheets.rec.addNote")}
      </Button>
      <DisputeLine view={view} line={line} />
      {noting && <NoteDialog busy={busy} onClose={() => setNoting(false)} onSave={async (n) => (await act("note", n)) && setNoting(false)} />}
    </div>
  )
}

function NoteDialog({ busy, onClose, onSave }: { busy: boolean; onClose: () => void; onSave: (note: string) => void }) {
  const { t } = useT()
  const [note, setNote] = useState("")
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("timesheets.rec.noteTitle")}</DialogTitle>
          <DialogDescription />
        </DialogHeader>
        <Textarea autoFocus rows={3} placeholder={t("timesheets.rec.notePlaceholder")} value={note} onChange={(e) => setNote(e.target.value)} />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("staffing.common.cancel")}
          </Button>
          <Button disabled={busy || !note.trim()} onClick={() => onSave(note)}>
            {t("staffing.common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function NameMatching({ view }: { view: ReconciliationView }) {
  const { t } = useT()
  const can = useCan(P.clientManage)
  const map = useMutation(api.timesheets.mapClientName)
  const { run, busy } = useAction()
  const sheetId = view.sheet.id as Id<"staffing_timesheets_clientSheets">
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("timesheets.rec.names")}</CardTitle>
        <CardDescription>{t("timesheets.rec.namesLead")}</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="grid gap-2 sm:grid-cols-2">
          {view.reconciliation.names.map((n) => (
            <li key={n.clientName} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm">
              <div className="min-w-0">
                <div className="truncate font-medium">„{n.clientName}“</div>
                <div className="text-xs text-muted-foreground">{n.manual ? t("timesheets.rec.manual") : n.workerId ? fmt(t("timesheets.rec.auto"), { score: Math.round(n.score * 100) }) : t("timesheets.rec.kind.unknown_worker")}</div>
              </div>
              <NativeSelect
                aria-label={n.clientName}
                className={`max-w-52 ${n.workerId ? "" : "border-destructive"}`}
                value={n.workerId ?? ""}
                onChange={(v) => !busy && can && void run(() => map({ sheetId, name: n.clientName, ...(v ? { workerId: v as Id<"staffing_workers"> } : {}) }))}
              >
                <option value="">{t("timesheets.rec.notMatched")}</option>
                {view.workers.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </NativeSelect>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}

function ClientRows({ view }: { view: ReconciliationView }) {
  const { t } = useT()
  const d = useDateFormat()
  const hours = useHours()
  const can = useCan(P.clientManage)
  const add = useMutation(api.timesheets.addClientRows)
  const remove = useMutation(api.timesheets.removeClientRow)
  const { run, busy } = useAction()
  const sheetId = view.sheet.id as Id<"staffing_timesheets_clientSheets">
  const [row, setRow] = useState({ name: "", date: view.sheet.periodFrom, hours: "8" })
  const manualFirst = view.sheet.status !== "ready" || view.sheet.source === "manual"
  const [open, setOpen] = useState(manualFirst)
  async function submit(e: FormEvent) {
    e.preventDefault()
    const h = parseHoursInput(row.hours)
    if (!h) return
    if (await run(() => add({ sheetId, rows: [{ name: row.name, date: row.date, hours: h }] }))) setRow({ ...row, hours: row.hours })
  }
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="text-base">
            {t("timesheets.rec.rows")} <span className="text-muted-foreground">({view.sheet.rows.length})</span>
          </CardTitle>
        </div>
        <Button size="sm" variant="ghost" onClick={() => setOpen(!open)}>
          {open ? "−" : "+"}
        </Button>
      </CardHeader>
      {open && (
        <CardContent className="space-y-3">
          {can && (
            <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
              <Input className="min-w-56 flex-1" required placeholder={t("timesheets.rec.name")} aria-label={t("timesheets.rec.name")} value={row.name} onChange={(e) => setRow({ ...row, name: e.target.value })} list="ts-worker-names" />
              <datalist id="ts-worker-names">
                {view.workers.map((w) => (
                  <option key={w.id} value={w.name} />
                ))}
              </datalist>
              <Input type="date" className="w-40" required min={view.sheet.periodFrom} max={view.sheet.periodTo} aria-label={t("timesheets.rec.date")} value={row.date} onChange={(e) => setRow({ ...row, date: e.target.value })} />
              <Input className="w-20" inputMode="decimal" required aria-label={t("timesheets.rec.hours")} value={row.hours} onChange={(e) => setRow({ ...row, hours: e.target.value })} />
              <Button type="submit" size="sm" disabled={busy}>
                <Plus />
                {t("timesheets.rec.addRow")}
              </Button>
            </form>
          )}
          {view.sheet.rows.length > 0 && (
            <div className="max-h-80 overflow-y-auto rounded-lg border">
              <Table>
                <TableBody>
                  {view.sheet.rows.map((r, i) => (
                    <TableRow key={`${r.name}-${r.date}-${i}`}>
                      <TableCell className="px-3">{r.name}</TableCell>
                      <TableCell className="tabular-nums">{d.full(r.date)}</TableCell>
                      <TableCell className="text-right tabular-nums">{hours(r.hours, true)}</TableCell>
                      <TableCell className="w-10 text-right">
                        {can && (
                          <Button size="icon" variant="ghost" className="size-7" aria-label={t("staffing.common.delete")} disabled={busy} onClick={() => run(() => remove({ sheetId, index: i }))}>
                            <Trash2 className="size-3.5" />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      )}
    </Card>
  )
}

function DeleteSheet({ sheetId, projectId }: { sheetId: Id<"staffing_timesheets_clientSheets">; projectId: string }) {
  const { t } = useT()
  const router = useRouter()
  const del = useMutation(api.timesheets.deleteClientSheet)
  const { run, busy } = useAction()
  const [confirm, setConfirm] = useState(false)
  return (
    <Can permission={P.clientManage}>
      <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => setConfirm(true)}>
        <Trash2 />
        {t("timesheets.rec.deleteSheet")}
      </Button>
      <ConfirmDelete
        open={confirm}
        title={t("timesheets.rec.deleteSheet")}
        body={t("timesheets.rec.deleteBody")}
        busy={busy}
        onCancel={() => setConfirm(false)}
        onConfirm={async () => {
          if (await run(() => del({ sheetId }), { success: t("staffing.common.deleted") })) router.push(`${projectTimesheetHref(projectId)}?tab=client`)
        }}
      />
    </Can>
  )
}
