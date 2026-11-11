"use client"
// DIG-111: dispute cases (list with "Pakibę" totals, detail with timeline, new client re-check).
import type { DisputeDetail, DisputeListItem } from "@digimuza/staffing"
import { StaffingTimesheetsPermissions as P } from "@digimuza/staffing/timesheets/manifest"
import { addDays, addMonths, todayIso } from "@digimuza/staffing/pure"
import { DISPUTE_STATUSES, type DisputeStatus } from "@digimuza/staffing/timesheets/pure"
import { Can, useCan } from "@digimuza/system-core/react"
import { useMutation, useQuery } from "convex/react"
import { ArrowLeft, CircleDot, FileText, Gavel, Hand, MessageSquare, Plus, RefreshCw } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState, type FormEvent } from "react"
import { EmptyState } from "@/components/app/empty-state"
import { PageHeader } from "@/components/app/page-header"
import { useAction } from "@/components/app/use-action"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { useT } from "@/lib/i18n/client"
import type { MessageKey } from "@/lib/i18n/messages"
import { cn } from "@/lib/utils"
import { NativeSelect } from "../../staffing/_components/staffing-ui"
import { disputeHref, disputesHref, fmt, parseHoursInput, sheetHref, TimesheetsDisabled, timesheetsHref, useDateFormat, useHours, useMoney, useTimesheetsEnabled } from "./timesheets-ui"

const STATUS_STYLE: Record<DisputeStatus, string> = {
  open: "border-destructive/40 bg-destructive/10 text-destructive",
  waiting_client: "border-marking-foreground/30 bg-marking/25 text-marking-foreground",
  resolved_accepted: "border-steel-green/40 bg-steel-green/10 text-steel-green",
  resolved_compensated: "border-border bg-secondary text-foreground",
  rejected: "border-border bg-muted text-muted-foreground",
}

export function DisputeStatusBadge({ status }: { status: DisputeStatus }) {
  const { t } = useT()
  return (
    <Badge variant="outline" className={STATUS_STYLE[status]}>
      {t(`disputes.status.${status}` as MessageKey)}
    </Badge>
  )
}

/** "Pakibę: 6 000 €" — for the overview header. */
export function PendingDisputesButton() {
  const { t } = useT()
  const money = useMoney()
  const data = useQuery(api.timesheets.listDisputes, {})
  return (
    <Button size="sm" variant={data && data.totals.openCents > 0 ? "default" : "outline"} asChild>
      <Link href={disputesHref}>
        <Gavel />
        {data && data.totals.openCents > 0 ? fmt(t("disputes.pending"), { amount: money(data.totals.openCents, { whole: true }) }) : t("disputes.button")}
      </Link>
    </Button>
  )
}

export function DisputesPage() {
  const { t } = useT()
  const enabled = useTimesheetsEnabled()
  const [filter, setFilter] = useState<"open" | "closed" | "all">("open")
  const data = useQuery(api.timesheets.listDisputes, enabled ? { status: filter } : "skip")
  const money = useMoney()
  const hours = useHours()
  const d = useDateFormat()
  const [creating, setCreating] = useState(false)
  if (!enabled) return <TimesheetsDisabled />
  return (
    <div className="space-y-6">
      <Link href={timesheetsHref} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" />
        {t("timesheets.grid.back")}
      </Link>
      <PageHeader
        title={t("disputes.title")}
        lead={t("disputes.lead")}
        actions={
          <Can permission={P.clientManage}>
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus />
              {t("disputes.new")}
            </Button>
          </Can>
        }
      />

      {!data ? (
        <Skeleton className="h-28 w-full rounded-xl" />
      ) : (
        <div className="grid gap-3 sm:grid-cols-4">
          <div className={cn("rounded-xl border bg-card p-4 sm:col-span-2", data.totals.openCents > 0 && "border-destructive/50")}>
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("disputes.pendingLabel")}</div>
            <div className="mt-1 font-stencil-title text-4xl tabular-nums text-destructive">{money(data.totals.openCents, { whole: true })}</div>
            <div className="mt-1 text-sm text-muted-foreground">{fmt(t("disputes.openCount"), { n: data.totals.open, hours: hours(data.totals.openHours, true) })}</div>
          </div>
          <Mini label={t("disputes.recovered")} value={money(data.totals.recoveredCents, { whole: true })} tone="text-steel-green" />
          <Mini label={t("disputes.compensated")} value={money(data.totals.compensatedCents, { whole: true })} />
        </div>
      )}

      <Tabs value={filter} onValueChange={(v) => setFilter(v as typeof filter)}>
        <TabsList>
          <TabsTrigger value="open">{t("disputes.filter.open")}</TabsTrigger>
          <TabsTrigger value="closed">{t("disputes.filter.closed")}</TabsTrigger>
          <TabsTrigger value="all">{t("disputes.filter.all")}</TabsTrigger>
        </TabsList>
      </Tabs>

      {!data ? (
        <Skeleton className="h-64 w-full rounded-xl" />
      ) : data.items.length === 0 ? (
        <EmptyState icon={<Gavel />} title={t("disputes.empty")} body={t("disputes.emptyBody")} />
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="px-4">{t("disputes.case")}</TableHead>
                <TableHead>{t("disputes.worker")}</TableHead>
                <TableHead>{t("disputes.period")}</TableHead>
                <TableHead className="text-right">{t("disputes.hours")}</TableHead>
                <TableHead className="text-right">{t("disputes.amount")}</TableHead>
                <TableHead>{t("disputes.status")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.items.map((i) => (
                <DisputeRow key={i.id} i={i} money={money} hours={hours} d={d} />
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {creating && <NewDisputeDialog onClose={() => setCreating(false)} />}
    </div>
  )
}

function DisputeRow({ i, money, hours, d }: { i: DisputeListItem; money: ReturnType<typeof useMoney>; hours: ReturnType<typeof useHours>; d: ReturnType<typeof useDateFormat> }) {
  const { t } = useT()
  const router = useRouter()
  return (
    <TableRow className="cursor-pointer" onClick={() => router.push(disputeHref(i.id))}>
      <TableCell className="max-w-80 px-4">
        <Link href={disputeHref(i.id)} className="font-medium hover:underline" onClick={(e) => e.stopPropagation()}>
          {i.title}
        </Link>
        <div className="text-xs text-muted-foreground">
          {t(`disputes.kind.${i.kind}` as MessageKey)} · <span className="font-mono">{i.projectCode}</span> · {i.clientName}
        </div>
      </TableCell>
      <TableCell className="whitespace-nowrap">{i.workerName}</TableCell>
      <TableCell className="whitespace-nowrap text-sm tabular-nums">
        {d.full(i.periodFrom)} – {d.full(i.periodTo)}
        <div className="text-xs text-muted-foreground">{fmt(t("disputes.since"), { date: d.full(i.periodFrom) })}</div>
      </TableCell>
      <TableCell className="text-right tabular-nums">{hours(i.hours, true)} h</TableCell>
      <TableCell className="text-right font-semibold tabular-nums">{money(i.amountCents, { currency: i.currency })}</TableCell>
      <TableCell>
        <DisputeStatusBadge status={i.status} />
      </TableCell>
    </TableRow>
  )
}

function Mini({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn("mt-1 text-2xl font-semibold tabular-nums", tone)}>{value}</div>
    </div>
  )
}

function NewDisputeDialog({ onClose }: { onClose: () => void }) {
  const { t } = useT()
  const router = useRouter()
  const projects = useQuery(api.timesheets.overview, {})
  const [projectId, setProjectId] = useState("")
  const workers = useQuery(api.timesheets.listProjectWorkers, projectId ? { projectId: projectId as Id<"staffing_projects"> } : "skip")
  const today = todayIso()
  const monthStart = `${today.slice(0, 7)}-01`
  const [form, setForm] = useState({ workerId: "", from: addMonths(monthStart, -1), to: addDays(monthStart, -1), hours: "", title: "", note: "" })
  const create = useMutation(api.timesheets.createDispute)
  const { run, busy } = useAction()
  async function submit(e: FormEvent) {
    e.preventDefault()
    const h = parseHoursInput(form.hours)
    if (!projectId || !form.workerId || !h) return
    const res = await run(
      () =>
        create({
          projectId: projectId as Id<"staffing_projects">,
          workerId: form.workerId as Id<"staffing_workers">,
          periodFrom: form.from,
          periodTo: form.to,
          kind: "client_recheck",
          hours: h,
          ...(form.title.trim() ? { title: form.title } : {}),
          ...(form.note.trim() ? { note: form.note } : {}),
        }),
      { success: t("disputes.created") },
    )
    if (res) router.push(disputeHref(res.id))
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("disputes.newTitle")}</DialogTitle>
          <DialogDescription>{t("disputes.newLead")}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="nd-project">{t("disputes.project")}</FieldLabel>
              <NativeSelect id="nd-project" required value={projectId} onChange={(v) => {
                setProjectId(v)
                setForm({ ...form, workerId: "" })
              }}>
                <option value="">—</option>
                {projects?.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.code} · {p.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field>
              <FieldLabel htmlFor="nd-worker">{t("disputes.worker")}</FieldLabel>
              <NativeSelect id="nd-worker" required value={form.workerId} onChange={(v) => setForm({ ...form, workerId: v })}>
                <option value="">—</option>
                {workers?.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <div className="grid grid-cols-3 gap-3">
              <Field>
                <FieldLabel htmlFor="nd-from">{t("disputes.from")}</FieldLabel>
                <Input id="nd-from" type="date" required value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })} />
              </Field>
              <Field>
                <FieldLabel htmlFor="nd-to">{t("disputes.to")}</FieldLabel>
                <Input id="nd-to" type="date" required min={form.from} value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value })} />
              </Field>
              <Field>
                <FieldLabel htmlFor="nd-hours">{t("disputes.hours")}</FieldLabel>
                <Input id="nd-hours" inputMode="decimal" required value={form.hours} onChange={(e) => setForm({ ...form, hours: e.target.value })} />
              </Field>
            </div>
            <Field>
              <FieldLabel htmlFor="nd-title">{t("disputes.titleField")}</FieldLabel>
              <Input id="nd-title" value={form.title} placeholder={t("disputes.kind.client_recheck")} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            </Field>
            <Field>
              <FieldLabel htmlFor="nd-note">{t("disputes.note")}</FieldLabel>
              <Textarea id="nd-note" rows={3} value={form.note} placeholder={t("disputes.notePlaceholder")} onChange={(e) => setForm({ ...form, note: e.target.value })} />
            </Field>
          </FieldGroup>
          <DialogFooter className="mt-4">
            <Button type="button" variant="outline" onClick={onClose}>
              {t("staffing.common.cancel")}
            </Button>
            <Button type="submit" disabled={busy}>
              {t("disputes.create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function DisputePage({ disputeId }: { disputeId: string }) {
  const { t } = useT()
  const enabled = useTimesheetsEnabled()
  const d = useQuery(api.timesheets.getDispute, enabled ? { disputeId: disputeId as Id<"staffing_timesheets_disputes"> } : "skip")
  const money = useMoney()
  const hours = useHours()
  const df = useDateFormat()
  if (!enabled) return <TimesheetsDisabled />
  if (d === null) return <p className="text-sm text-muted-foreground">{t("staffing.common.notFound")}</p>
  if (!d) return <Skeleton className="h-96 w-full rounded-xl" />
  return (
    <div className="space-y-5">
      <Link href={disputesHref} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" />
        {t("disputes.back")}
      </Link>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="font-mono text-xs text-muted-foreground">
            {d.projectCode} · {d.clientName}
          </div>
          <h1 className="font-stencil-title text-[2rem] sm:text-[2.3rem]">{d.title}</h1>
          <p className="text-sm text-muted-foreground">
            {d.workerName} · {df.full(d.periodFrom)} – {df.full(d.periodTo)} · {t(`disputes.kind.${d.kind}` as MessageKey)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {d.sheetId && (
            <Button size="sm" variant="outline" asChild>
              <Link href={sheetHref(d.sheetId)}>
                <FileText />
                {t("disputes.openSheet")}
              </Link>
            </Button>
          )}
          <DisputeStatusBadge status={d.status} />
        </div>
      </header>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border bg-card p-4">
          <div className="text-xs text-muted-foreground">{t("disputes.amount")}</div>
          <div className="mt-1 font-stencil-title text-3xl tabular-nums">{money(d.amountCents, { currency: d.currency })}</div>
          <div className="text-xs text-muted-foreground">{fmt(t("disputes.rate"), { rate: money(d.rateCents, { currency: d.currency }) })}</div>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <div className="text-xs text-muted-foreground">{t("disputes.hours")}</div>
          <div className="mt-1 text-3xl font-semibold tabular-nums">{hours(d.hours, true)} h</div>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <div className="text-xs text-muted-foreground">{t("disputes.sources")}</div>
          <dl className="mt-1 grid grid-cols-3 gap-2 text-center text-sm tabular-nums">
            <SourceTotal label={t("ts3.sumWorker")} value={d.sources.worker} />
            <SourceTotal label={t("ts3.sumOurs")} value={d.sources.ours} />
            <SourceTotal label={t("ts3.sumClient")} value={d.sources.client} warn />
          </dl>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_22rem]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("disputes.days")}</CardTitle>
          </CardHeader>
          <CardContent>
            {d.lines.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("disputes.noDays")}</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>{t("timesheets.rec.date")}</TableHead>
                    <TableHead className="text-right">{t("ts3.sumWorker")}</TableHead>
                    <TableHead className="text-right">{t("ts3.sumOurs")}</TableHead>
                    <TableHead className="text-right">{t("ts3.sumClient")}</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {d.lines.map((l) => (
                    <TableRow key={l.date}>
                      <TableCell className="whitespace-nowrap tabular-nums">
                        <span className="capitalize text-muted-foreground">{df.weekday(l.date)}</span> {df.full(l.date)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{l.worker === null ? "—" : hours(l.worker, true)}</TableCell>
                      <TableCell className="text-right tabular-nums">{l.ours === null ? "—" : hours(l.ours, true)}</TableCell>
                      <TableCell className="text-right font-medium tabular-nums text-destructive">{l.client === null ? "—" : hours(l.client, true)}</TableCell>
                      <TableCell className="max-w-56 text-xs text-muted-foreground">
                        {l.flag && (
                          <span className="inline-flex items-start gap-1">
                            <Hand className="mt-0.5 size-3 shrink-0 text-marking-foreground dark:text-marking" />„{l.flag}“
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
        <Timeline d={d} />
      </div>
    </div>
  )
}

function SourceTotal({ label, value, warn }: { label: string; value: number | null; warn?: boolean }) {
  const hours = useHours()
  return (
    <div>
      <dt className="text-[0.65rem] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className={cn("text-lg font-semibold", warn && "text-destructive")}>{value === null ? "—" : hours(value, true)}</dd>
    </div>
  )
}

function Timeline({ d }: { d: DisputeDetail }) {
  const { t } = useT()
  const df = useDateFormat()
  const can = useCan(P.clientManage)
  const setStatus = useMutation(api.timesheets.setDisputeStatus)
  const addNote = useMutation(api.timesheets.addDisputeNote)
  const { run, busy } = useAction()
  const [status, setStatusValue] = useState<DisputeStatus>(d.status)
  const [note, setNote] = useState("")
  const id = d.id as Id<"staffing_timesheets_disputes">
  async function submit(e: FormEvent) {
    e.preventDefault()
    const ok = status !== d.status ? await run(() => setStatus({ disputeId: id, status, ...(note.trim() ? { note } : {}) }), { success: t("disputes.saved") }) : note.trim() ? await run(() => addNote({ disputeId: id, note }), { success: t("disputes.saved") }) : undefined
    if (ok) setNote("")
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("disputes.timeline")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <ol className="relative space-y-4 border-l pl-4">
          {d.timeline.map((e, i) => (
            <li key={i} className="relative">
              <span className="absolute -left-[1.4rem] top-0.5 flex size-4 items-center justify-center rounded-full bg-background text-muted-foreground ring-1 ring-border [&>svg]:size-2.5">
                {e.kind === "note" ? <MessageSquare /> : e.kind === "status" ? <RefreshCw /> : <CircleDot />}
              </span>
              <div className="text-sm font-medium">
                {e.kind === "status" && e.status ? fmt(t("disputes.event.status"), { status: t(`disputes.status.${e.status}` as MessageKey) }) : t(`disputes.event.${e.kind}` as MessageKey)}
              </div>
              <div className="text-xs text-muted-foreground">
                {df.stamp(e.at)}
                {e.byName ? ` · ${e.byName}` : ""}
              </div>
              {e.note && <p className="mt-1 text-sm">{e.note}</p>}
            </li>
          ))}
        </ol>
        {can && (
          <form onSubmit={submit} className="grid gap-2 border-t pt-4">
            <NativeSelect aria-label={t("disputes.setStatus")} value={status} onChange={(v) => setStatusValue(v as DisputeStatus)}>
              {DISPUTE_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`disputes.status.${s}` as MessageKey)}
                </option>
              ))}
            </NativeSelect>
            <Textarea rows={3} value={note} placeholder={status !== d.status ? t("disputes.statusNote") : t("disputes.notePlaceholder")} onChange={(e) => setNote(e.target.value)} />
            <Button type="submit" size="sm" disabled={busy || (status === d.status && !note.trim())}>
              {status !== d.status ? t("disputes.setStatus") : t("disputes.addNote")}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  )
}
