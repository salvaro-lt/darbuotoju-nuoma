// Housing pool and fleet functions (DIG-110). Same pattern as the rest of the
// area: guard (own permission + module enabled) → checks → write → audit →
// `{ operationId }`. Spread into `defineLogistics`.
import { mutationGeneric, queryGeneric } from "convex/server"
import { v } from "convex/values"
import { recordAudit, type ConvexSystem } from "@digimuza/system-core/convex"
import { addDays, todayIso } from "../pure"
import { actorArgs, actorId, checkRange, cleanCents, cleanDate, cleanText, fail, opts, writerOf, type DbCtxLike, type WorkerId } from "../shared"
import { allocateIncoming, groupIssues, peakIn, regionOf, type GroupIssue, type HousingPerson } from "./housing"
import { fleetOverview, housingCostsByProject, housingOverview, incomingWorkers, loadHousingWorld, type FleetOverview, type HousingCostsByProject, type HousingOverview } from "./housing-data"
import { StaffingLogisticsPermissions as P } from "./manifest"
import type { LogisticsDataModel } from "./plan"
import { hasValidLicence } from "./pure"
import { costPeriodValidator, vehicleCostPeriodValidator, vehicleLogKindValidator, vehicleOwnershipValidator } from "./tables"

const writer = (ctx: DbCtxLike) => writerOf<LogisticsDataModel>(ctx)

function count(n: number, min: number, max: number, field: string, op: string) {
  if (!Number.isInteger(n) || n < min || n > max) fail("VALIDATION", `invalid_${field}`, op, [field])
  return n
}
function required(s: string, field: string, op: string) {
  const d = cleanDate(s, field, op)
  if (!d) fail("VALIDATION", `missing_${field}`, op, [field])
  return d
}
const monthArg = (m: string | undefined) => (m && /^\d{4}-\d{2}$/.test(m) ? m : undefined)

export function defineHousing(system: ConvexSystem) {
  async function poolFlatOr404(ctx: DbCtxLike, id: string, op: string) {
    const f = await writer(ctx).get("staffing_logistics_accommodations", id as never)
    if (!f) fail("NOT_FOUND", "accommodation_not_found", op)
    if (f.projectId) fail("VALIDATION", "not_pool_flat", op, ["accommodationId"])
    return f
  }

  /** Language/gender/driver issues of the people in a flat during `[from, to]`. */
  async function issuesIn(ctx: DbCtxLike, flatId: string, from: string, to: string): Promise<GroupIssue[]> {
    const w = await loadHousingWorld(ctx)
    const ids = new Set(w.stays.filter((s) => s.accommodationId === flatId && s.startDate <= to && (s.endDate === null || s.endDate >= from)).map((s) => s.workerId))
    const people = [...ids].map((id) => w.people.get(id)).filter((p): p is NonNullable<typeof p> => Boolean(p))
    return groupIssues(people, { needsDriver: w.vehicles.some((x) => x.accommodationId === flatId) })
  }

  return {
    // ---------------------------------------------------------------- reads

    /** Housing pool of a region: occupancy per flat and week, the month's money, flags, consolidation moves, incoming team. */
    housingOverview: queryGeneric({
      args: { ...actorArgs, region: v.optional(v.string()), month: v.optional(v.string()) },
      handler: async (ctx, a): Promise<HousingOverview> => {
        await system.requirePermission(ctx, P.planRead, opts(a))
        const w = await loadHousingWorld(ctx)
        return housingOverview(w, { ...(a.region ? { region: a.region } : {}), ...(monthArg(a.month) ? { month: a.month! } : {}) })
      },
    }),

    /** Vehicles of a region: the month's fixed cost, fuel, service, km and cost per km, with the log. */
    fleetOverview: queryGeneric({
      args: { ...actorArgs, region: v.optional(v.string()), month: v.optional(v.string()) },
      handler: async (ctx, a): Promise<FleetOverview> => {
        await system.requirePermission(ctx, P.planRead, opts(a))
        const w = await loadHousingWorld(ctx)
        return fleetOverview(w, { ...(a.region ? { region: a.region } : {}), ...(monthArg(a.month) ? { month: a.month! } : {}) })
      },
    }),

    /** Housing + vehicle costs per project over `[from, to]` (see `housingCostsByProject`). */
    housingCosts: queryGeneric({
      args: { ...actorArgs, from: v.string(), to: v.string() },
      handler: async (ctx, a): Promise<HousingCostsByProject> => {
        const { sys } = await system.requirePermission(ctx, P.planRead, opts(a))
        const from = required(a.from, "from", sys.operationId)
        const to = required(a.to, "to", sys.operationId)
        checkRange(from, to, sys.operationId, "to")
        if (to > addDays(from, 400)) fail("VALIDATION", "range_too_long", sys.operationId, ["to"])
        return housingCostsByProject(ctx, { from, to })
      },
    }),

    // ---------------------------------------------------------------- flats

    /** Creates or edits a pool flat (region, address, beds, rooms, monthly cost, lease, landlord). */
    saveFlat: mutationGeneric({
      args: {
        ...actorArgs,
        accommodationId: v.optional(v.id("staffing_logistics_accommodations")),
        name: v.string(),
        city: v.string(),
        region: v.optional(v.string()),
        address: v.string(),
        beds: v.number(),
        rooms: v.optional(v.number()),
        costCents: v.number(),
        costPeriod: costPeriodValidator,
        startDate: v.string(),
        endDate: v.string(),
        landlord: v.optional(v.string()),
        notes: v.optional(v.string()),
      },
      handler: async (ctx, a) => {
        const { sys, actor } = await system.requirePermission(ctx, P.planManage, opts(a))
        const op = sys.operationId
        const startDate = required(a.startDate, "startDate", op)
        const endDate = required(a.endDate, "endDate", op)
        checkRange(startDate, endDate, op)
        const city = cleanText(a.city, 120, "city", op)!
        const row = {
          name: cleanText(a.name, 120, "name", op)!,
          city,
          region: cleanText(a.region, 60, "region", op, false) ?? regionOf(city),
          address: cleanText(a.address, 300, "address", op, false) ?? "",
          beds: count(a.beds, 1, 60, "beds", op),
          ...(a.rooms !== undefined ? { rooms: count(a.rooms, 1, 30, "rooms", op) } : {}),
          costCents: cleanCents(a.costCents, "costCents", op),
          costPeriod: a.costPeriod,
          startDate,
          endDate,
          landlord: cleanText(a.landlord, 120, "landlord", op, false) ?? "",
          notes: cleanText(a.notes, 2000, "notes", op, false) ?? "",
          updatedAt: Date.now(),
        }
        const db = writer(ctx)
        let id = a.accommodationId
        if (id) {
          await poolFlatOr404(ctx, id, op)
          await db.replace("staffing_logistics_accommodations", id, row)
        } else id = await db.insert("staffing_logistics_accommodations", row)
        await recordAudit(sys, actor, { action: `staffing-logistics.flat.${a.accommodationId ? "update" : "create"}`, targetType: "staffing_logistics_accommodations", targetId: id, changes: { region: row.region, beds: row.beds, costCents: row.costCents } })
        return { id, operationId: op }
      },
    }),

    // ---------------------------------------------------------------- stays

    /**
     * Puts a worker into a pool flat for a period (or edits the stay). Refuses
     * outside the lease, when the worker already has a bed then, or when the
     * flat would be overfull on any day. Returns the group's rule issues
     * (language, gender, driver) as advice: the coordinator may still decide.
     */
    saveStay: mutationGeneric({
      args: {
        ...actorArgs,
        stayId: v.optional(v.id("staffing_logistics_stays")),
        accommodationId: v.id("staffing_logistics_accommodations"),
        workerId: v.id("staffing_workers"),
        startDate: v.string(),
        endDate: v.optional(v.string()),
        notes: v.optional(v.string()),
      },
      handler: async (ctx, a): Promise<{ id: string; issues: GroupIssue[]; operationId: string }> => {
        const { sys, actor } = await system.requirePermission(ctx, P.planManage, opts(a))
        const op = sys.operationId
        const flat = await poolFlatOr404(ctx, a.accommodationId, op)
        const db = writer(ctx)
        const worker = await db.get("staffing_workers", a.workerId)
        if (!worker) fail("NOT_FOUND", "worker_not_found", op)
        if (worker.status !== "active") fail("VALIDATION", "worker_inactive", op, ["workerId"])
        const startDate = required(a.startDate, "startDate", op)
        const endDate = cleanDate(a.endDate, "endDate", op)
        checkRange(startDate, endDate, op)
        if (startDate < flat.startDate || (endDate ?? flat.endDate) > flat.endDate || startDate > flat.endDate) fail("VALIDATION", "outside_lease", op, ["startDate"])
        if (a.stayId) {
          const cur = await db.get("staffing_logistics_stays", a.stayId)
          if (!cur) fail("NOT_FOUND", "stay_not_found", op)
        }
        const to = endDate ?? flat.endDate
        const mine = await db
          .query("staffing_logistics_stays")
          .withIndex("by_worker", (q) => q.eq("workerId", a.workerId).lte("startDate", to))
          .collect()
        if (mine.some((s) => s._id !== a.stayId && (!s.endDate || s.endDate >= startDate))) fail("CONFLICT", "worker_has_bed", op, ["workerId"])
        const others = (
          await db
            .query("staffing_logistics_stays")
            .withIndex("by_accommodation", (q) => q.eq("accommodationId", flat._id))
            .collect()
        )
          .filter((s) => s._id !== a.stayId)
          .map((s) => ({ workerId: s.workerId, accommodationId: s.accommodationId, startDate: s.startDate, endDate: s.endDate ?? null }))
        if (peakIn(flat._id, others, startDate, to, [{ workerId: a.workerId, accommodationId: flat._id, startDate, endDate: to }]) > flat.beds) fail("CONFLICT", "flat_full", op, ["accommodationId"])
        const row = { accommodationId: flat._id, workerId: a.workerId, startDate, ...(endDate ? { endDate } : {}), notes: cleanText(a.notes, 500, "notes", op, false) ?? "", createdBy: actorId(actor), updatedAt: Date.now() }
        let id = a.stayId
        if (id) await db.replace("staffing_logistics_stays", id, row)
        else id = await db.insert("staffing_logistics_stays", row)
        await recordAudit(sys, actor, { action: `staffing-logistics.stay.${a.stayId ? "update" : "create"}`, targetType: "staffing_logistics_stays", targetId: id, changes: { accommodationId: flat._id, workerId: a.workerId, startDate, endDate: endDate ?? null } })
        return { id, issues: await issuesIn(ctx, flat._id, startDate, to), operationId: op }
      },
    }),

    /** Ends a stay on `endDate` (the last night), or deletes it when it hasn't started by then. */
    endStay: mutationGeneric({
      args: { ...actorArgs, stayId: v.id("staffing_logistics_stays"), endDate: v.optional(v.string()) },
      handler: async (ctx, a) => {
        const { sys, actor } = await system.requirePermission(ctx, P.planManage, opts(a))
        const op = sys.operationId
        const db = writer(ctx)
        const cur = await db.get("staffing_logistics_stays", a.stayId)
        if (!cur) fail("NOT_FOUND", "stay_not_found", op)
        const endDate = cleanDate(a.endDate, "endDate", op) ?? todayIso()
        if (endDate < cur.startDate) await db.delete("staffing_logistics_stays", cur._id)
        else await db.patch("staffing_logistics_stays", cur._id, { endDate, updatedAt: Date.now() })
        await recordAudit(sys, actor, { action: "staffing-logistics.stay.end", targetType: "staffing_logistics_stays", targetId: cur._id, changes: { endDate } })
        return { operationId: op }
      },
    }),

    /** Applies the current consolidation suggestion for a flat: its residents move from tomorrow. */
    applyConsolidation: mutationGeneric({
      args: { ...actorArgs, sourceId: v.id("staffing_logistics_accommodations"), region: v.optional(v.string()) },
      handler: async (ctx, a) => {
        const { sys, actor } = await system.requirePermission(ctx, P.planManage, opts(a))
        const op = sys.operationId
        const flat = await poolFlatOr404(ctx, a.sourceId, op)
        const w = await loadHousingWorld(ctx)
        const region = flat.region ?? regionOf(flat.city ?? "")
        const suggestion = housingOverview(w, { region }).suggestions.find((s) => s.sourceId === a.sourceId)
        if (!suggestion) fail("CONFLICT", "suggestion_outdated", op)
        const db = writer(ctx)
        const now = Date.now()
        for (const m of suggestion.moves) {
          const rows = await db
            .query("staffing_logistics_stays")
            .withIndex("by_worker", (q) => q.eq("workerId", m.workerId as WorkerId))
            .collect()
          for (const s of rows) {
            if (s.accommodationId !== flat._id || (s.endDate && s.endDate < m.from)) continue
            if (s.startDate >= m.from) {
              await db.patch("staffing_logistics_stays", s._id, { accommodationId: m.toId as never, updatedAt: now })
              continue
            }
            await db.patch("staffing_logistics_stays", s._id, { endDate: addDays(m.from, -1), updatedAt: now })
            await db.insert("staffing_logistics_stays", { accommodationId: m.toId as never, workerId: s.workerId, startDate: m.from, ...(s.endDate ? { endDate: s.endDate } : {}), notes: `Perkelta iš ${flat.name}`, createdBy: actorId(actor), updatedAt: now })
          }
        }
        await recordAudit(sys, actor, { action: "staffing-logistics.stay.consolidate", targetType: "staffing_logistics_accommodations", targetId: flat._id, changes: { moved: suggestion.moves.length, monthlySavingCents: suggestion.monthlySavingCents } })
        return { moved: suggestion.moves.length, monthlySavingCents: suggestion.monthlySavingCents, operationId: op }
      },
    }),

    /** Beds for the incoming team of a region (confirmed/active assignments without a bed), filling paid beds first. */
    autoAllocateHousing: mutationGeneric({
      args: { ...actorArgs, region: v.string() },
      handler: async (ctx, a) => {
        const { sys, actor } = await system.requirePermission(ctx, P.planManage, opts(a))
        const op = sys.operationId
        const w = await loadHousingWorld(ctx)
        const incoming = incomingWorkers(w, a.region)
        const people: HousingPerson[] = [...w.people.values()]
        const result = allocateIncoming({ flats: w.flats.filter((f) => f.endDate >= w.today), stays: w.stays, people, incoming })
        const db = writer(ctx)
        const now = Date.now()
        for (const p of result.placed)
          await db.insert("staffing_logistics_stays", { accommodationId: p.accommodationId as never, workerId: p.workerId as WorkerId, startDate: p.startDate, ...(p.endDate ? { endDate: p.endDate } : {}), notes: "Automatinis paskirstymas", createdBy: actorId(actor), updatedAt: now })
        await recordAudit(sys, actor, { action: "staffing-logistics.stay.auto", targetType: "staffing_logistics_accommodations", targetId: a.region, changes: { placed: result.placed.length, unplaced: result.unplaced.length } })
        const name = (id: string) => w.people.get(id)?.name ?? "?"
        const flatName = new Map(w.flats.map((f) => [f.id, f.name]))
        return {
          placed: result.placed.map((p) => ({ ...p, name: name(p.workerId), flatName: flatName.get(p.accommodationId) ?? "?" })),
          unplaced: result.unplaced.map((u) => ({ ...u, name: name(u.workerId) })),
          operationId: op,
        }
      },
    }),

    // ---------------------------------------------------------------- fleet

    /** Creates or edits a fleet vehicle (own or rented) of a region, optionally parked at a pool flat. */
    saveFleetVehicle: mutationGeneric({
      args: {
        ...actorArgs,
        vehicleId: v.optional(v.id("staffing_logistics_vehicles")),
        plate: v.string(),
        model: v.optional(v.string()),
        seats: v.number(),
        ownership: vehicleOwnershipValidator,
        costCents: v.number(),
        costPeriod: vehicleCostPeriodValidator,
        startDate: v.string(),
        endDate: v.string(),
        region: v.string(),
        accommodationId: v.optional(v.union(v.id("staffing_logistics_accommodations"), v.null())),
        notes: v.optional(v.string()),
      },
      handler: async (ctx, a) => {
        const { sys, actor } = await system.requirePermission(ctx, P.planManage, opts(a))
        const op = sys.operationId
        const startDate = required(a.startDate, "startDate", op)
        const endDate = required(a.endDate, "endDate", op)
        checkRange(startDate, endDate, op)
        if (a.accommodationId) await poolFlatOr404(ctx, a.accommodationId, op)
        const db = writer(ctx)
        const row = {
          plate: cleanText(a.plate, 20, "plate", op)!.toUpperCase(),
          model: cleanText(a.model, 120, "model", op, false) ?? "",
          seats: count(a.seats, 1, 60, "seats", op),
          ownership: a.ownership,
          costCents: cleanCents(a.costCents, "costCents", op),
          costPeriod: a.costPeriod,
          startDate,
          endDate,
          region: cleanText(a.region, 60, "region", op)!,
          ...(a.accommodationId ? { accommodationId: a.accommodationId } : {}),
          notes: cleanText(a.notes, 2000, "notes", op, false) ?? "",
          updatedAt: Date.now(),
        }
        let id = a.vehicleId
        if (id) {
          const cur = await db.get("staffing_logistics_vehicles", id)
          if (!cur || cur.projectId) fail("NOT_FOUND", "vehicle_not_found", op)
          await db.replace("staffing_logistics_vehicles", id, row)
        } else id = await db.insert("staffing_logistics_vehicles", row)
        await recordAudit(sys, actor, { action: `staffing-logistics.vehicle.${a.vehicleId ? "update" : "create"}`, targetType: "staffing_logistics_vehicles", targetId: id, changes: { plate: row.plate, region: row.region, accommodationId: a.accommodationId ?? null } })
        return { id, operationId: op }
      },
    }),

    /** A fuel, trip or service entry: km driven, litres, money, driver (with a valid licence). */
    addVehicleLog: mutationGeneric({
      args: {
        ...actorArgs,
        vehicleId: v.id("staffing_logistics_vehicles"),
        date: v.string(),
        kind: vehicleLogKindValidator,
        km: v.number(),
        litres: v.number(),
        costCents: v.number(),
        driverId: v.optional(v.id("staffing_workers")),
        notes: v.optional(v.string()),
      },
      handler: async (ctx, a) => {
        const { sys, actor } = await system.requirePermission(ctx, P.planManage, opts(a))
        const op = sys.operationId
        const db = writer(ctx)
        const veh = await db.get("staffing_logistics_vehicles", a.vehicleId)
        if (!veh) fail("NOT_FOUND", "vehicle_not_found", op)
        const date = required(a.date, "date", op)
        const km = count(a.km, 0, 10_000, "km", op)
        if (!Number.isFinite(a.litres) || a.litres < 0 || a.litres > 1000) fail("VALIDATION", "invalid_litres", op, ["litres"])
        if (a.driverId) {
          const d = await db.get("staffing_workers", a.driverId)
          if (!d) fail("NOT_FOUND", "worker_not_found", op)
          if (!hasValidLicence({ licenceCategories: d.driverLicenseCategories, licenceExpiresAt: d.driverLicenseExpiresAt ?? null }, date)) fail("VALIDATION", "driver_not_eligible", op, ["driverId"])
        }
        const id = await db.insert("staffing_logistics_vehicleLogs", {
          vehicleId: veh._id,
          date,
          kind: a.kind,
          km,
          litres: Math.round(a.litres * 10) / 10,
          costCents: cleanCents(a.costCents, "costCents", op),
          ...(a.driverId ? { driverId: a.driverId } : {}),
          notes: cleanText(a.notes, 500, "notes", op, false) ?? "",
          createdBy: actorId(actor),
        })
        await recordAudit(sys, actor, { action: "staffing-logistics.vehicle_log.create", targetType: "staffing_logistics_vehicleLogs", targetId: id, changes: { vehicleId: veh._id, km, costCents: a.costCents } })
        return { id, operationId: op }
      },
    }),

    deleteVehicleLog: mutationGeneric({
      args: { ...actorArgs, logId: v.id("staffing_logistics_vehicleLogs") },
      handler: async (ctx, a) => {
        const { sys, actor } = await system.requirePermission(ctx, P.planManage, opts(a))
        const op = sys.operationId
        const db = writer(ctx)
        const cur = await db.get("staffing_logistics_vehicleLogs", a.logId)
        if (!cur) fail("NOT_FOUND", "vehicle_log_not_found", op)
        await db.delete("staffing_logistics_vehicleLogs", cur._id)
        await recordAudit(sys, actor, { action: "staffing-logistics.vehicle_log.delete", targetType: "staffing_logistics_vehicleLogs", targetId: cur._id, changes: { date: cur.date } })
        return { operationId: op }
      },
    }),
  }
}
