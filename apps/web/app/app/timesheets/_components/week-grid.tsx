"use client"
import type { GridRow, WeekGrid } from "@digimuza/staffing"
import { StaffingTimesheetsPermissions as P } from "@digimuza/staffing/timesheets/manifest"
import { addDays, todayIso } from "@digimuza/staffing/pure"
import { isoWeek, weekStartOf } from "@digimuza/staffing/timesheets/pure"
import { Can, useCan } from "@digimuza/system-core/react"
import { useMutation, useQuery } from "convex/react"
import { ArrowLeft, ChevronLeft, ChevronRight, ClipboardCheck, Lock, LockOpen, Moon, MoreHorizontal, Wand2 } from "lucide-react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useState, type FormEvent } from "react"
import { toast } from "sonner"
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { useT } from "@/lib/i18n/client"
import { useTradeName } from "../../staffing/_components/staffing-ui"
import { ClientSheets } from "./client-sheets"
import { fmt, parseHoursInput, timesheetsHref, TimesheetsDisabled, useDateFormat, useHours, useTimesheetsEnabled } from "./timesheets-ui"

export function ProjectTimesheet({ projectId }: { projectId: string }) {
  const { t } = useT()
  const enabled = useTimesheetsEnabled()
  const params = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const week = weekStartOf(params.get("week") || todayIso())
  const tab = params.get("tab") === "client" ? "client" : "hours"
  const grid = useQuery(api.timesheets.weekGrid, enabled ? { projectId: projectId as Id<"staffing_projects">, weekStart: week } : "skip")
  const go = (q: Record<string, string | null>) => {
    const next = new URLSearchParams(params)
    for (const [k, v] of Object.entries(q)) if (v === null) next.delete(k)
    else next.set(k, v)
    router.replace(next.size ? `${pathname}?${next}` : pathname, { scroll: false })
  }
  if (!enabled) return <TimesheetsDisabled />
  if (grid === null) return <p className="text-sm text-muted-foreground">{t("staffing.common.notFound")}</p>
  return (
    <div className="space-y-4">
      <Link href={timesheetsHref} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" />
        {t("timesheets.grid.back")}
      </Link>
      {grid ? (
        <header>
          <div className="font-mono text-xs text-muted-foreground">{grid.project.code}</div>
          <h1 className="font-stencil-title text-[2.1rem] sm:text-[2.4rem]">{grid.project.name}</h1>
          <p className="text-sm text-muted-foreground">{grid.project.clientName}</p>
        </header>
      ) : (
        <Skeleton className="h-16 w-80" />
      )}
      <Tabs value={tab} onValueChange={(v) => go({ tab: v === "client" ? "client" : null })}>
        <TabsList>
          <TabsTrigger value="hours">{t("timesheets.grid.hours")}</TabsTrigger>
          <TabsTrigger value="client">{t("timesheets.grid.clientSheets")}</TabsTrigger>
        </TabsList>
        <TabsContent value="hours" className="pt-3">
          <WeekNav week={week} onWeek={(w) => go({ week: w === weekStartOf(todayIso()) ? null : w })} />
          {!grid ? <Skeleton className="mt-3 h-72 w-full rounded-xl" /> : <Grid grid={grid} projectId={projectId} />}
        </TabsContent>
        <TabsContent value="client" className="pt-3">
          <ClientSheets projectId={projectId} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

function WeekNav({ week, onWeek }: { week: string; onWeek: (w: string) => void }) {
  const { t } = useT()
  const d = useDateFormat()
  const current = weekStartOf(todayIso())
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="icon" variant="outline" aria-label={t("timesheets.grid.prev")} onClick={() => onWeek(addDays(week, -7))}>
        <ChevronLeft />
      </Button>
      <div className="min-w-44 text-center text-sm font-medium tabular-nums">
        {fmt(t("timesheets.grid.week"), { n: isoWeek(week) })} · {d.day(week)}–{d.day(addDays(week, 6))}
      </div>
      <Button size="icon" variant="outline" aria-label={t("timesheets.grid.next")} disabled={week >= current} onClick={() => onWeek(addDays(week, 7))}>
        <ChevronRight />
      </Button>
      {week !== current && (
        <Button size="sm" variant="ghost" onClick={() => onWeek(current)}>
          {t("timesheets.grid.today")}
        </Button>
      )}
    </div>
  )
}

const total = (e: { regular: number; overtime: number } | undefined) => (e ? e.regular + e.overtime : 0)

function Grid({ grid, projectId }: { grid: WeekGrid; projectId: string }) {
  const { t } = useT()
  const d = useDateFormat()
  const hours = useHours()
  const tradeName = useTradeName()
  const canWrite = useCan(P.write)
  const [showOvertime, setShowOvertime] = useState(false)
  const [details, setDetails] = useState<{ row: GridRow; date: string } | null>(null)
  const [approving, setApproving] = useState(false)
  const fill = useMutation(api.timesheets.fillWeek)
  const approve = useMutation(api.timesheets.approveWeek)
  const reopen = useMutation(api.timesheets.reopenWeek)
  const { run, busy } = useAction()
  const locked = Boolean(grid.approved)
  const editable = canWrite && !locked
  const pid = projectId as Id<"staffing_projects">
  const weekTotal = grid.rows.reduce((s, r) => s + Object.values(r.entries).reduce((x, e) => x + total(e), 0), 0)
  const covered = (r: GridRow, day: string) => r.startDate <= day && (!r.endDate || r.endDate >= day) && day <= grid.today

  return (
    <div className="mt-3 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          {locked ? (
            <Badge variant="secondary" className="gap-1">
              <Lock className="size-3" />
              {t("timesheets.grid.approved")}
            </Badge>
          ) : (
            editable && (
              <Button size="sm" variant="outline" disabled={busy} onClick={() => run(async () => toast.success(fmt(t("timesheets.grid.filled"), { n: (await fill({ projectId: pid, weekStart: grid.weekStart })).filled })))}>
                <Wand2 />
                {t("timesheets.grid.fill")}
              </Button>
            )
          )}
          <Label className="flex items-center gap-2 text-sm font-normal">
            <Checkbox checked={showOvertime} onCheckedChange={(c) => setShowOvertime(c === true)} />
            {t("timesheets.grid.showOvertime")}
          </Label>
        </div>
        <Can permission={P.approve}>
          {locked ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              {fmt(t("timesheets.grid.approvedAt"), { date: d.stamp(grid.approved!.approvedAt) })}
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(() => reopen({ projectId: pid, weekStart: grid.weekStart }))}>
                <LockOpen />
                {t("timesheets.grid.reopen")}
              </Button>
            </div>
          ) : (
            <Button size="sm" disabled={busy || grid.weekStart > grid.today || grid.rows.length === 0} onClick={() => setApproving(true)}>
              <ClipboardCheck />
              {t("timesheets.grid.approve")}
            </Button>
          )}
        </Can>
      </div>

      {grid.rows.length === 0 ? (
        <EmptyState icon={<ClipboardCheck />} title={t("timesheets.grid.empty")} body={t("timesheets.grid.emptyBody")} />
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border bg-card">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b">
                  <th className="sticky left-0 z-10 bg-card px-3 py-2 text-left font-medium">{t("timesheets.grid.worker")}</th>
                  {grid.days.map((day, i) => (
                    <th key={day} className={`px-1 py-2 text-center font-medium ${i >= 5 ? "bg-muted/50" : ""} ${day === grid.today ? "text-primary" : ""}`}>
                      <div className="text-xs capitalize text-muted-foreground">{d.weekday(day)}</div>
                      <div className="tabular-nums">{d.day(day)}</div>
                    </th>
                  ))}
                  <th className="px-3 py-2 text-right font-medium">{t("timesheets.grid.total")}</th>
                </tr>
              </thead>
              <tbody>
                {grid.rows.map((r) => {
                  const rowTotal = Object.values(r.entries).reduce((s, e) => s + total(e), 0)
                  return (
                    <tr key={r.assignmentId} className="border-b last:border-0">
                      <td className="sticky left-0 z-10 min-w-40 bg-card px-3 py-1.5">
                        <div className="font-medium leading-tight">{r.workerName}</div>
                        <div className="text-xs text-muted-foreground">
                          {tradeName({ nameLt: r.tradeLt, nameEn: r.tradeEn })}
                          {r.subcontractor && <span className="ml-1 rounded bg-muted px-1">{t("timesheets.grid.subcontractor")}</span>}
                        </div>
                      </td>
                      {grid.days.map((day, i) => {
                        const e = r.entries[day]
                        const can = covered(r, day)
                        return (
                          <td key={day} className={`px-1 py-1 text-center align-top ${i >= 5 ? "bg-muted/50" : ""}`}>
                            {can ? (
                              <div className="flex flex-col items-center gap-0.5">
                                <div className="flex items-center">
                                  <HourCell row={r} date={day} field="regular" value={e?.regular ?? 0} other={e} disabled={!editable} />
                                  {(editable || e?.note || e?.night) && (
                                    <button type="button" className="ml-0.5 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={t("timesheets.grid.details")} onClick={() => setDetails({ row: r, date: day })}>
                                      <MoreHorizontal className="size-3.5" />
                                    </button>
                                  )}
                                </div>
                                {showOvertime ? (
                                  <HourCell row={r} date={day} field="overtime" value={e?.overtime ?? 0} other={e} disabled={!editable} small />
                                ) : (
                                  !!e?.overtime && <span className="rounded bg-marking/15 px-1 text-[10px] font-medium text-marking-foreground dark:text-marking dark:bg-marking/15 dark:text-marking">+{hours(e.overtime)}</span>
                                )}
                                <div className="flex gap-0.5">
                                  {e?.night && <Moon className="size-3 text-foreground" aria-label={t("timesheets.grid.night")} />}
                                  {e?.note && <span className="size-1.5 rounded-full bg-secondary" title={e.note} />}
                                </div>
                              </div>
                            ) : (
                              <span className="text-muted-foreground/40" title={t("timesheets.grid.notAssigned")}>
                                ·
                              </span>
                            )}
                          </td>
                        )
                      })}
                      <td className="px-3 py-1.5 text-right font-medium tabular-nums">{hours(rowTotal, true)}</td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="border-t bg-muted/30">
                  <td className="sticky left-0 z-10 bg-muted px-3 py-2 font-medium">{t("timesheets.grid.total")}</td>
                  {grid.days.map((day) => (
                    <td key={day} className="px-1 py-2 text-center tabular-nums">
                      {hours(grid.rows.reduce((s, r) => s + total(r.entries[day]), 0))}
                    </td>
                  ))}
                  <td className="px-3 py-2 text-right font-semibold tabular-nums">{hours(weekTotal, true)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="text-xs text-muted-foreground">{locked ? t("timesheets.grid.unsavedLocked") : t("timesheets.grid.legend")}</p>
        </>
      )}

      {details && <EntryDialog row={details.row} date={details.date} disabled={!editable} onClose={() => setDetails(null)} />}
      <Dialog open={approving} onOpenChange={(o) => !o && setApproving(false)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("timesheets.grid.approveTitle")}</DialogTitle>
            <DialogDescription>{fmt(t("timesheets.grid.approveBody"), { hours: hours(weekTotal, true) })}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setApproving(false)}>
              {t("staffing.common.cancel")}
            </Button>
            <Button
              disabled={busy}
              onClick={async () => {
                if (await run(() => approve({ projectId: pid, weekStart: grid.weekStart }), { success: t("timesheets.grid.approved") })) setApproving(false)
              }}
            >
              {t("timesheets.grid.approve")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

/** One editable number; saves on blur or Enter. Re-mounts when the stored value changes. */
function HourCell({ row, date, field, value, other, disabled, small }: { row: GridRow; date: string; field: "regular" | "overtime"; value: number; other: GridRow["entries"][string] | undefined; disabled: boolean; small?: boolean }) {
  const { t } = useT()
  const hours = useHours()
  const save = useMutation(api.timesheets.saveEntry)
  const { run } = useAction()
  const initial = hours(value)
  async function commit(el: HTMLInputElement) {
    const n = parseHoursInput(el.value)
    if (n === null) {
      el.value = initial
      toast.error(t("error.VALIDATION"))
      return
    }
    if (n === value) return
    const regular = field === "regular" ? n : (other?.regular ?? 0)
    const overtime = field === "overtime" ? n : (other?.overtime ?? 0)
    const ok = await run(() => save({ assignmentId: row.assignmentId as Id<"staffing_assignments">, date, regularHours: regular, overtimeHours: overtime }))
    if (!ok) el.value = initial
  }
  return (
    <Input
      key={`${field}-${initial}`}
      defaultValue={initial}
      disabled={disabled}
      inputMode="decimal"
      aria-label={`${row.workerName} ${date} ${field === "regular" ? t("timesheets.grid.regular") : t("timesheets.grid.overtime")}`}
      placeholder={small ? t("timesheets.grid.overtimeShort") : ""}
      className={`h-9 w-12 px-1 text-center tabular-nums disabled:opacity-100 ${small ? "h-7 w-12 border-dashed text-xs" : ""} ${value ? "font-medium" : ""}`}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={(e) => void commit(e.currentTarget)}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur()
        if (e.key === "Escape") {
          e.currentTarget.value = initial
          e.currentTarget.blur()
        }
      }}
    />
  )
}

function EntryDialog({ row, date, disabled, onClose }: { row: GridRow; date: string; disabled: boolean; onClose: () => void }) {
  const { t } = useT()
  const d = useDateFormat()
  const hours = useHours()
  const e = row.entries[date]
  const save = useMutation(api.timesheets.saveEntry)
  const { run, busy } = useAction()
  const [f, setF] = useState({ regular: hours(e?.regular), overtime: hours(e?.overtime), night: e?.night ?? false, note: e?.note ?? "" })
  async function submit(ev: FormEvent) {
    ev.preventDefault()
    const regular = parseHoursInput(f.regular)
    const overtime = parseHoursInput(f.overtime)
    if (regular === null || overtime === null) return void toast.error(t("error.VALIDATION"))
    const ok = await run(() => save({ assignmentId: row.assignmentId as Id<"staffing_assignments">, date, regularHours: regular, overtimeHours: overtime, night: f.night, note: f.note }), { success: t("timesheets.grid.saved") })
    if (ok) onClose()
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{row.workerName}</DialogTitle>
          <DialogDescription>
            {t("timesheets.grid.details")} · <span className="capitalize">{d.weekday(date)}</span> {d.full(date)}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit}>
          <FieldGroup>
            <div className="grid grid-cols-2 gap-3">
              <Field>
                <FieldLabel htmlFor="ts-regular">{t("timesheets.grid.regular")}</FieldLabel>
                <Input id="ts-regular" inputMode="decimal" disabled={disabled} value={f.regular} onChange={(x) => setF({ ...f, regular: x.target.value })} />
              </Field>
              <Field>
                <FieldLabel htmlFor="ts-overtime">{t("timesheets.grid.overtime")}</FieldLabel>
                <Input id="ts-overtime" inputMode="decimal" disabled={disabled} value={f.overtime} onChange={(x) => setF({ ...f, overtime: x.target.value })} />
              </Field>
            </div>
            <Label className="flex items-center gap-2 font-normal">
              <Checkbox disabled={disabled} checked={f.night} onCheckedChange={(c) => setF({ ...f, night: c === true })} />
              {t("timesheets.grid.night")}
            </Label>
            <Field>
              <FieldLabel htmlFor="ts-note">{t("timesheets.grid.note")}</FieldLabel>
              <Textarea id="ts-note" rows={2} disabled={disabled} value={f.note} onChange={(x) => setF({ ...f, note: x.target.value })} />
            </Field>
          </FieldGroup>
          <DialogFooter className="mt-4">
            <Button type="button" variant="outline" onClick={onClose}>
              {t("staffing.common.cancel")}
            </Button>
            {!disabled && (
              <Button type="submit" disabled={busy}>
                {t("staffing.common.save")}
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
