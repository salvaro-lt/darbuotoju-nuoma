"use client"
// Travel legs of a project's team: arrivals and departures, booked or not.
import type { LogisticsPlan, TravelLegRow } from "@digimuza/staffing"
import { TRAVEL_DIRECTIONS, TRAVEL_MODES, type TravelDirection, type TravelMode } from "@digimuza/staffing/logistics/pure"
import { StaffingLogisticsPermissions } from "@digimuza/staffing/logistics/manifest"
import { Can, useCan } from "@digimuza/system-core/react"
import { useMutation } from "convex/react"
import { Pencil, Plus, Trash2 } from "lucide-react"
import { useState, type FormEvent } from "react"
import { useAction } from "@/components/app/use-action"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { useT } from "@/lib/i18n/client"
import type { MessageKey } from "@/lib/i18n/messages"
import { centsToEur, ConfirmDelete, eurToCents } from "../../staffing/_components/staffing-ui"
import { eur, Select } from "./logistics-ui"
import { F } from "./resources"

export function Travel({ plan }: { plan: LogisticsPlan }) {
  const { t } = useT()
  const canManage = useCan(StaffingLogisticsPermissions.planManage)
  const [editing, setEditing] = useState<TravelLegRow | "new" | null>(null)
  const [deleting, setDeleting] = useState<TravelLegRow | null>(null)
  const setBooked = useMutation(api.logistics.setTravelLegBooked)
  const del = useMutation(api.logistics.deleteTravelLeg)
  const { run, busy } = useAction()
  const today = plan.window.today
  const legs = [...plan.travelLegs].sort((a, b) => Number(a.date < today) - Number(b.date < today) || (a.date < today ? b.date.localeCompare(a.date) : a.date.localeCompare(b.date)))
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <CardTitle>{t("logistics.leg.title")}</CardTitle>
        <Can permission={StaffingLogisticsPermissions.planManage}>
          <Button size="sm" onClick={() => setEditing("new")} disabled={plan.members.length === 0}>
            <Plus />
            {t("logistics.leg.add")}
          </Button>
        </Can>
      </CardHeader>
      <CardContent>
        {legs.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("logistics.leg.empty")}</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>{t("logistics.leg.date")}</TableHead>
                  <TableHead>{t("logistics.leg.worker")}</TableHead>
                  <TableHead>{t("logistics.leg.route")}</TableHead>
                  <TableHead>{t("logistics.leg.mode")}</TableHead>
                  <TableHead className="text-right">{t("logistics.leg.cost")}</TableHead>
                  <TableHead>{t("logistics.leg.booked")}</TableHead>
                  <TableHead className="w-24" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {legs.map((l) => (
                  <TableRow key={l.id} className={l.date < today ? "opacity-60" : ""}>
                    <TableCell className="whitespace-nowrap tabular-nums">{l.date}</TableCell>
                    <TableCell className="font-medium">{l.workerName}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      <Badge variant="outline" className="mr-1.5">
                        {t(`logistics.leg.dir.${l.direction}` as MessageKey)}
                      </Badge>
                      {l.fromCity} → {l.toCity}
                    </TableCell>
                    <TableCell>{t(`logistics.leg.mode.${l.mode}` as MessageKey)}</TableCell>
                    <TableCell className="text-right tabular-nums">{eur(l.ticketCostCents)}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Checkbox aria-label={t("logistics.leg.booked")} checked={l.booked} disabled={!canManage || busy} onCheckedChange={(c) => void run(() => setBooked({ legId: l.id as Id<"staffing_logistics_travelLegs">, booked: c === true }), { success: t("logistics.common.saved") })} />
                        {l.booked ? <span className="font-mono text-xs text-muted-foreground">{l.bookingRef}</span> : l.date >= today && <Badge variant="destructive">{t("logistics.team.unbooked")}</Badge>}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Can permission={StaffingLogisticsPermissions.planManage}>
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="icon-sm" onClick={() => setEditing(l)} aria-label={t("logistics.leg.edit")}>
                            <Pencil />
                          </Button>
                          <Button variant="ghost" size="icon-sm" onClick={() => setDeleting(l)} aria-label={t("logistics.common.delete")}>
                            <Trash2 />
                          </Button>
                        </div>
                      </Can>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
      {editing && <LegDialog plan={plan} row={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
      <ConfirmDelete
        open={Boolean(deleting)}
        title={deleting ? `${deleting.workerName}, ${deleting.date}` : ""}
        body={t("logistics.common.confirmDelete")}
        busy={busy}
        onCancel={() => setDeleting(null)}
        onConfirm={() => void run(() => del({ legId: deleting!.id as Id<"staffing_logistics_travelLegs"> }), { success: t("logistics.common.deleted") }).then(() => setDeleting(null))}
      />
    </Card>
  )
}

function LegDialog({ plan, row, onClose }: { plan: LogisticsPlan; row: TravelLegRow | null; onClose: () => void }) {
  const { t } = useT()
  const save = useMutation(api.logistics.saveTravelLeg)
  const { run, busy } = useAction()
  const workers = [...new Map(plan.members.map((m) => [m.workerId, m])).values()]
  const site = plan.project.city
  const [f, setF] = useState({
    workerId: row?.workerId ?? workers[0]?.workerId ?? "",
    direction: (row?.direction ?? "arrival") as TravelDirection,
    fromCity: row?.fromCity ?? "",
    toCity: row?.toCity ?? site,
    date: row?.date ?? workers[0]?.startDate ?? plan.window.today,
    mode: (row?.mode ?? "flight") as TravelMode,
    cost: row ? centsToEur(row.ticketCostCents) : "",
    booked: row?.booked ?? false,
    bookingRef: row?.bookingRef ?? "",
  })
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const res = await run(
      () =>
        save({
          projectId: plan.project.id,
          ...(row ? { legId: row.id as Id<"staffing_logistics_travelLegs"> } : {}),
          workerId: f.workerId as Id<"staffing_workers">,
          direction: f.direction,
          fromCity: f.fromCity,
          toCity: f.toCity,
          date: f.date,
          mode: f.mode,
          ticketCostCents: eurToCents(f.cost || "0"),
          booked: f.booked,
          bookingRef: f.bookingRef,
        }),
      { success: t("logistics.common.saved") },
    )
    if (res) onClose()
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{row ? t("logistics.leg.edit") : t("logistics.leg.add")}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="grid grid-cols-2 gap-3">
          <F label={t("logistics.leg.worker")} htmlFor="leg-worker" className="col-span-2">
            <Select id="leg-worker" value={f.workerId} onChange={(v) => setF({ ...f, workerId: v })}>
              {workers.map((w) => (
                <option key={w.workerId} value={w.workerId}>
                  {w.name}
                </option>
              ))}
            </Select>
          </F>
          <F label={t("logistics.leg.direction")} htmlFor="leg-dir">
            <Select
              id="leg-dir"
              value={f.direction}
              onChange={(v) => setF({ ...f, direction: v as TravelDirection, fromCity: f.toCity, toCity: f.fromCity })}
            >
              {TRAVEL_DIRECTIONS.map((d) => (
                <option key={d} value={d}>
                  {t(`logistics.leg.dir.${d}` as MessageKey)}
                </option>
              ))}
            </Select>
          </F>
          <F label={t("logistics.leg.date")} htmlFor="leg-date">
            <Input id="leg-date" type="date" required value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
          </F>
          <F label={t("logistics.leg.from")} htmlFor="leg-from">
            <Input id="leg-from" required value={f.fromCity} onChange={(e) => setF({ ...f, fromCity: e.target.value })} />
          </F>
          <F label={t("logistics.leg.to")} htmlFor="leg-to">
            <Input id="leg-to" required value={f.toCity} onChange={(e) => setF({ ...f, toCity: e.target.value })} />
          </F>
          <F label={t("logistics.leg.mode")} htmlFor="leg-mode">
            <Select id="leg-mode" value={f.mode} onChange={(v) => setF({ ...f, mode: v as TravelMode })}>
              {TRAVEL_MODES.map((m) => (
                <option key={m} value={m}>
                  {t(`logistics.leg.mode.${m}` as MessageKey)}
                </option>
              ))}
            </Select>
          </F>
          <F label={t("logistics.leg.cost")} htmlFor="leg-cost">
            <Input id="leg-cost" inputMode="decimal" value={f.cost} onChange={(e) => setF({ ...f, cost: e.target.value })} />
          </F>
          <div className="flex items-center gap-2 self-end pb-2">
            <Checkbox id="leg-booked" checked={f.booked} onCheckedChange={(c) => setF({ ...f, booked: c === true })} />
            <Label htmlFor="leg-booked">{t("logistics.leg.booked")}</Label>
          </div>
          <F label={t("logistics.leg.ref")} htmlFor="leg-ref">
            <Input id="leg-ref" value={f.bookingRef} onChange={(e) => setF({ ...f, bookingRef: e.target.value })} />
          </F>
          <DialogFooter className="col-span-2">
            <Button type="button" variant="outline" onClick={onClose}>
              {t("logistics.common.cancel")}
            </Button>
            <Button type="submit" disabled={busy || !f.workerId}>
              {t("logistics.common.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
