"use client"
import { StaffingInvoicingPermissions as P } from "@digimuza/staffing/invoicing/manifest"
import { COST_CATEGORIES, type CostCategory } from "@digimuza/staffing/invoicing/pure"
import { Can } from "@digimuza/system-core/react"
import { useMutation, useQuery } from "convex/react"
import { ArrowDown, ArrowLeft, ArrowUp, ArrowUpDown, Pencil, Plus, Trash2, TrendingUp } from "lucide-react"
import Link from "next/link"
import { useState, type FormEvent, type ReactNode } from "react"
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
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { useT } from "@/lib/i18n/client"
import type { MessageKey } from "@/lib/i18n/messages"
import { NativeSelect, ProjectStatusBadge } from "../../staffing/_components/staffing-ui"
import { fmtHours, InvoicingDisabled, InvoicingTabs, marginTone, profitHref, Stat, useInvoicingEnabled, useMoney } from "./invoicing-ui"

const pct = (p: number | null) => (p === null ? "—" : `${p.toLocaleString("lt-LT")} %`)

function MarginBadge({ value }: { value: number | null }) {
  const tone = marginTone(value)
  const cls = tone === "bad" ? "bg-destructive/15 text-destructive dark:bg-destructive/15 dark:text-destructive" : tone === "warn" ? "bg-marking/15 text-marking-foreground dark:text-marking dark:bg-marking/15 dark:text-marking" : tone === "good" ? "bg-steel-green/15 text-steel-green dark:bg-steel-green/15 dark:text-steel-green" : ""
  return (
    <Badge variant="outline" className={`border-transparent tabular-nums ${cls}`}>
      {pct(value)}
    </Badge>
  )
}

// ---------------------------------------------------------------- period filter and sorting

type Range = { from?: string; to?: string }
const PRESETS = ["thisMonth", "lastMonth", "last3", "thisYear", "all"] as const
type Preset = (typeof PRESETS)[number] | "custom"

function presetRange(p: Preset, today = new Date()): Range {
  const iso = (d: Date) => d.toISOString().slice(0, 10)
  const y = today.getUTCFullYear()
  const m = today.getUTCMonth()
  if (p === "thisMonth") return { from: iso(new Date(Date.UTC(y, m, 1))), to: iso(new Date(Date.UTC(y, m + 1, 0))) }
  if (p === "lastMonth") return { from: iso(new Date(Date.UTC(y, m - 1, 1))), to: iso(new Date(Date.UTC(y, m, 0))) }
  if (p === "last3") return { from: iso(new Date(Date.UTC(y, m - 2, 1))), to: iso(new Date(Date.UTC(y, m + 1, 0))) }
  if (p === "thisYear") return { from: `${y}-01-01`, to: `${y}-12-31` }
  return {}
}

function PeriodFilter({ preset, range, onChange }: { preset: Preset; range: Range; onChange: (p: Preset, r: Range) => void }) {
  const { t } = useT()
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={t("invoicing.profit.period")}>
      {PRESETS.map((p) => (
        <Button key={p} size="sm" variant={preset === p ? "default" : "outline"} onClick={() => onChange(p, presetRange(p))}>
          {t(`invoicing.profit.preset.${p}` as MessageKey)}
        </Button>
      ))}
      <Input type="date" className="h-8 w-auto" aria-label={t("invoicing.from")} value={range.from ?? ""} onChange={(e) => onChange("custom", { ...range, from: e.target.value || undefined })} />
      <Input type="date" className="h-8 w-auto" aria-label={t("invoicing.to")} value={range.to ?? ""} onChange={(e) => onChange("custom", { ...range, to: e.target.value || undefined })} />
    </div>
  )
}

type SortState<K extends string> = { key: K; dir: 1 | -1 }

function useSorted<T, K extends string>(rows: readonly T[] | undefined, initial: SortState<K>, value: (row: T, key: K) => number | string | null) {
  const [sort, setSort] = useState<SortState<K>>(initial)
  const sorted = [...(rows ?? [])].sort((a, b) => {
    const x = value(a, sort.key)
    const y = value(b, sort.key)
    if (x === y) return 0
    if (x === null) return 1
    if (y === null) return -1
    return (x < y ? -1 : 1) * sort.dir
  })
  const toggle = (key: K) => setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: typeof value(rows?.[0] as T, key) === "string" ? 1 : -1 }))
  return { sorted, sort, toggle }
}

function SortHead<K extends string>({ k, sort, toggle, children, right }: { k: K; sort: SortState<K>; toggle: (k: K) => void; children: ReactNode; right?: boolean }) {
  const active = sort.key === k
  return (
    <TableHead className={right ? "text-right" : ""} aria-sort={active ? (sort.dir === 1 ? "ascending" : "descending") : undefined}>
      <button type="button" onClick={() => toggle(k)} className={`inline-flex items-center gap-1 hover:text-foreground ${active ? "text-foreground" : ""}`}>
        {children}
        {active ? sort.dir === 1 ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" /> : <ArrowUpDown className="size-3 opacity-40" />}
      </button>
    </TableHead>
  )
}

// ---------------------------------------------------------------- portfolio: projects, clients, workers

const VIEWS = ["projects", "clients", "workers"] as const
type View = (typeof VIEWS)[number]

export function PortfolioView() {
  const { t } = useT()
  const enabled = useInvoicingEnabled()
  const [view, setView] = useState<View>("projects")
  const [preset, setPreset] = useState<Preset>("all")
  const [range, setRange] = useState<Range>({})
  if (!enabled) return <InvoicingDisabled />
  return (
    <div>
      <PageHeader title={t("invoicing.profit.title")} lead={t("invoicing.profit.lead")} />
      <InvoicingTabs />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-lg border bg-card p-0.5" role="tablist" aria-label={t("invoicing.profit.by")}>
          {VIEWS.map((v) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={view === v}
              onClick={() => setView(v)}
              className={`rounded-md px-3 py-1.5 text-sm transition-colors ${view === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              {t(`invoicing.profit.view.${v}` as MessageKey)}
            </button>
          ))}
        </div>
        <PeriodFilter
          preset={preset}
          range={range}
          onChange={(p, r) => {
            setPreset(p)
            setRange(r)
          }}
        />
      </div>
      {view === "projects" ? <ProjectsTable range={range} /> : view === "clients" ? <ClientsTable range={range} /> : <WorkersTable range={range} />}
    </div>
  )
}

const rangeArgs = (r: Range) => ({ ...(r.from ? { from: r.from } : {}), ...(r.to ? { to: r.to } : {}) })

function ProjectsTable({ range }: { range: Range }) {
  const { t } = useT()
  const money = useMoney()
  const rows = useQuery(api.invoicing.portfolio, rangeArgs(range))
  type K = "code" | "client" | "earned" | "invoiced" | "wages" | "costs" | "margin" | "marginPct" | "uninvoiced"
  const withData = rows?.filter((r) => r.invoicedCents || r.costCents || r.earnedCents)
  const { sorted, sort, toggle } = useSorted<NonNullable<typeof rows>[number], K>(withData, { key: "marginPct", dir: 1 }, (r, k) =>
    k === "code" ? r.code : k === "client" ? r.clientName : k === "earned" ? r.earnedCents : k === "invoiced" ? r.invoicedCents : k === "wages" ? r.wageCents : k === "costs" ? r.costCents : k === "margin" ? r.marginCents : k === "marginPct" ? r.marginPct : r.uninvoicedCents,
  )
  if (!rows) return <Skeleton className="h-64 w-full rounded-xl" />
  if (!sorted.length) return <EmptyState icon={<TrendingUp />} title={t("invoicing.profit.empty")} />
  const tot = sorted.reduce((s, r) => ({ inv: s.inv + r.invoicedCents, earned: s.earned + r.earnedCents, cost: s.cost + r.costCents, margin: s.margin + r.marginCents, un: s.un + r.uninvoicedCents }), { inv: 0, earned: 0, cost: 0, margin: 0, un: 0 })
  const totalPct = tot.earned ? Math.round((tot.margin / tot.earned) * 1000) / 10 : null
  return (
    <div className="grid gap-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label={t("invoicing.profit.earned")} value={money(tot.earned)} hint={`${t("invoicing.profit.invoiced")}: ${money(tot.inv)}`} />
        <Stat label={t("invoicing.profit.costs")} value={money(tot.cost)} />
        <Stat label={t("invoicing.profit.margin")} value={money(tot.margin)} hint={pct(totalPct)} tone={marginTone(totalPct)} />
        <Stat label={t("invoicing.profit.uninvoiced")} value={money(tot.un)} hint={t("invoicing.profit.uninvoicedHint")} />
      </div>
      <div className="overflow-x-auto rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <SortHead k="code" sort={sort} toggle={toggle}>
                <span className="pl-2">{t("invoicing.col.project")}</span>
              </SortHead>
              <SortHead k="client" sort={sort} toggle={toggle}>
                {t("invoicing.col.client")}
              </SortHead>
              <TableHead>{t("invoicing.col.status")}</TableHead>
              <SortHead k="earned" sort={sort} toggle={toggle} right>
                {t("invoicing.profit.earned")}
              </SortHead>
              <SortHead k="invoiced" sort={sort} toggle={toggle} right>
                {t("invoicing.profit.invoiced")}
              </SortHead>
              <SortHead k="wages" sort={sort} toggle={toggle} right>
                {t("invoicing.profit.wages")}
              </SortHead>
              <SortHead k="costs" sort={sort} toggle={toggle} right>
                {t("invoicing.profit.costs")}
              </SortHead>
              <SortHead k="margin" sort={sort} toggle={toggle} right>
                {t("invoicing.profit.margin")}
              </SortHead>
              <SortHead k="marginPct" sort={sort} toggle={toggle} right>
                {t("invoicing.profit.marginPct")}
              </SortHead>
              <SortHead k="uninvoiced" sort={sort} toggle={toggle} right>
                {t("invoicing.profit.uninvoiced")}
              </SortHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((r) => (
              <TableRow key={r.projectId}>
                <TableCell className="min-w-[13rem] px-4 whitespace-normal">
                  <Link href={profitHref(r.projectId)} className="font-medium hover:underline">
                    <span className="font-mono text-xs">{r.code}</span> · {r.name}
                  </Link>
                </TableCell>
                <TableCell className="whitespace-normal">{r.clientName}</TableCell>
                <TableCell>
                  <ProjectStatusBadge status={r.status as "active"} />
                </TableCell>
                <TableCell className="text-right tabular-nums">{money(r.earnedCents)}</TableCell>
                <TableCell className="text-right tabular-nums">{money(r.invoicedCents)}</TableCell>
                <TableCell className="text-right tabular-nums">{money(r.wageCents)}</TableCell>
                <TableCell className="text-right tabular-nums">{money(r.costCents)}</TableCell>
                <TableCell className="text-right tabular-nums">{money(r.marginCents)}</TableCell>
                <TableCell className="text-right">
                  <MarginBadge value={r.marginPct} />
                </TableCell>
                <TableCell className="pr-4 text-right tabular-nums text-muted-foreground">{money(r.uninvoicedCents)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <p className="text-xs text-muted-foreground">{t("invoicing.profit.note")}</p>
    </div>
  )
}

function ClientsTable({ range }: { range: Range }) {
  const { t } = useT()
  const money = useMoney()
  const data = useQuery(api.invoicing.clientProfitability, rangeArgs(range))
  type K = "name" | "hours" | "earned" | "invoiced" | "wages" | "direct" | "overhead" | "margin" | "marginPct"
  const { sorted, sort, toggle } = useSorted<NonNullable<typeof data>["rows"][number], K>(data?.rows, { key: "marginPct", dir: 1 }, (r, k) =>
    k === "name" ? r.name : k === "hours" ? r.hours : k === "earned" ? r.earnedCents : k === "invoiced" ? r.invoicedCents : k === "wages" ? r.wageCents : k === "direct" ? r.directCostCents : k === "overhead" ? r.overheadCents : k === "margin" ? r.marginCents : r.marginPct,
  )
  if (!data) return <Skeleton className="h-64 w-full rounded-xl" />
  if (!sorted.length) return <EmptyState icon={<TrendingUp />} title={t("invoicing.profit.empty")} />
  return (
    <div className="grid gap-4">
      <div className="overflow-x-auto rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <SortHead k="name" sort={sort} toggle={toggle}>
                <span className="pl-2">{t("invoicing.col.client")}</span>
              </SortHead>
              <TableHead>{t("invoicing.col.projects")}</TableHead>
              <SortHead k="hours" sort={sort} toggle={toggle} right>
                {t("invoicing.profit.hours")}
              </SortHead>
              <SortHead k="earned" sort={sort} toggle={toggle} right>
                {t("invoicing.profit.earned")}
              </SortHead>
              <SortHead k="invoiced" sort={sort} toggle={toggle} right>
                {t("invoicing.profit.invoiced")}
              </SortHead>
              <SortHead k="wages" sort={sort} toggle={toggle} right>
                {t("invoicing.profit.wages")}
              </SortHead>
              <SortHead k="direct" sort={sort} toggle={toggle} right>
                {t("invoicing.profit.directCosts")}
              </SortHead>
              <SortHead k="overhead" sort={sort} toggle={toggle} right>
                {t("invoicing.profit.overhead")}
              </SortHead>
              <SortHead k="margin" sort={sort} toggle={toggle} right>
                {t("invoicing.profit.margin")}
              </SortHead>
              <SortHead k="marginPct" sort={sort} toggle={toggle} right>
                {t("invoicing.profit.marginPct")}
              </SortHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((r) => (
              <TableRow key={r.clientId}>
                <TableCell className="min-w-[13rem] px-4 font-medium whitespace-normal">
                  {r.name} <span className="font-mono text-xs text-muted-foreground">{r.code}</span>
                </TableCell>
                <TableCell className="font-mono text-xs">{r.projectCodes.join(", ")}</TableCell>
                <TableCell className="text-right tabular-nums">{fmtHours(r.hours)}</TableCell>
                <TableCell className="text-right tabular-nums">{money(r.earnedCents)}</TableCell>
                <TableCell className="text-right tabular-nums">{money(r.invoicedCents)}</TableCell>
                <TableCell className="text-right tabular-nums">{money(r.wageCents)}</TableCell>
                <TableCell className="text-right tabular-nums">{money(r.directCostCents)}</TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">{money(r.overheadCents)}</TableCell>
                <TableCell className="text-right tabular-nums">{money(r.marginCents)}</TableCell>
                <TableCell className="pr-4 text-right">
                  <MarginBadge value={r.marginPct} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <p className="text-xs text-muted-foreground">{t("invoicing.profit.clientNote").replace("{amount}", money(data.generalOverheadCents))}</p>
    </div>
  )
}

function WorkersTable({ range }: { range: Range }) {
  const { t } = useT()
  const money = useMoney()
  const rows = useQuery(api.invoicing.workerProfitability, rangeArgs(range))
  const [editing, setEditing] = useState<NonNullable<typeof rows>[number] | null>(null)
  type K = "name" | "days" | "hours" | "billed" | "wages" | "overhead" | "margin" | "marginPct" | "rate"
  const { sorted, sort, toggle } = useSorted<NonNullable<typeof rows>[number], K>(rows, { key: "marginPct", dir: 1 }, (r, k) =>
    k === "name" ? r.name : k === "days" ? r.days : k === "hours" ? r.hours : k === "billed" ? r.billedCents : k === "wages" ? r.wageCents : k === "overhead" ? r.overheadCents : k === "margin" ? r.marginCents : k === "rate" ? r.hourlyCostCents : r.marginPct,
  )
  if (!rows) return <Skeleton className="h-64 w-full rounded-xl" />
  if (!sorted.length) return <EmptyState icon={<TrendingUp />} title={t("invoicing.profit.empty")} />
  return (
    <div className="grid gap-4">
      <div className="overflow-x-auto rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <SortHead k="name" sort={sort} toggle={toggle}>
                <span className="pl-2">{t("invoicing.hours.worker")}</span>
              </SortHead>
              <TableHead>{t("invoicing.col.projects")}</TableHead>
              <SortHead k="days" sort={sort} toggle={toggle} right>
                {t("invoicing.profit.days")}
              </SortHead>
              <SortHead k="hours" sort={sort} toggle={toggle} right>
                {t("invoicing.profit.hours")}
              </SortHead>
              <SortHead k="billed" sort={sort} toggle={toggle} right>
                {t("invoicing.profit.billed")}
              </SortHead>
              <SortHead k="rate" sort={sort} toggle={toggle} right>
                {t("invoicing.profit.hourlyCost")}
              </SortHead>
              <SortHead k="wages" sort={sort} toggle={toggle} right>
                {t("invoicing.profit.wages")}
              </SortHead>
              <SortHead k="overhead" sort={sort} toggle={toggle} right>
                {t("invoicing.profit.allocated")}
              </SortHead>
              <SortHead k="margin" sort={sort} toggle={toggle} right>
                {t("invoicing.profit.margin")}
              </SortHead>
              <SortHead k="marginPct" sort={sort} toggle={toggle} right>
                {t("invoicing.profit.marginPct")}
              </SortHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((r) => (
              <TableRow key={r.workerId}>
                <TableCell className="min-w-[12rem] px-4 whitespace-normal">
                  <Link href={`/app/staffing/workers/${r.workerId}`} className="font-medium hover:underline">
                    {r.name}
                  </Link>
                  <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                    {r.trades.join(", ")}
                    {r.source === "subcontractor" && (
                      <Badge variant="outline" className="h-4 px-1 text-[10px]">
                        {t("invoicing.profit.subcontractor")}
                      </Badge>
                    )}
                  </div>
                </TableCell>
                <TableCell className="font-mono text-xs">{r.projectCodes.join(", ")}</TableCell>
                <TableCell className="text-right tabular-nums">{r.days}</TableCell>
                <TableCell className="text-right tabular-nums">{fmtHours(r.hours)}</TableCell>
                <TableCell className="text-right tabular-nums">{money(r.billedCents)}</TableCell>
                <TableCell className="text-right whitespace-nowrap tabular-nums">
                  <Can permission={P.costManage} fallback={<span>{money(r.hourlyCostCents)}</span>}>
                    <button type="button" className="inline-flex items-center gap-1 hover:underline" onClick={() => setEditing(r)} title={t("invoicing.profit.editRate")}>
                      {money(r.hourlyCostCents)}
                      <Pencil className="size-3 opacity-50" aria-hidden />
                    </button>
                  </Can>
                  {r.defaultRate && <div className="text-[10px] text-muted-foreground">{t("invoicing.profit.defaultRate")}</div>}
                </TableCell>
                <TableCell className="text-right tabular-nums">{money(r.wageCents)}</TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">{money(r.overheadCents)}</TableCell>
                <TableCell className={`text-right tabular-nums ${r.marginCents < 0 ? "text-destructive" : ""}`}>{money(r.marginCents)}</TableCell>
                <TableCell className="pr-4 text-right">
                  <MarginBadge value={r.marginPct} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <p className="text-xs text-muted-foreground">{t("invoicing.profit.workerNote")}</p>
      {editing && <WageDialog worker={editing} onClose={() => setEditing(null)} />}
    </div>
  )
}

function WageDialog({ worker, onClose }: { worker: { workerId: string; name: string; hourlyCostCents: number; defaultRate: boolean }; onClose: () => void }) {
  const { t } = useT()
  const save = useMutation(api.invoicing.setWageRate)
  const { run, busy } = useAction()
  const [value, setValue] = useState((worker.hourlyCostCents / 100).toFixed(2).replace(".", ","))
  async function submit(e: FormEvent, reset = false) {
    e.preventDefault()
    const cents = Math.round(Number(value.replace(",", ".")) * 100)
    if (await run(() => save({ workerId: worker.workerId as Id<"staffing_workers">, hourlyCostCents: reset ? null : cents }), { success: t("staffing.common.saved") })) onClose()
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <form onSubmit={(e) => void submit(e)} className="grid gap-5">
          <DialogHeader>
            <DialogTitle>{worker.name}</DialogTitle>
            <DialogDescription>{t("invoicing.profit.rateLead")}</DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor="w-rate">{t("invoicing.profit.hourlyCost")}</FieldLabel>
            <Input id="w-rate" inputMode="decimal" required value={value} onChange={(e) => setValue(e.target.value)} />
          </Field>
          <DialogFooter>
            {!worker.defaultRate && (
              <Button type="button" variant="ghost" disabled={busy} onClick={(e) => void submit(e, true)}>
                {t("invoicing.profit.useDefault")}
              </Button>
            )}
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

// ---------------------------------------------------------------- one project

export function ProjectProfitView({ projectId }: { projectId: string }) {
  const { t } = useT()
  const money = useMoney()
  const enabled = useInvoicingEnabled()
  const id = projectId as Id<"staffing_projects">
  const d = useQuery(api.invoicing.projectProfitability, enabled ? { projectId: id } : "skip")
  const del = useMutation(api.invoicing.deleteCost)
  const { run, busy } = useAction()
  const [adding, setAdding] = useState(false)
  if (!enabled) return <InvoicingDisabled />
  if (d === undefined) return <Skeleton className="h-96 w-full rounded-xl" />
  if (d === null) return <p className="text-sm text-muted-foreground">{t("invoicing.notFound")}</p>
  const max = Math.max(1, ...d.weeks.map((w) => Math.max(w.revenueCents, w.costCents)))
  const costTotal = d.costCents || 1

  return (
    <div>
      <Link href="/app/invoicing/profitability" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" />
        {t("invoicing.profit.back")}
      </Link>
      <PageHeader
        title={`${d.code} · ${d.name}`}
        lead={d.clientName}
        actions={
          <Can permission={P.costManage}>
            <Button size="sm" onClick={() => setAdding(true)}>
              <Plus />
              {t("invoicing.cost.add")}
            </Button>
          </Can>
        }
      />
      <InvoicingTabs />
      <div className="grid gap-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Stat label={t("invoicing.profit.invoiced")} value={money(d.invoicedCents)} hint={`${t("invoicing.profit.paid")}: ${money(d.paidCents)}`} />
          <Stat label={t("invoicing.profit.earned")} value={money(d.earnedCents)} hint={`${t("invoicing.profit.uninvoiced")}: ${money(d.uninvoicedCents)}`} />
          <Stat label={t("invoicing.profit.costs")} value={money(d.costCents)} hint={`${t("invoicing.profit.wages")}: ${money(d.wageCents)}`} />
          <Stat label={t("invoicing.profit.margin")} value={money(d.marginCents)} tone={marginTone(d.marginPct)} />
          <Stat label={t("invoicing.profit.marginPct")} value={pct(d.marginPct)} tone={marginTone(d.marginPct)} />
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("invoicing.profit.weekly")}</CardTitle>
            <div className="flex gap-4 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <span className="size-2.5 rounded-sm bg-foreground/80" aria-hidden />
                {t("invoicing.profit.earned")}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="size-2.5 rounded-sm bg-primary" aria-hidden />
                {t("invoicing.profit.costs")}
              </span>
            </div>
          </CardHeader>
          <CardContent>
            {d.weeks.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("invoicing.profit.noWeeks")}</p>
            ) : (
              <div className="flex h-56 items-end gap-2 overflow-x-auto pb-1" role="img" aria-label={t("invoicing.profit.weekly")}>
                {d.weeks.map((w) => {
                  const m = w.revenueCents ? Math.round(((w.revenueCents - w.costCents) / w.revenueCents) * 100) : null
                  return (
                    <div key={w.week} className="flex min-w-12 flex-1 flex-col items-center gap-1" title={`${w.week}: ${money(w.revenueCents)} / ${money(w.costCents)}`}>
                      <span className={`text-[10px] tabular-nums ${m !== null && m < 10 ? "text-destructive dark:text-destructive" : "text-muted-foreground"}`}>{m === null ? "" : `${m}%`}</span>
                      <div className="flex h-40 w-full items-end justify-center gap-0.5">
                        <div className="w-1/2 max-w-5 rounded-t bg-foreground/80" style={{ height: `${(w.revenueCents / max) * 100}%` }} />
                        <div className="w-1/2 max-w-5 rounded-t bg-primary" style={{ height: `${(w.costCents / max) * 100}%` }} />
                      </div>
                      <span className="text-[10px] whitespace-nowrap text-muted-foreground tabular-nums">{w.week.slice(5)}</span>
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="grid gap-4 lg:grid-cols-[20rem_1fr]">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("invoicing.cost.byCategory")}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2.5 text-sm">
              {COST_CATEGORIES.map((c) => (
                <div key={c}>
                  <div className="flex justify-between">
                    <span>{t(`invoicing.cost.cat.${c}` as MessageKey)}</span>
                    <span className="tabular-nums">{money(d.byCategory[c])}</span>
                  </div>
                  <div className="mt-1 h-1.5 rounded-full bg-muted">
                    <div className="h-1.5 rounded-full bg-primary/70" style={{ width: `${(d.byCategory[c] / costTotal) * 100}%` }} />
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("invoicing.cost.entries")}</CardTitle>
            </CardHeader>
            <CardContent className="max-h-[28rem] overflow-y-auto px-0">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="px-4">{t("invoicing.hours.date")}</TableHead>
                    <TableHead>{t("invoicing.cost.category")}</TableHead>
                    <TableHead>{t("staffing.common.notes")}</TableHead>
                    <TableHead className="text-right">{t("invoicing.col.amount")}</TableHead>
                    <TableHead className="pr-4" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {d.costs.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="px-4 tabular-nums">{c.date}</TableCell>
                      <TableCell>
                        {t(`invoicing.cost.cat.${c.category}` as MessageKey)}
                        {c.kind === "purchase" && (
                          <Badge variant="outline" className="ml-1.5 h-4 px-1 text-[10px]">
                            {t("invoicing.cost.purchase")}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="max-w-64 truncate text-muted-foreground">{c.note}</TableCell>
                      <TableCell className="text-right tabular-nums">{money(c.amountCents)}</TableCell>
                      <TableCell className="pr-4 text-right">
                        {c.kind === "cost" && (
                          <Can permission={P.costManage}>
                            <Button size="icon" variant="ghost" aria-label={t("staffing.common.delete")} disabled={busy} onClick={() => void run(() => del({ costId: c.id as Id<"staffing_invoicing_costs"> }), { success: t("staffing.common.deleted") })}>
                              <Trash2 />
                            </Button>
                          </Can>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter>
                  <TableRow>
                    <TableCell colSpan={3} className="px-4 font-semibold">
                      {t("invoicing.total")}
                    </TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">{money(d.otherCostCents + d.purchaseCents)}</TableCell>
                    <TableCell />
                  </TableRow>
                </TableFooter>
              </Table>
            </CardContent>
          </Card>
        </div>
      </div>
      {adding && <CostDialog projectId={id} onClose={() => setAdding(false)} />}
    </div>
  )
}

function CostDialog({ projectId, onClose }: { projectId: Id<"staffing_projects">; onClose: () => void }) {
  const { t } = useT()
  const add = useMutation(api.invoicing.addCost)
  const { run, busy } = useAction()
  const [f, setF] = useState({ category: "accommodation" as CostCategory, date: new Date().toISOString().slice(0, 10), amount: "", note: "" })

  async function submit(e: FormEvent) {
    e.preventDefault()
    const amountCents = Math.round(Number(f.amount.replace(",", ".")) * 100)
    if (await run(() => add({ projectId, category: f.category, date: f.date, amountCents, note: f.note || undefined }), { success: t("staffing.common.created") })) onClose()
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={(e) => void submit(e)} className="grid gap-5">
          <DialogHeader>
            <DialogTitle>{t("invoicing.cost.add")}</DialogTitle>
          </DialogHeader>
          <FieldGroup className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="c-cat">{t("invoicing.cost.category")}</FieldLabel>
              <NativeSelect id="c-cat" value={f.category} onChange={(v) => setF((s) => ({ ...s, category: v as CostCategory }))}>
                {COST_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {t(`invoicing.cost.cat.${c}` as MessageKey)}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field>
              <FieldLabel htmlFor="c-date">{t("invoicing.hours.date")}</FieldLabel>
              <Input id="c-date" type="date" required value={f.date} onChange={(e) => setF((s) => ({ ...s, date: e.target.value }))} />
            </Field>
            <Field>
              <FieldLabel htmlFor="c-amount">{t("invoicing.payment.amount")}</FieldLabel>
              <Input id="c-amount" inputMode="decimal" required value={f.amount} onChange={(e) => setF((s) => ({ ...s, amount: e.target.value }))} />
            </Field>
          </FieldGroup>
          <Field>
            <FieldLabel htmlFor="c-note">{t("staffing.common.notes")}</FieldLabel>
            <Input id="c-note" value={f.note} onChange={(e) => setF((s) => ({ ...s, note: e.target.value }))} />
          </Field>
          <DialogFooter>
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
