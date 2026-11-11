"use client"
// Fleet (/app/logistics/vehicles): own and rented vehicles of a region with the
// month's fixed cost, fuel, service, km, cost per km and the fuel/km log.
import type { FleetOverview, FleetRow } from "@digimuza/staffing"
import { VEHICLE_LOG_KINDS, type VehicleLogKind } from "@digimuza/staffing/logistics/housing"
import { StaffingLogisticsPermissions } from "@digimuza/staffing/logistics/manifest"
import { VEHICLE_COST_PERIODS, VEHICLE_OWNERSHIP, type VehicleCostPeriod, type VehicleOwnership } from "@digimuza/staffing/logistics/pure"
import { Can } from "@digimuza/system-core/react"
import { useMutation, useQuery } from "convex/react"
import { Car, ChevronDown, ChevronRight, Pencil, Plus, Trash2 } from "lucide-react"
import { Fragment, useState, type FormEvent } from "react"
import { EmptyState } from "@/components/app/empty-state"
import { PageHeader } from "@/components/app/page-header"
import { useAction } from "@/components/app/use-action"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { useT } from "@/lib/i18n/client"
import type { MessageKey } from "@/lib/i18n/messages"
import { centsToEur, eurToCents } from "../../staffing/_components/staffing-ui"
import { eur, fmt, Select, shortDate, useLogisticsEnabled } from "./logistics-ui"
import { LogisticsSubnav, Plate, RegionMonth } from "./logistics-subnav"
import { F } from "./resources"

const perKm = (c: number | null) => (c === null ? "—" : `${(c / 100).toLocaleString("lt-LT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`)
const num = (n: number) => n.toLocaleString("lt-LT")

export function FleetDashboard() {
  const { t } = useT()
  const enabled = useLogisticsEnabled()
  const [region, setRegion] = useState<string>()
  const [month, setMonth] = useState<string>()
  const data = useQuery(api.logistics.fleetOverview, enabled ? { ...(region ? { region } : {}), ...(month ? { month } : {}) } : "skip")
  const [editing, setEditing] = useState<FleetRow | "new" | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  if (!enabled) return <p className="text-sm text-muted-foreground">{t("logistics.disabled")}</p>
  return (
    <div>
      <PageHeader
        title={t("logistics.fleet.title")}
        lead={t("logistics.fleet.lead")}
        actions={
          <>
            {data && <RegionMonth regions={data.regions.length ? data.regions : [data.region]} region={data.region} month={data.month} onRegion={setRegion} onMonth={setMonth} />}
            <Can permission={StaffingLogisticsPermissions.planManage}>
              <Button size="sm" onClick={() => setEditing("new")}>
                <Plus />
                {t("logistics.fleet.add")}
              </Button>
            </Can>
          </>
        }
      />
      <LogisticsSubnav />
      {!data ? (
        <Skeleton className="h-96 w-full" />
      ) : data.vehicles.length === 0 ? (
        <EmptyState icon={<Car />} title={t("logistics.fleet.empty")} body={t("logistics.housing.emptyBody")} />
      ) : (
        <div className="space-y-6">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Plate label={t("logistics.fleet.kpi.vehicles")} value={String(data.totals.vehicles)} hint={`${data.vehicles.filter((v) => v.ownership === "owned").length} ${t("logistics.veh.own.owned").toLowerCase()} · ${data.vehicles.filter((v) => v.ownership === "rented").length} ${t("logistics.veh.own.rented").toLowerCase()}`} />
            <Plate label={t("logistics.fleet.kpi.total")} value={eur(data.totals.totalCents)} hint={data.month} />
            <Plate label={t("logistics.fleet.kpi.fuel")} value={eur(data.totals.fuelCents)} />
            <Plate label={t("logistics.fleet.kpi.km")} value={`${num(data.totals.km)} km`} />
            <Plate label={t("logistics.fleet.kpi.perKm")} value={perKm(data.totals.costPerKmCents)} />
          </div>
          <Card>
            <CardContent className="overflow-x-auto pt-6">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="min-w-56">{t("logistics.fleet.col.vehicle")}</TableHead>
                    <TableHead>{t("logistics.fleet.col.group")}</TableHead>
                    <TableHead className="text-right">{t("logistics.fleet.col.fixed")}</TableHead>
                    <TableHead className="text-right">{t("logistics.fleet.col.fuel")}</TableHead>
                    <TableHead className="text-right">{t("logistics.fleet.col.service")}</TableHead>
                    <TableHead className="text-right">{t("logistics.fleet.col.km")}</TableHead>
                    <TableHead className="text-right">{t("logistics.fleet.col.consumption")}</TableHead>
                    <TableHead className="text-right">{t("logistics.fleet.col.perKm")}</TableHead>
                    <TableHead className="text-right">{t("logistics.fleet.col.total")}</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.vehicles.map((v) => (
                    <Fragment key={v.id}>
                      <TableRow className="cursor-pointer" onClick={() => setOpen(open === v.id ? null : v.id)}>
                        <TableCell>
                          <div className="flex items-center gap-1.5 font-medium">
                            {open === v.id ? <ChevronDown className="size-4 shrink-0" /> : <ChevronRight className="size-4 shrink-0" />}
                            {v.model} <span className="font-mono text-xs text-muted-foreground">{v.plate}</span>
                          </div>
                          <div className="flex flex-wrap items-center gap-1 pt-1 pl-5 text-xs text-muted-foreground">
                            <Badge variant={v.ownership === "owned" ? "secondary" : "outline"} className="rounded-none font-normal">
                              {t(`logistics.veh.own.${v.ownership}` as MessageKey)}
                            </Badge>
                            {v.seats} {t("logistics.veh.seats").toLowerCase()} · {eur(v.costCents)} {t(`logistics.veh.period.${v.costPeriod}` as MessageKey)}
                          </div>
                        </TableCell>
                        <TableCell className="text-sm">
                          {v.accommodationName ?? (v.projectCode ? <span className="font-mono">{v.projectCode}</span> : <span className="text-muted-foreground">{t("logistics.fleet.noGroup")}</span>)}
                          {v.accommodationId && (
                            <div className={`text-xs ${v.drivers.length === 0 ? "text-marking-foreground dark:text-marking" : "text-muted-foreground"}`}>
                              {fmt(t("logistics.fleet.riders"), { n: v.riders, drivers: v.drivers.length ? v.drivers.map((d) => d.name).join(", ") : t("logistics.fleet.noDriver") })}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{eur(v.month.fixedCents)}</TableCell>
                        <TableCell className="text-right tabular-nums">{eur(v.month.fuelCents)}</TableCell>
                        <TableCell className="text-right tabular-nums">{v.month.serviceCents ? eur(v.month.serviceCents) : "—"}</TableCell>
                        <TableCell className="text-right tabular-nums">{num(v.month.km)}</TableCell>
                        <TableCell className="text-right tabular-nums">{v.month.litresPer100Km ?? "—"}</TableCell>
                        <TableCell className={`text-right tabular-nums ${v.month.costPerKmCents !== null && v.month.costPerKmCents > 100 ? "font-semibold text-destructive" : ""}`}>{perKm(v.month.costPerKmCents)}</TableCell>
                        <TableCell className="text-right font-semibold tabular-nums">{eur(v.month.totalCents)}</TableCell>
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          {!v.projectId && (
                            <Can permission={StaffingLogisticsPermissions.planManage}>
                              <Button variant="ghost" size="icon-sm" onClick={() => setEditing(v)} aria-label={t("logistics.veh.edit")}>
                                <Pencil />
                              </Button>
                            </Can>
                          )}
                        </TableCell>
                      </TableRow>
                      {open === v.id && (
                        <TableRow className="hover:bg-transparent">
                          <TableCell colSpan={10} className="bg-muted/30">
                            <VehicleLog vehicle={v} data={data} />
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      )}
      {editing && data && <VehicleDialog row={editing === "new" ? null : editing} data={data} onClose={() => setEditing(null)} />}
    </div>
  )
}

function VehicleLog({ vehicle, data }: { vehicle: FleetRow; data: FleetOverview }) {
  const { t } = useT()
  const add = useMutation(api.logistics.addVehicleLog)
  const del = useMutation(api.logistics.deleteVehicleLog)
  const { run, busy } = useAction()
  const [f, setF] = useState({ date: data.today, kind: "fuel" as VehicleLogKind, km: "", litres: "", cost: "", driverId: vehicle.drivers[0]?.workerId ?? "" })
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const res = await run(
      () =>
        add({
          vehicleId: vehicle.id as Id<"staffing_logistics_vehicles">,
          date: f.date,
          kind: f.kind,
          km: Number(f.km || 0),
          litres: Number((f.litres || "0").replace(",", ".")),
          costCents: eurToCents(f.cost || "0"),
          ...(f.driverId ? { driverId: f.driverId as Id<"staffing_workers"> } : {}),
        }),
      { success: t("logistics.common.saved") },
    )
    if (res) setF({ ...f, km: "", litres: "", cost: "" })
  }
  return (
    <div className="grid gap-4 py-2 lg:grid-cols-[1fr_22rem]">
      <div>
        <div className="mb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">{t("logistics.fleet.log.title")}</div>
        {vehicle.logs.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("logistics.fleet.log.empty")}</p>
        ) : (
          <table className="w-full border bg-card text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr className="border-b">
                <th className="px-2 py-1 text-left font-normal">{t("logistics.fleet.log.date")}</th>
                <th className="px-2 py-1 text-left font-normal">{t("logistics.fleet.log.kind")}</th>
                <th className="px-2 py-1 text-right font-normal">{t("logistics.fleet.col.km")}</th>
                <th className="px-2 py-1 text-right font-normal">{t("logistics.fleet.log.litres")}</th>
                <th className="px-2 py-1 text-right font-normal">€</th>
                <th className="px-2 py-1 text-left font-normal">{t("logistics.fleet.log.driver")}</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {vehicle.logs.map((l) => (
                <tr key={l.id} className="border-b last:border-0">
                  <td className="px-2 py-1 tabular-nums">{shortDate(l.date)}</td>
                  <td className="px-2 py-1">{t(`logistics.fleet.log.kind.${l.kind}` as MessageKey)}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{l.km ? num(l.km) : "—"}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{l.litres || "—"}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{centsToEur(l.costCents)}</td>
                  <td className="px-2 py-1 text-muted-foreground">{l.driverName ?? "—"}</td>
                  <td className="px-1">
                    <Can permission={StaffingLogisticsPermissions.planManage}>
                      <Button variant="ghost" size="icon-sm" disabled={busy} aria-label={t("logistics.common.delete")} onClick={() => void run(() => del({ logId: l.id as Id<"staffing_logistics_vehicleLogs"> }), { success: t("logistics.common.deleted") })}>
                        <Trash2 />
                      </Button>
                    </Can>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <Can permission={StaffingLogisticsPermissions.planManage}>
        <form onSubmit={submit} className="grid content-start grid-cols-2 gap-2 border bg-card p-3">
          <div className="col-span-2 text-sm font-medium">{t("logistics.fleet.log.add")}</div>
          <F label={t("logistics.fleet.log.date")} htmlFor={`log-date-${vehicle.id}`}>
            <Input id={`log-date-${vehicle.id}`} type="date" required value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
          </F>
          <F label={t("logistics.fleet.log.kind")} htmlFor={`log-kind-${vehicle.id}`}>
            <Select id={`log-kind-${vehicle.id}`} value={f.kind} onChange={(v) => setF({ ...f, kind: v as VehicleLogKind })}>
              {VEHICLE_LOG_KINDS.map((k) => (
                <option key={k} value={k}>
                  {t(`logistics.fleet.log.kind.${k}` as MessageKey)}
                </option>
              ))}
            </Select>
          </F>
          <F label={t("logistics.fleet.log.km")} htmlFor={`log-km-${vehicle.id}`}>
            <Input id={`log-km-${vehicle.id}`} type="number" min={0} value={f.km} onChange={(e) => setF({ ...f, km: e.target.value })} />
          </F>
          <F label={t("logistics.fleet.log.litres")} htmlFor={`log-l-${vehicle.id}`}>
            <Input id={`log-l-${vehicle.id}`} inputMode="decimal" value={f.litres} onChange={(e) => setF({ ...f, litres: e.target.value })} />
          </F>
          <F label={t("logistics.fleet.log.cost")} htmlFor={`log-cost-${vehicle.id}`}>
            <Input id={`log-cost-${vehicle.id}`} inputMode="decimal" value={f.cost} onChange={(e) => setF({ ...f, cost: e.target.value })} />
          </F>
          <F label={t("logistics.fleet.log.driver")} htmlFor={`log-driver-${vehicle.id}`}>
            <Select id={`log-driver-${vehicle.id}`} value={f.driverId} onChange={(v) => setF({ ...f, driverId: v })}>
              <option value="">{t("logistics.fleet.log.noDriver")}</option>
              {data.drivers.map((d) => (
                <option key={d.workerId} value={d.workerId}>
                  {d.name}
                </option>
              ))}
            </Select>
          </F>
          <Button type="submit" size="sm" className="col-span-2" disabled={busy}>
            <Plus />
            {t("logistics.fleet.log.add")}
          </Button>
        </form>
      </Can>
    </div>
  )
}

function VehicleDialog({ row, data, onClose }: { row: FleetRow | null; data: FleetOverview; onClose: () => void }) {
  const { t } = useT()
  const save = useMutation(api.logistics.saveFleetVehicle)
  const { run, busy } = useAction()
  const [f, setF] = useState({
    plate: row?.plate ?? "",
    model: row?.model ?? "",
    seats: String(row?.seats ?? 6),
    ownership: (row?.ownership ?? "owned") as VehicleOwnership,
    cost: row ? centsToEur(row.costCents) : "",
    costPeriod: (row?.costPeriod ?? "month") as VehicleCostPeriod,
    startDate: row?.startDate ?? data.today,
    endDate: row?.endDate ?? "",
    accommodationId: row?.accommodationId ?? "",
    notes: row?.notes ?? "",
  })
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const res = await run(
      () =>
        save({
          ...(row ? { vehicleId: row.id as Id<"staffing_logistics_vehicles"> } : {}),
          plate: f.plate,
          model: f.model,
          seats: Number(f.seats),
          ownership: f.ownership,
          costCents: eurToCents(f.cost || "0"),
          costPeriod: f.costPeriod,
          startDate: f.startDate,
          endDate: f.endDate,
          region: data.region,
          accommodationId: f.accommodationId ? (f.accommodationId as Id<"staffing_logistics_accommodations">) : null,
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
          <DialogTitle>{row ? t("logistics.veh.edit") : t("logistics.fleet.add")}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="grid grid-cols-2 gap-3">
          <F label={t("logistics.veh.plate")} htmlFor="fv-plate">
            <Input id="fv-plate" required value={f.plate} onChange={(e) => setF({ ...f, plate: e.target.value })} />
          </F>
          <F label={t("logistics.veh.model")} htmlFor="fv-model">
            <Input id="fv-model" value={f.model} onChange={(e) => setF({ ...f, model: e.target.value })} />
          </F>
          <F label={t("logistics.veh.seats")} htmlFor="fv-seats">
            <Input id="fv-seats" type="number" min={1} max={60} required value={f.seats} onChange={(e) => setF({ ...f, seats: e.target.value })} />
          </F>
          <F label={t("logistics.veh.ownership")} htmlFor="fv-own">
            <Select id="fv-own" value={f.ownership} onChange={(v) => setF({ ...f, ownership: v as VehicleOwnership })}>
              {VEHICLE_OWNERSHIP.map((o) => (
                <option key={o} value={o}>
                  {t(`logistics.veh.own.${o}` as MessageKey)}
                </option>
              ))}
            </Select>
          </F>
          <div className="col-span-2 grid grid-cols-[1fr_auto] items-end gap-2">
            <F label={t("logistics.acc.cost")} htmlFor="fv-cost">
              <Input id="fv-cost" inputMode="decimal" value={f.cost} onChange={(e) => setF({ ...f, cost: e.target.value })} />
            </F>
            <Select aria-label={t("logistics.costPeriod")} value={f.costPeriod} onChange={(v) => setF({ ...f, costPeriod: v as VehicleCostPeriod })}>
              {VEHICLE_COST_PERIODS.map((p) => (
                <option key={p} value={p}>
                  {t(`logistics.veh.period.${p}` as MessageKey)}
                </option>
              ))}
            </Select>
          </div>
          <F label={t("logistics.common.from")} htmlFor="fv-from">
            <Input id="fv-from" type="date" required value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} />
          </F>
          <F label={t("logistics.common.to")} htmlFor="fv-to">
            <Input id="fv-to" type="date" required value={f.endDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} />
          </F>
          <F label={t("logistics.fleet.col.group")} htmlFor="fv-flat" className="col-span-2">
            <Select id="fv-flat" value={f.accommodationId} onChange={(v) => setF({ ...f, accommodationId: v })}>
              <option value="">{t("logistics.fleet.noGroup")}</option>
              {data.flats.map((fl) => (
                <option key={fl.id} value={fl.id}>
                  {fl.name}
                </option>
              ))}
            </Select>
          </F>
          <F label={t("logistics.common.notes")} htmlFor="fv-notes" className="col-span-2">
            <Input id="fv-notes" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
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
