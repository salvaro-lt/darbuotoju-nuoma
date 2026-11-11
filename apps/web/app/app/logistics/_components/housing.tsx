"use client"
// Housing pool dashboard (/app/logistics/housing): occupancy per flat and week,
// money wasted on empty beds, flags, consolidation moves, incoming team.
import type { FlatOverview, HousingFlag, HousingOverview, ResidentRow } from "@digimuza/staffing"
import { StaffingLogisticsPermissions } from "@digimuza/staffing/logistics/manifest"
import { COST_PERIODS, type CostPeriod } from "@digimuza/staffing/logistics/pure"
import { Can, systemErrorOf } from "@digimuza/system-core/react"
import { useMutation, useQuery } from "convex/react"
import { ArrowRight, BedDouble, Car, ChevronDown, ChevronRight, Pencil, Plus, Sparkles, UserMinus, Users } from "lucide-react"
import { Fragment, useState, type FormEvent } from "react"
import { toast } from "sonner"
import { EmptyState } from "@/components/app/empty-state"
import { PageHeader } from "@/components/app/page-header"
import { useAction } from "@/components/app/use-action"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { useT } from "@/lib/i18n/client"
import type { MessageKey } from "@/lib/i18n/messages"
import { centsToEur, eurToCents, Period } from "../../staffing/_components/staffing-ui"
import { eur, fmt, Select, shortDate, useLogisticsEnabled } from "./logistics-ui"
import { LogisticsSubnav, Plate, RegionMonth } from "./logistics-subnav"
import { F } from "./resources"

type FlatId = Id<"staffing_logistics_accommodations">
const pct = (x: number) => `${Math.round(x * 100)} %`

/** Occupancy cell: green when full, red when mostly empty. Tokens only. */
function cellTone(occ: number) {
  if (occ >= 0.9) return "bg-steel-green/20 text-foreground"
  if (occ >= 0.6) return "bg-secondary text-foreground"
  if (occ >= 0.3) return "bg-marking/25 text-foreground"
  return "bg-destructive/15 text-destructive"
}

/** Error text for the housing reasons, else the generic message. */
function useReasonText() {
  const { t } = useT()
  return (se: ReturnType<typeof systemErrorOf>) => {
    const r = se?.reason
    return r && ["flat_full", "worker_has_bed", "outside_lease", "suggestion_outdated"].includes(r) ? t(`logistics.housing.err.${r}` as MessageKey) : undefined
  }
}

function FlagBadge({ flag }: { flag: HousingFlag }) {
  const { t } = useT()
  const cls = flag.severity === "error" ? "border-destructive/40 bg-destructive/10 text-destructive" : flag.severity === "warning" ? "border-marking/50 bg-marking/15 text-marking-foreground dark:text-marking" : "text-muted-foreground"
  return (
    <Badge variant="outline" className={`rounded-none font-normal ${cls}`}>
      {fmt(t(`logistics.housing.flag.${flag.kind}` as MessageKey), { count: flag.count ?? "", capacity: flag.capacity ?? "", date: flag.date ?? "" })}
    </Badge>
  )
}

export function HousingDashboard() {
  const { t } = useT()
  const enabled = useLogisticsEnabled()
  const [region, setRegion] = useState<string>()
  const [month, setMonth] = useState<string>()
  const data = useQuery(api.logistics.housingOverview, enabled ? { ...(region ? { region } : {}), ...(month ? { month } : {}) } : "skip")
  const [editing, setEditing] = useState<FlatOverview | "new" | null>(null)
  if (!enabled) return <p className="text-sm text-muted-foreground">{t("logistics.disabled")}</p>
  return (
    <div>
      <PageHeader
        title={t("logistics.housing.title")}
        lead={t("logistics.housing.lead")}
        actions={
          <>
            {data && <RegionMonth regions={data.regions.length ? data.regions : [data.region]} region={data.region} month={data.month} onRegion={setRegion} onMonth={setMonth} />}
            <Can permission={StaffingLogisticsPermissions.planManage}>
              <Button size="sm" onClick={() => setEditing("new")}>
                <Plus />
                {t("logistics.housing.add")}
              </Button>
            </Can>
          </>
        }
      />
      <LogisticsSubnav />
      {!data ? (
        <Skeleton className="h-96 w-full" />
      ) : data.flats.length === 0 ? (
        <EmptyState icon={<BedDouble />} title={t("logistics.housing.empty")} body={t("logistics.housing.emptyBody")} />
      ) : (
        <div className="space-y-6">
          <Kpis data={data} />
          <div className="grid gap-6 lg:grid-cols-2">
            <Suggestions data={data} />
            <Incoming data={data} />
          </div>
          <OccupancyGrid data={data} onEdit={setEditing} />
        </div>
      )}
      {editing && data && <FlatDialog row={editing === "new" ? null : editing} region={data.region} today={data.today} onClose={() => setEditing(null)} />}
    </div>
  )
}

function Kpis({ data }: { data: HousingOverview }) {
  const { t } = useT()
  const tt = data.totals
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      <Plate label={t("logistics.housing.kpi.beds")} value={`${tt.occupiedToday} / ${tt.beds}`} hint={t("logistics.housing.kpi.bedsHint")} />
      <Plate label={t("logistics.housing.kpi.occupancy")} value={pct(tt.occupancy)} tone={tt.occupancy < 0.6 ? "bad" : tt.occupancy < 0.85 ? "warn" : "ok"} hint={`${tt.usedBedNights} / ${tt.paidBedNights}`} />
      <Plate label={t("logistics.housing.kpi.cost")} value={eur(tt.costCents)} hint={data.month} />
      <Plate label={t("logistics.housing.kpi.wasted")} value={eur(tt.emptyBedCents)} tone={tt.emptyBedCents > 0 ? "bad" : "ok"} hint={tt.costCents ? pct(tt.emptyBedCents / tt.costCents) : ""} />
      <Plate label={t("logistics.housing.kpi.perBed")} value={tt.costPerOccupiedBedCents === null ? "—" : eur(tt.costPerOccupiedBedCents)} hint={t("logistics.housing.kpi.perBedHint")} />
    </div>
  )
}

function Suggestions({ data }: { data: HousingOverview }) {
  const { t } = useT()
  const apply = useMutation(api.logistics.applyConsolidation)
  const { run, busy } = useAction()
  const reason = useReasonText()
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="size-4 text-primary" />
          {t("logistics.housing.sugg.title")}
        </CardTitle>
        <p className="text-sm text-muted-foreground">{t("logistics.housing.sugg.lead")}</p>
      </CardHeader>
      <CardContent className="space-y-3">
        {data.suggestions.length === 0 && <p className="text-sm text-muted-foreground">{t("logistics.housing.sugg.none")}</p>}
        {data.suggestions.map((s) => (
          <div key={s.sourceId} className="border p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <div className="font-medium">{fmt(t("logistics.housing.sugg.source"), { name: s.sourceName, occupied: s.occupied, beds: s.beds })}</div>
                <div className="text-sm font-semibold text-steel-green tabular-nums">{fmt(t("logistics.housing.sugg.saving"), { money: eur(s.monthlySavingCents) })}</div>
              </div>
              <Can permission={StaffingLogisticsPermissions.planManage}>
                <Button
                  size="sm"
                  disabled={busy}
                  onClick={() => void run(() => apply({ sourceId: s.sourceId as FlatId, region: data.region }), { success: fmt(t("logistics.housing.sugg.applied"), { n: s.moves.length }), error: reason })}
                >
                  <ArrowRight />
                  {t("logistics.housing.sugg.apply")}
                </Button>
              </Can>
            </div>
            <ul className="mt-2 space-y-1 text-sm">
              {s.moves.map((m) => (
                <li key={m.workerId} className="tabular-nums">
                  {fmt(t("logistics.housing.sugg.move"), { worker: m.workerName, flat: m.toName, date: shortDate(m.from) })}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

function Incoming({ data }: { data: HousingOverview }) {
  const { t } = useT()
  const auto = useMutation(api.logistics.autoAllocateHousing)
  const { run, busy } = useAction()
  const go = async () => {
    const res = await run(() => auto({ region: data.region }))
    if (!res) return
    const msg = fmt(t("logistics.housing.in.done"), { placed: res.placed.length, unplaced: res.unplaced.length })
    const lines = [...res.placed.map((p) => `${p.name} → ${p.flatName}`), ...res.unplaced.map((u) => `${u.name}: ${t(`logistics.housing.in.reason.${u.reason}` as MessageKey)}`)]
    if (res.unplaced.length) toast.warning(msg, { description: lines.join("\n"), duration: 10000 })
    else toast.success(msg, { description: lines.join("\n"), duration: 8000 })
  }
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div className="space-y-1.5">
          <CardTitle className="flex items-center gap-2">
            <Users className="size-4 text-primary" />
            {t("logistics.housing.in.title")}
          </CardTitle>
          <p className="text-sm text-muted-foreground">{t("logistics.housing.in.lead")}</p>
        </div>
        {data.incoming.length > 0 && (
          <Can permission={StaffingLogisticsPermissions.planManage}>
            <Button size="sm" disabled={busy} onClick={() => void go()}>
              <BedDouble />
              {t("logistics.housing.in.auto")}
            </Button>
          </Can>
        )}
      </CardHeader>
      <CardContent>
        {data.incoming.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("logistics.housing.in.none")}</p>
        ) : (
          <ul className="divide-y text-sm">
            {data.incoming.map((w) => (
              <li key={w.workerId} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  <span className="font-medium">{w.name}</span> <span className="text-muted-foreground">· {w.nationality} · {w.languages.join(", ").toUpperCase()}</span>
                  {w.canDrive && <Car className="ml-1 inline size-3.5 text-muted-foreground" aria-label={t("logistics.housing.drives")} />}
                </span>
                <span className="text-muted-foreground tabular-nums">
                  <span className="font-mono">{w.projectCode}</span> · <Period from={w.startDate} to={w.endDate} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

function OccupancyGrid({ data, onEdit }: { data: HousingOverview; onEdit: (f: FlatOverview) => void }) {
  const { t } = useT()
  const [open, setOpen] = useState<string | null>(null)
  const cols = 6 + data.weeks.length
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("logistics.housing.grid.title")}</CardTitle>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground">{t("logistics.housing.grid.lead")}</p>
          <div className="flex gap-1 text-xs">
            {[
              ["full", 0.95],
              ["ok", 0.7],
              ["low", 0.4],
              ["bad", 0.1],
            ].map(([k, v]) => (
              <span key={k} className={`px-2 py-0.5 ${cellTone(v as number)}`}>
                {t(`logistics.housing.legend.${k}` as MessageKey)}
              </span>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="min-w-64">{t("logistics.housing.col.flat")}</TableHead>
              <TableHead className="text-right">{t("logistics.housing.col.today")}</TableHead>
              {data.weeks.map((w) => (
                <TableHead key={w} className={`text-center text-xs tabular-nums ${w <= data.today && data.today < addDaysIso(w, 7) ? "text-foreground" : ""}`}>
                  {shortDate(w)}
                </TableHead>
              ))}
              <TableHead className="text-right">{t("logistics.housing.col.month")}</TableHead>
              <TableHead className="text-right">{t("logistics.housing.col.perBed")}</TableHead>
              <TableHead className="text-right">{t("logistics.housing.col.wasted")}</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.flats.map((f) => (
              <Fragment key={f.id}>
                <TableRow className="cursor-pointer" onClick={() => setOpen(open === f.id ? null : f.id)}>
                  <TableCell>
                    <div className="flex items-center gap-1.5 font-medium">
                      {open === f.id ? <ChevronDown className="size-4 shrink-0" /> : <ChevronRight className="size-4 shrink-0" />}
                      {f.name}
                    </div>
                    <div className="pl-5 text-xs text-muted-foreground">
                      {f.beds} {t("logistics.acc.beds").toLowerCase()}
                      {f.rooms ? ` · ${fmt(t("logistics.housing.rooms"), { n: f.rooms })}` : ""}
                      {f.landlord ? ` · ${f.landlord}` : ""}
                      {f.vehicles.map((v) => (
                        <span key={v.id} className="ml-1 inline-flex items-center gap-0.5">
                          · <Car className="size-3" /> {v.plate}
                        </span>
                      ))}
                    </div>
                    <div className="flex flex-wrap gap-1 pt-1 pl-5">
                      {!f.pool && f.projectCode && (
                        <Badge variant="secondary" className="rounded-none font-normal">
                          {fmt(t("logistics.housing.projectFlat"), { code: f.projectCode })}
                        </Badge>
                      )}
                      {f.flags.map((fl) => (
                        <FlagBadge key={fl.kind} flag={fl} />
                      ))}
                    </div>
                  </TableCell>
                  <TableCell className={`text-right font-semibold tabular-nums ${f.occupiedToday > f.beds ? "text-destructive" : ""}`}>
                    {f.occupiedToday} / {f.beds}
                  </TableCell>
                  {f.weeks.map((w) => (
                    <TableCell key={w.weekStart} className="p-1 text-center">
                      {w.paidBedNights === 0 ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <div className={`px-1.5 py-1 text-xs tabular-nums ${cellTone(w.occupancy)}`} title={pct(w.occupancy)}>
                          {(w.usedBedNights / 7).toFixed(1)}/{Math.round((w.paidBedNights / 7) * 10) / 10}
                        </div>
                      )}
                    </TableCell>
                  ))}
                  <TableCell className="text-right whitespace-nowrap tabular-nums">{eur(f.month.costCents)}</TableCell>
                  <TableCell className={`text-right whitespace-nowrap tabular-nums ${f.month.costPerOccupiedBedCents !== null && f.month.costPerOccupiedBedCents > 150000 ? "font-semibold text-destructive" : ""}`}>
                    {f.month.costPerOccupiedBedCents === null ? "—" : eur(f.month.costPerOccupiedBedCents)}
                  </TableCell>
                  <TableCell className={`text-right whitespace-nowrap tabular-nums ${f.month.emptyBedCents > f.month.costCents * 0.4 ? "font-semibold text-destructive" : ""}`}>{eur(f.month.emptyBedCents)}</TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    {f.pool && (
                      <Can permission={StaffingLogisticsPermissions.planManage}>
                        <Button variant="ghost" size="icon-sm" onClick={() => onEdit(f)} aria-label={t("logistics.housing.edit")}>
                          <Pencil />
                        </Button>
                      </Can>
                    )}
                  </TableCell>
                </TableRow>
                {open === f.id && (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={cols} className="bg-muted/30">
                      <FlatDetail flat={f} data={data} />
                    </TableCell>
                  </TableRow>
                )}
              </Fragment>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}

const addDaysIso = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)

function FlatDetail({ flat, data }: { flat: FlatOverview; data: HousingOverview }) {
  const { t } = useT()
  return (
    <div className="grid gap-4 py-2 lg:grid-cols-[1fr_20rem]">
      <div className="space-y-3">
        <div className="text-xs text-muted-foreground">
          {flat.address} · {t("logistics.housing.lease")}: <Period from={flat.startDate} to={flat.endDate} />
        </div>
        <ResidentList title={t("logistics.housing.residents")} rows={flat.residents} today={data.today} empty={t("logistics.housing.noResidents")} />
        {flat.upcoming.length > 0 && <ResidentList title={t("logistics.housing.upcoming")} rows={flat.upcoming} today={data.today} />}
        {!flat.pool && <p className="text-xs text-muted-foreground">{t("logistics.housing.legacyNote")}</p>}
      </div>
      {flat.pool && (
        <Can permission={StaffingLogisticsPermissions.planManage}>
          <AddResident flat={flat} data={data} />
        </Can>
      )}
    </div>
  )
}

function ResidentList({ title, rows, today, empty }: { title: string; rows: ResidentRow[]; today: string; empty?: string }) {
  const { t } = useT()
  const end = useMutation(api.logistics.endStay)
  const { run, busy } = useAction()
  return (
    <div>
      <div className="mb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">{title}</div>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="divide-y border bg-card text-sm">
          {rows.map((r) => (
            <li key={r.stayId} className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5">
              <span>
                <span className="font-medium">{r.name}</span>{" "}
                <span className="text-muted-foreground">
                  · {r.nationality} · {r.languages.join(", ").toUpperCase()}
                </span>
                {r.canDrive && <Car className="ml-1 inline size-3.5 text-muted-foreground" aria-label={t("logistics.housing.drives")} />}
              </span>
              <span className="flex items-center gap-2 text-muted-foreground tabular-nums">
                {r.projectCodes.map((c) => (
                  <Badge key={c} variant="outline" className="rounded-none font-mono font-normal">
                    {c}
                  </Badge>
                ))}
                {r.endDate ? <Period from={r.startDate} to={r.endDate} /> : `${shortDate(r.startDate)} – ${t("logistics.housing.openEnd")}`}
                {!r.legacy && (
                  <Can permission={StaffingLogisticsPermissions.planManage}>
                    <Button variant="ghost" size="icon-sm" disabled={busy} aria-label={t("logistics.housing.endStay")} title={t("logistics.housing.endStay")} onClick={() => void run(() => end({ stayId: r.stayId as Id<"staffing_logistics_stays">, endDate: today }), { success: t("logistics.housing.endStayDone") })}>
                      <UserMinus />
                    </Button>
                  </Can>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function AddResident({ flat, data }: { flat: FlatOverview; data: HousingOverview }) {
  const { t } = useT()
  const save = useMutation(api.logistics.saveStay)
  const { run, busy } = useAction()
  const reason = useReasonText()
  const [f, setF] = useState({ workerId: "", startDate: data.today > flat.startDate ? data.today : flat.startDate, endDate: "" })
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const res = await run(() => save({ accommodationId: flat.id as FlatId, workerId: f.workerId as Id<"staffing_workers">, startDate: f.startDate, ...(f.endDate ? { endDate: f.endDate } : {}) }), { error: reason })
    if (!res) return
    if (res.issues.length) toast.warning(fmt(t("logistics.housing.issues"), { list: res.issues.map((i) => t(`logistics.housing.issue.${i}` as MessageKey)).join(", ") }))
    else toast.success(t("logistics.housing.placed"))
    setF({ ...f, workerId: "" })
  }
  return (
    <form onSubmit={submit} className="grid content-start gap-2 border bg-card p-3">
      <div className="text-sm font-medium">{t("logistics.housing.addResident")}</div>
      <F label={t("logistics.housing.worker")} htmlFor={`res-${flat.id}`}>
        <Select id={`res-${flat.id}`} value={f.workerId} onChange={(v) => setF({ ...f, workerId: v })}>
          <option value="">{t("logistics.housing.pickWorker")}</option>
          {data.workers.map((w) => (
            <option key={w.workerId} value={w.workerId}>
              {w.name} · {w.nationality} · {w.languages.join("/").toUpperCase()}
            </option>
          ))}
        </Select>
      </F>
      <div className="grid grid-cols-2 gap-2">
        <F label={t("logistics.common.from")} htmlFor={`res-from-${flat.id}`}>
          <Input id={`res-from-${flat.id}`} type="date" required value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} />
        </F>
        <F label={t("logistics.common.to")} htmlFor={`res-to-${flat.id}`}>
          <Input id={`res-to-${flat.id}`} type="date" value={f.endDate} max={flat.endDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} />
        </F>
      </div>
      <Button type="submit" size="sm" disabled={busy || !f.workerId}>
        <Plus />
        {t("logistics.housing.addResident")}
      </Button>
    </form>
  )
}

function FlatDialog({ row, region, today, onClose }: { row: FlatOverview | null; region: string; today: string; onClose: () => void }) {
  const { t } = useT()
  const save = useMutation(api.logistics.saveFlat)
  const { run, busy } = useAction()
  const [f, setF] = useState({
    name: row?.name ?? "",
    city: row?.city ?? "",
    region: row?.region ?? region,
    address: row?.address ?? "",
    beds: String(row?.beds ?? 4),
    rooms: row?.rooms ? String(row.rooms) : "",
    cost: row ? centsToEur(row.costCents) : "",
    costPeriod: (row?.costPeriod ?? "month") as CostPeriod,
    startDate: row?.startDate ?? today,
    endDate: row?.endDate ?? addDaysIso(today, 365),
    landlord: row?.landlord ?? "",
    notes: row?.notes ?? "",
  })
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const res = await run(
      () =>
        save({
          ...(row ? { accommodationId: row.id as FlatId } : {}),
          name: f.name,
          city: f.city,
          region: f.region,
          address: f.address,
          beds: Number(f.beds),
          ...(f.rooms ? { rooms: Number(f.rooms) } : {}),
          costCents: eurToCents(f.cost || "0"),
          costPeriod: f.costPeriod,
          startDate: f.startDate,
          endDate: f.endDate,
          landlord: f.landlord,
          notes: f.notes,
        }),
      { success: t("logistics.common.saved") },
    )
    if (res) onClose()
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{row ? t("logistics.housing.edit") : t("logistics.housing.add")}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="grid grid-cols-2 gap-3">
          <F label={t("logistics.acc.name")} htmlFor="flat-name" className="col-span-2">
            <Input id="flat-name" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          </F>
          <F label={t("logistics.housing.city")} htmlFor="flat-city">
            <Input id="flat-city" required value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} />
          </F>
          <F label={t("logistics.region")} htmlFor="flat-region">
            <Input id="flat-region" required value={f.region} onChange={(e) => setF({ ...f, region: e.target.value })} />
          </F>
          <F label={t("logistics.acc.address")} htmlFor="flat-address" className="col-span-2">
            <Input id="flat-address" value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} />
          </F>
          <F label={t("logistics.acc.beds")} htmlFor="flat-beds">
            <Input id="flat-beds" type="number" min={1} max={60} required value={f.beds} onChange={(e) => setF({ ...f, beds: e.target.value })} />
          </F>
          <F label={t("logistics.housing.roomsLabel")} htmlFor="flat-rooms">
            <Input id="flat-rooms" type="number" min={1} max={30} value={f.rooms} onChange={(e) => setF({ ...f, rooms: e.target.value })} />
          </F>
          <div className="col-span-2 grid grid-cols-[1fr_auto] items-end gap-2">
            <F label={t("logistics.acc.cost")} htmlFor="flat-cost">
              <Input id="flat-cost" inputMode="decimal" value={f.cost} onChange={(e) => setF({ ...f, cost: e.target.value })} />
            </F>
            <Select aria-label={t("logistics.costPeriod")} value={f.costPeriod} onChange={(v) => setF({ ...f, costPeriod: v as CostPeriod })}>
              {COST_PERIODS.map((p) => (
                <option key={p} value={p}>
                  {t(`logistics.acc.period.${p}` as MessageKey)}
                </option>
              ))}
            </Select>
          </div>
          <F label={`${t("logistics.housing.lease")}: ${t("logistics.common.from").toLowerCase()}`} htmlFor="flat-from">
            <Input id="flat-from" type="date" required value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} />
          </F>
          <F label={t("logistics.common.to")} htmlFor="flat-to">
            <Input id="flat-to" type="date" required value={f.endDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} />
          </F>
          <F label={t("logistics.housing.landlord")} htmlFor="flat-landlord" className="col-span-2">
            <Input id="flat-landlord" value={f.landlord} onChange={(e) => setF({ ...f, landlord: e.target.value })} />
          </F>
          <F label={t("logistics.common.notes")} htmlFor="flat-notes" className="col-span-2">
            <Input id="flat-notes" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
          </F>
          <DialogFooter className="col-span-2">
            <Button type="button" variant="outline" onClick={onClose}>
              {t("logistics.common.cancel")}
            </Button>
            <Button type="submit" disabled={busy}>
              {t("logistics.common.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
