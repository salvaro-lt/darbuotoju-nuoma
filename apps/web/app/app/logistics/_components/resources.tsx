"use client"
// Accommodation and vehicles of a project: lists with add / edit / delete.
import type { AccommodationRow, LogisticsPlan, VehicleRow } from "@digimuza/staffing"
import { COST_PERIODS, VEHICLE_COST_PERIODS, VEHICLE_OWNERSHIP, type CostPeriod, type VehicleCostPeriod, type VehicleOwnership } from "@digimuza/staffing/logistics/pure"
import { StaffingLogisticsPermissions } from "@digimuza/staffing/logistics/manifest"
import { Can } from "@digimuza/system-core/react"
import { useMutation } from "convex/react"
import { Pencil, Plus, Trash2 } from "lucide-react"
import { useState, type FormEvent, type ReactNode } from "react"
import { useAction } from "@/components/app/use-action"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { useT } from "@/lib/i18n/client"
import type { MessageKey } from "@/lib/i18n/messages"
import { centsToEur, ConfirmDelete, eurToCents, Period } from "../../staffing/_components/staffing-ui"
import { eur, Select } from "./logistics-ui"

export function Resources({ plan }: { plan: LogisticsPlan }) {
  return (
    <div className="space-y-6">
      <Accommodations plan={plan} />
      <Vehicles plan={plan} />
    </div>
  )
}

/** Label + control, stacked. */
export function F({ label, htmlFor, children, className }: { label: string; htmlFor: string; children: ReactNode; className?: string }) {
  return (
    <div className={`grid gap-1.5 ${className ?? ""}`}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  )
}

function RowActions({ onEdit, onDelete }: { onEdit: () => void; onDelete: () => void }) {
  const { t } = useT()
  return (
    <Can permission={StaffingLogisticsPermissions.planManage}>
      <div className="flex justify-end gap-1">
        <Button variant="ghost" size="icon-sm" onClick={onEdit} aria-label={t("logistics.acc.edit")}>
          <Pencil />
        </Button>
        <Button variant="ghost" size="icon-sm" onClick={onDelete} aria-label={t("logistics.common.delete")}>
          <Trash2 />
        </Button>
      </div>
    </Can>
  )
}

// ---------------------------------------------------------------- accommodation

function Accommodations({ plan }: { plan: LogisticsPlan }) {
  const { t } = useT()
  const [editing, setEditing] = useState<AccommodationRow | "new" | null>(null)
  const [deleting, setDeleting] = useState<AccommodationRow | null>(null)
  const del = useMutation(api.logistics.deleteAccommodation)
  const { run, busy } = useAction()
  const people = (id: string) => new Set(plan.members.filter((m) => m.accommodationId === id).map((m) => m.workerId)).size
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <CardTitle>{t("logistics.acc.title")}</CardTitle>
        <Can permission={StaffingLogisticsPermissions.planManage}>
          <Button size="sm" onClick={() => setEditing("new")}>
            <Plus />
            {t("logistics.acc.add")}
          </Button>
        </Can>
      </CardHeader>
      <CardContent>
        {plan.accommodations.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("logistics.acc.empty")}</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>{t("logistics.acc.name")}</TableHead>
                  <TableHead className="text-right">{t("logistics.acc.beds")}</TableHead>
                  <TableHead className="text-right">{t("logistics.acc.cost")}</TableHead>
                  <TableHead>{t("logistics.team.period")}</TableHead>
                  <TableHead className="w-24" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {plan.accommodations.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell>
                      <div className="font-medium">{a.name}</div>
                      <div className="text-xs text-muted-foreground">{a.address}</div>
                      {a.notes && <div className="text-xs text-muted-foreground italic">{a.notes}</div>}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {people(a.id)} / {a.beds}
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap tabular-nums">
                      {eur(a.costCents)} <span className="text-xs text-muted-foreground">{t(`logistics.acc.period.${a.costPeriod}` as MessageKey)}</span>
                    </TableCell>
                    <TableCell>
                      <Period from={a.startDate} to={a.endDate} />
                    </TableCell>
                    <TableCell>
                      <RowActions onEdit={() => setEditing(a)} onDelete={() => setDeleting(a)} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
      {editing && <AccommodationDialog plan={plan} row={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
      <ConfirmDelete
        open={Boolean(deleting)}
        title={deleting?.name ?? ""}
        body={t("logistics.common.confirmDelete")}
        busy={busy}
        onCancel={() => setDeleting(null)}
        onConfirm={() => void run(() => del({ accommodationId: deleting!.id as Id<"staffing_logistics_accommodations"> }), { success: t("logistics.common.deleted") }).then(() => setDeleting(null))}
      />
    </Card>
  )
}

function AccommodationDialog({ plan, row, onClose }: { plan: LogisticsPlan; row: AccommodationRow | null; onClose: () => void }) {
  const { t } = useT()
  const save = useMutation(api.logistics.saveAccommodation)
  const { run, busy } = useAction()
  const [f, setF] = useState({
    name: row?.name ?? "",
    address: row?.address ?? "",
    beds: String(row?.beds ?? 4),
    cost: row ? centsToEur(row.costCents) : "",
    costPeriod: (row?.costPeriod ?? "month") as CostPeriod,
    startDate: row?.startDate ?? plan.project.startDate,
    endDate: row?.endDate ?? plan.project.endDate ?? "",
    notes: row?.notes ?? "",
  })
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const res = await run(
      () =>
        save({
          projectId: plan.project.id,
          ...(row ? { accommodationId: row.id as Id<"staffing_logistics_accommodations"> } : {}),
          name: f.name,
          address: f.address,
          beds: Number(f.beds),
          costCents: eurToCents(f.cost || "0"),
          costPeriod: f.costPeriod,
          startDate: f.startDate,
          endDate: f.endDate,
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
          <DialogTitle>{row ? t("logistics.acc.edit") : t("logistics.acc.add")}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="grid grid-cols-2 gap-3">
          <F label={t("logistics.acc.name")} htmlFor="acc-name" className="col-span-2">
            <Input id="acc-name" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          </F>
          <F label={t("logistics.acc.address")} htmlFor="acc-address" className="col-span-2">
            <Input id="acc-address" value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} />
          </F>
          <F label={t("logistics.acc.beds")} htmlFor="acc-beds">
            <Input id="acc-beds" type="number" min={1} max={200} required value={f.beds} onChange={(e) => setF({ ...f, beds: e.target.value })} />
          </F>
          <div className="grid grid-cols-[1fr_auto] items-end gap-2">
            <F label={t("logistics.acc.cost")} htmlFor="acc-cost">
              <Input id="acc-cost" inputMode="decimal" value={f.cost} onChange={(e) => setF({ ...f, cost: e.target.value })} />
            </F>
            <Select aria-label={t("logistics.costPeriod")} value={f.costPeriod} onChange={(v) => setF({ ...f, costPeriod: v as CostPeriod })}>
              {COST_PERIODS.map((p) => (
                <option key={p} value={p}>
                  {t(`logistics.acc.period.${p}` as MessageKey)}
                </option>
              ))}
            </Select>
          </div>
          <F label={t("logistics.common.from")} htmlFor="acc-from">
            <Input id="acc-from" type="date" required value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} />
          </F>
          <F label={t("logistics.common.to")} htmlFor="acc-to">
            <Input id="acc-to" type="date" required value={f.endDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} />
          </F>
          <F label={t("logistics.common.notes")} htmlFor="acc-notes" className="col-span-2">
            <Input id="acc-notes" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
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

// ---------------------------------------------------------------- vehicles

function Vehicles({ plan }: { plan: LogisticsPlan }) {
  const { t } = useT()
  const [editing, setEditing] = useState<VehicleRow | "new" | null>(null)
  const [deleting, setDeleting] = useState<VehicleRow | null>(null)
  const del = useMutation(api.logistics.deleteVehicle)
  const { run, busy } = useAction()
  const riders = (id: string) => plan.members.filter((m) => m.vehicleId === id)
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <CardTitle>{t("logistics.veh.title")}</CardTitle>
        <Can permission={StaffingLogisticsPermissions.planManage}>
          <Button size="sm" onClick={() => setEditing("new")}>
            <Plus />
            {t("logistics.veh.add")}
          </Button>
        </Can>
      </CardHeader>
      <CardContent>
        {plan.vehicles.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("logistics.veh.empty")}</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>{t("logistics.veh.model")}</TableHead>
                  <TableHead className="text-right">{t("logistics.veh.seats")}</TableHead>
                  <TableHead>{t("logistics.team.driver")}</TableHead>
                  <TableHead className="text-right">{t("logistics.acc.cost")}</TableHead>
                  <TableHead>{t("logistics.team.period")}</TableHead>
                  <TableHead className="w-24" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {plan.vehicles.map((v) => {
                  const r = riders(v.id)
                  const driver = r.find((m) => m.driver)
                  return (
                    <TableRow key={v.id}>
                      <TableCell>
                        <div className="font-medium">
                          {v.model} <span className="font-mono text-xs">{v.plate}</span>
                        </div>
                        <div className="text-xs text-muted-foreground">{t(`logistics.veh.own.${v.ownership}` as MessageKey)}</div>
                      </TableCell>
                      <TableCell className={`text-right tabular-nums ${r.length > v.seats ? "font-semibold text-red-700" : ""}`}>
                        {new Set(r.map((m) => m.workerId)).size} / {v.seats}
                      </TableCell>
                      <TableCell>{driver ? driver.name : <span className="font-medium text-red-700 dark:text-red-400">{t("logistics.timeline.noDriver")}</span>}</TableCell>
                      <TableCell className="text-right whitespace-nowrap tabular-nums">
                        {eur(v.costCents)} <span className="text-xs text-muted-foreground">{t(`logistics.veh.period.${v.costPeriod}` as MessageKey)}</span>
                      </TableCell>
                      <TableCell>
                        <Period from={v.startDate} to={v.endDate} />
                      </TableCell>
                      <TableCell>
                        <RowActions onEdit={() => setEditing(v)} onDelete={() => setDeleting(v)} />
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
      {editing && <VehicleDialog plan={plan} row={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
      <ConfirmDelete
        open={Boolean(deleting)}
        title={deleting ? `${deleting.model} ${deleting.plate}` : ""}
        body={t("logistics.common.confirmDelete")}
        busy={busy}
        onCancel={() => setDeleting(null)}
        onConfirm={() => void run(() => del({ vehicleId: deleting!.id as Id<"staffing_logistics_vehicles"> }), { success: t("logistics.common.deleted") }).then(() => setDeleting(null))}
      />
    </Card>
  )
}

function VehicleDialog({ plan, row, onClose }: { plan: LogisticsPlan; row: VehicleRow | null; onClose: () => void }) {
  const { t } = useT()
  const save = useMutation(api.logistics.saveVehicle)
  const { run, busy } = useAction()
  const [f, setF] = useState({
    plate: row?.plate ?? "",
    model: row?.model ?? "",
    seats: String(row?.seats ?? 5),
    ownership: (row?.ownership ?? "rented") as VehicleOwnership,
    cost: row ? centsToEur(row.costCents) : "",
    costPeriod: (row?.costPeriod ?? "day") as VehicleCostPeriod,
    startDate: row?.startDate ?? plan.project.startDate,
    endDate: row?.endDate ?? plan.project.endDate ?? "",
    notes: row?.notes ?? "",
  })
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const res = await run(
      () =>
        save({
          projectId: plan.project.id,
          ...(row ? { vehicleId: row.id as Id<"staffing_logistics_vehicles"> } : {}),
          plate: f.plate,
          model: f.model,
          seats: Number(f.seats),
          ownership: f.ownership,
          costCents: eurToCents(f.cost || "0"),
          costPeriod: f.costPeriod,
          startDate: f.startDate,
          endDate: f.endDate,
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
          <DialogTitle>{row ? t("logistics.veh.edit") : t("logistics.veh.add")}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="grid grid-cols-2 gap-3">
          <F label={t("logistics.veh.model")} htmlFor="veh-model">
            <Input id="veh-model" value={f.model} onChange={(e) => setF({ ...f, model: e.target.value })} />
          </F>
          <F label={t("logistics.veh.plate")} htmlFor="veh-plate">
            <Input id="veh-plate" required value={f.plate} onChange={(e) => setF({ ...f, plate: e.target.value })} />
          </F>
          <F label={t("logistics.veh.seats")} htmlFor="veh-seats">
            <Input id="veh-seats" type="number" min={1} max={60} required value={f.seats} onChange={(e) => setF({ ...f, seats: e.target.value })} />
          </F>
          <F label={t("logistics.veh.ownership")} htmlFor="veh-own">
            <Select id="veh-own" value={f.ownership} onChange={(v) => setF({ ...f, ownership: v as VehicleOwnership })}>
              {VEHICLE_OWNERSHIP.map((o) => (
                <option key={o} value={o}>
                  {t(`logistics.veh.own.${o}` as MessageKey)}
                </option>
              ))}
            </Select>
          </F>
          <div className="col-span-2 grid grid-cols-[1fr_auto] items-end gap-2">
            <F label={t("logistics.acc.cost")} htmlFor="veh-cost">
              <Input id="veh-cost" inputMode="decimal" value={f.cost} onChange={(e) => setF({ ...f, cost: e.target.value })} />
            </F>
            <Select aria-label={t("logistics.costPeriod")} value={f.costPeriod} onChange={(v) => setF({ ...f, costPeriod: v as VehicleCostPeriod })}>
              {VEHICLE_COST_PERIODS.map((p) => (
                <option key={p} value={p}>
                  {t(`logistics.veh.period.${p}` as MessageKey)}
                </option>
              ))}
            </Select>
          </div>
          <F label={t("logistics.common.from")} htmlFor="veh-from">
            <Input id="veh-from" type="date" required value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} />
          </F>
          <F label={t("logistics.common.to")} htmlFor="veh-to">
            <Input id="veh-to" type="date" required value={f.endDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} />
          </F>
          <F label={t("logistics.common.notes")} htmlFor="veh-notes" className="col-span-2">
            <Input id="veh-notes" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
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
