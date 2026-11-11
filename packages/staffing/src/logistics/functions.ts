// Logistics area functions. Each one: guard (own permission + module enabled)
// → object checks → write → audit → `{ operationId }`. Reads the staffing base
// (projects, assignments, workers) without writing it. Re-export them from the
// app's `convex/logistics.ts`.
import { internalActionGeneric, internalMutationGeneric, makeFunctionReference, mutationGeneric, queryGeneric, type Scheduler } from "convex/server"
import { v } from "convex/values"
import { recordAudit, type ConvexSystem } from "@digimuza/system-core/convex"
import { isBlockingAssignment, OPEN_PROJECT_STATUSES, todayIso } from "../pure"
import { actorArgs, actorId, checkRange, cleanCents, cleanDate, cleanText, fail, opts, writerOf, type DbCtxLike, type ProjectId, type WorkerId } from "../shared"
import { StaffingLogisticsPermissions as P } from "./manifest"
import { alertLines, coordinatorEmail, firstSuperUser, loadPlan, logisticsReader, type LogisticsDataModel, type LogisticsPlan } from "./plan"
import { autoAssignBeds, autoAssignSeats, hasValidLicence, planSnapshot } from "./pure"
import { costPeriodValidator, travelDirectionValidator, travelModeValidator, vehicleCostPeriodValidator, vehicleOwnershipValidator } from "./tables"
import { defineHousing } from "./housing-functions"
import { defineHousingSeed } from "./housing-seed"
import { defineLogisticsSeed } from "./seed"

export interface LogisticsOptions {
  /** File of the app's Convex functions (`convex/logistics.ts` → "logistics"); internal functions are scheduled by this path. */
  functionsPath?: string
  /** n8n webhook path for coordinator notifications (body `{ title, lines[], appUrl }`). Without it, nothing is sent. */
  notifyWebhook?: string
}

export interface ProjectLogisticsSummary {
  projectId: ProjectId
  code: string
  name: string
  city: string
  country: string
  clientName: string
  status: LogisticsPlan["project"]["status"]
  startDate: string
  endDate: string | null
  peopleToday: number
  bedsToday: number
  vehicles: number
  errors: number
  warnings: number
  changed: boolean
}

const MAX_NAME = 120
const MAX_NOTES = 2000
const writer = (ctx: DbCtxLike) => writerOf<LogisticsDataModel>(ctx)

function cleanCount(n: number, max: number, field: string, op: string) {
  if (!Number.isInteger(n) || n < 1 || n > max) fail("VALIDATION", `invalid_${field}`, op, [field])
  return n
}
function requiredDate(s: string, field: string, op: string) {
  const d = cleanDate(s, field, op)
  if (!d) fail("VALIDATION", `missing_${field}`, op, [field])
  return d
}

export function defineLogistics(system: ConvexSystem, options: LogisticsOptions = {}) {
  const path = options.functionsPath ?? "logistics"
  const deliverRef = makeFunctionReference<"action">(`${path}:_deliver`)

  async function projectOr404(ctx: DbCtxLike, projectId: ProjectId, op: string) {
    const p = await logisticsReader(ctx).get("staffing_projects", projectId)
    if (!p) fail("NOT_FOUND", "project_not_found", op)
    return p
  }

  /** The worker has a confirmed/active assignment on the project. */
  async function memberOr422(ctx: DbCtxLike, projectId: ProjectId, workerId: WorkerId, op: string) {
    const rows = await logisticsReader(ctx)
      .query("staffing_assignments")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect()
    const mine = rows.filter((a) => a.workerId === workerId && isBlockingAssignment(a))
    if (mine.length === 0) fail("VALIDATION", "worker_not_on_project", op, ["workerId"])
    return mine
  }

  async function settingsOf(ctx: DbCtxLike, projectId: ProjectId) {
    return logisticsReader(ctx)
      .query("staffing_logistics_settings")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .first()
  }

  /** Inserts a pending notification and schedules its delivery. */
  async function queueNotification(ctx: DbCtxLike & { scheduler: Scheduler }, plan: LogisticsPlan, trigger: "manual" | "daily", createdBy: string) {
    const project = (await logisticsReader(ctx).get("staffing_projects", plan.project.id))!
    const to = (await coordinatorEmail(ctx, project)) ?? ""
    const lines = alertLines(plan)
    const title = `${plan.project.code}: logistikos įspėjimai (${lines.length})`
    const body = lines.length ? lines : ["Įspėjimų nėra: lovų, vietų, vairuotojų ir bilietų užtenka."]
    const id = await writer(ctx).insert("staffing_logistics_notifications", { projectId: plan.project.id, trigger, to, title, lines: body, status: "pending", createdBy })
    const site = process.env.SITE_URL
    await ctx.scheduler.runAfter(0, deliverRef, { notificationId: id, to, title, lines: body, ...(site ? { appUrl: `${site.replace(/\/$/, "")}/app/logistics/${plan.project.id}` } : {}) })
    return { id, lines: lines.length }
  }

  return {
    // ---------------------------------------------------------------- reads

    /** Open projects with today's headcount, beds and warning counts. */
    listProjects: queryGeneric({
      args: { ...actorArgs },
      handler: async (ctx, a): Promise<ProjectLogisticsSummary[]> => {
        await system.requirePermission(ctx, P.planRead, opts(a))
        const db = logisticsReader(ctx)
        const out: ProjectLogisticsSummary[] = []
        for (const status of OPEN_PROJECT_STATUSES) {
          const projects = await db
            .query("staffing_projects")
            .withIndex("by_status", (q) => q.eq("status", status))
            .take(200)
          for (const p of projects) {
            const plan = await loadPlan(ctx, p._id, { from: todayIso(), days: 28 })
            if (!plan) continue
            const today = plan.plan.days[0]
            out.push({
              projectId: p._id,
              code: p.code,
              name: p.name,
              city: p.city,
              country: p.country,
              clientName: plan.project.clientName,
              status: p.status,
              startDate: p.startDate,
              endDate: p.endDate ?? null,
              peopleToday: today?.people ?? 0,
              bedsToday: today?.beds ?? 0,
              vehicles: plan.vehicles.length,
              errors: plan.plan.warnings.filter((w) => w.severity === "error").length,
              warnings: plan.plan.warnings.filter((w) => w.severity === "warning").length,
              changed: Boolean(plan.diff && plan.diff.added.length + plan.diff.removed.length + plan.diff.changed.length > 0),
            })
          }
        }
        return out.sort((a, b) => (a.status === b.status ? a.startDate.localeCompare(b.startDate) : a.status === "active" ? -1 : 1))
      },
    }),

    /** The full plan of a project for a window (default: a week ago + 6 weeks). Null when the project doesn't exist. */
    getPlan: queryGeneric({
      args: { ...actorArgs, projectId: v.id("staffing_projects"), from: v.optional(v.string()), days: v.optional(v.number()) },
      handler: async (ctx, a): Promise<LogisticsPlan | null> => {
        const { sys } = await system.requirePermission(ctx, P.planRead, opts(a))
        const from = cleanDate(a.from, "from", sys.operationId)
        return loadPlan(ctx, a.projectId, { ...(from ? { from } : {}), ...(a.days ? { days: a.days } : {}) })
      },
    }),

    // ---------------------------------------------------------------- accommodation

    saveAccommodation: mutationGeneric({
      args: {
        ...actorArgs,
        projectId: v.id("staffing_projects"),
        accommodationId: v.optional(v.id("staffing_logistics_accommodations")),
        name: v.string(),
        address: v.string(),
        beds: v.number(),
        costCents: v.number(),
        costPeriod: costPeriodValidator,
        startDate: v.string(),
        endDate: v.string(),
        notes: v.optional(v.string()),
      },
      handler: async (ctx, a) => {
        const { sys, actor } = await system.requirePermission(ctx, P.planManage, opts(a))
        const op = sys.operationId
        await projectOr404(ctx, a.projectId, op)
        const startDate = requiredDate(a.startDate, "startDate", op)
        const endDate = requiredDate(a.endDate, "endDate", op)
        checkRange(startDate, endDate, op)
        const row = {
          projectId: a.projectId,
          name: cleanText(a.name, MAX_NAME, "name", op)!,
          address: cleanText(a.address, 300, "address", op, false) ?? "",
          beds: cleanCount(a.beds, 200, "beds", op),
          costCents: cleanCents(a.costCents, "costCents", op),
          costPeriod: a.costPeriod,
          startDate,
          endDate,
          notes: cleanText(a.notes, MAX_NOTES, "notes", op, false) ?? "",
          updatedAt: Date.now(),
        }
        const db = writer(ctx)
        let id = a.accommodationId
        if (id) {
          const cur = await db.get("staffing_logistics_accommodations", id)
          if (!cur || cur.projectId !== a.projectId) fail("NOT_FOUND", "accommodation_not_found", op)
          await db.replace("staffing_logistics_accommodations", id, row)
        } else id = await db.insert("staffing_logistics_accommodations", row)
        await recordAudit(sys, actor, { action: `staffing-logistics.accommodation.${a.accommodationId ? "update" : "create"}`, targetType: "staffing_logistics_accommodations", targetId: id, changes: { beds: row.beds, startDate, endDate } })
        return { id, operationId: op }
      },
    }),

    deleteAccommodation: mutationGeneric({
      args: { ...actorArgs, accommodationId: v.id("staffing_logistics_accommodations") },
      handler: async (ctx, a) => {
        const { sys, actor } = await system.requirePermission(ctx, P.planManage, opts(a))
        const op = sys.operationId
        const db = writer(ctx)
        const cur = await db.get("staffing_logistics_accommodations", a.accommodationId)
        if (!cur) fail("NOT_FOUND", "accommodation_not_found", op)
        for (const al of await db
          .query("staffing_logistics_allocations")
          .withIndex("by_accommodation", (q) => q.eq("accommodationId", cur._id))
          .collect())
          await db.patch("staffing_logistics_allocations", al._id, { accommodationId: undefined, updatedAt: Date.now() })
        for (const s of await db
          .query("staffing_logistics_stays")
          .withIndex("by_accommodation", (q) => q.eq("accommodationId", cur._id))
          .collect())
          await db.delete("staffing_logistics_stays", s._id)
        for (const veh of await db
          .query("staffing_logistics_vehicles")
          .withIndex("by_accommodation", (q) => q.eq("accommodationId", cur._id))
          .collect())
          await db.patch("staffing_logistics_vehicles", veh._id, { accommodationId: undefined, updatedAt: Date.now() })
        await db.delete("staffing_logistics_accommodations", cur._id)
        await recordAudit(sys, actor, { action: "staffing-logistics.accommodation.delete", targetType: "staffing_logistics_accommodations", targetId: cur._id, changes: { name: cur.name } })
        return { operationId: op }
      },
    }),

    // ---------------------------------------------------------------- vehicles

    saveVehicle: mutationGeneric({
      args: {
        ...actorArgs,
        projectId: v.id("staffing_projects"),
        vehicleId: v.optional(v.id("staffing_logistics_vehicles")),
        plate: v.string(),
        model: v.optional(v.string()),
        seats: v.number(),
        ownership: vehicleOwnershipValidator,
        costCents: v.number(),
        costPeriod: vehicleCostPeriodValidator,
        startDate: v.string(),
        endDate: v.string(),
        notes: v.optional(v.string()),
      },
      handler: async (ctx, a) => {
        const { sys, actor } = await system.requirePermission(ctx, P.planManage, opts(a))
        const op = sys.operationId
        await projectOr404(ctx, a.projectId, op)
        const startDate = requiredDate(a.startDate, "startDate", op)
        const endDate = requiredDate(a.endDate, "endDate", op)
        checkRange(startDate, endDate, op)
        const row = {
          projectId: a.projectId,
          plate: cleanText(a.plate, 20, "plate", op)!.toUpperCase(),
          model: cleanText(a.model, MAX_NAME, "model", op, false) ?? "",
          seats: cleanCount(a.seats, 60, "seats", op),
          ownership: a.ownership,
          costCents: cleanCents(a.costCents, "costCents", op),
          costPeriod: a.costPeriod,
          startDate,
          endDate,
          notes: cleanText(a.notes, MAX_NOTES, "notes", op, false) ?? "",
          updatedAt: Date.now(),
        }
        const db = writer(ctx)
        let id = a.vehicleId
        if (id) {
          const cur = await db.get("staffing_logistics_vehicles", id)
          if (!cur || cur.projectId !== a.projectId) fail("NOT_FOUND", "vehicle_not_found", op)
          await db.replace("staffing_logistics_vehicles", id, row)
        } else id = await db.insert("staffing_logistics_vehicles", row)
        await recordAudit(sys, actor, { action: `staffing-logistics.vehicle.${a.vehicleId ? "update" : "create"}`, targetType: "staffing_logistics_vehicles", targetId: id, changes: { plate: row.plate, seats: row.seats } })
        return { id, operationId: op }
      },
    }),

    deleteVehicle: mutationGeneric({
      args: { ...actorArgs, vehicleId: v.id("staffing_logistics_vehicles") },
      handler: async (ctx, a) => {
        const { sys, actor } = await system.requirePermission(ctx, P.planManage, opts(a))
        const op = sys.operationId
        const db = writer(ctx)
        const cur = await db.get("staffing_logistics_vehicles", a.vehicleId)
        if (!cur) fail("NOT_FOUND", "vehicle_not_found", op)
        for (const al of await db
          .query("staffing_logistics_allocations")
          .withIndex("by_vehicle", (q) => q.eq("vehicleId", cur._id))
          .collect())
          await db.patch("staffing_logistics_allocations", al._id, { vehicleId: undefined, driver: false, updatedAt: Date.now() })
        for (const l of await db
          .query("staffing_logistics_vehicleLogs")
          .withIndex("by_vehicle", (q) => q.eq("vehicleId", cur._id))
          .collect())
          await db.delete("staffing_logistics_vehicleLogs", l._id)
        await db.delete("staffing_logistics_vehicles", cur._id)
        await recordAudit(sys, actor, { action: "staffing-logistics.vehicle.delete", targetType: "staffing_logistics_vehicles", targetId: cur._id, changes: { plate: cur.plate } })
        return { operationId: op }
      },
    }),

    // ---------------------------------------------------------------- travel

    saveTravelLeg: mutationGeneric({
      args: {
        ...actorArgs,
        projectId: v.id("staffing_projects"),
        legId: v.optional(v.id("staffing_logistics_travelLegs")),
        workerId: v.id("staffing_workers"),
        direction: travelDirectionValidator,
        fromCity: v.string(),
        toCity: v.string(),
        date: v.string(),
        mode: travelModeValidator,
        ticketCostCents: v.number(),
        booked: v.boolean(),
        bookingRef: v.optional(v.string()),
        notes: v.optional(v.string()),
      },
      handler: async (ctx, a) => {
        const { sys, actor } = await system.requirePermission(ctx, P.planManage, opts(a))
        const op = sys.operationId
        await projectOr404(ctx, a.projectId, op)
        await memberOr422(ctx, a.projectId, a.workerId, op)
        const bookingRef = cleanText(a.bookingRef, 60, "bookingRef", op, false)
        const row = {
          projectId: a.projectId,
          workerId: a.workerId,
          direction: a.direction,
          fromCity: cleanText(a.fromCity, MAX_NAME, "fromCity", op)!,
          toCity: cleanText(a.toCity, MAX_NAME, "toCity", op)!,
          date: requiredDate(a.date, "date", op),
          mode: a.mode,
          ticketCostCents: cleanCents(a.ticketCostCents, "ticketCostCents", op),
          booked: a.booked,
          ...(bookingRef ? { bookingRef } : {}),
          notes: cleanText(a.notes, MAX_NOTES, "notes", op, false) ?? "",
          updatedAt: Date.now(),
        }
        const db = writer(ctx)
        let id = a.legId
        if (id) {
          const cur = await db.get("staffing_logistics_travelLegs", id)
          if (!cur || cur.projectId !== a.projectId) fail("NOT_FOUND", "travel_leg_not_found", op)
          await db.replace("staffing_logistics_travelLegs", id, row)
        } else id = await db.insert("staffing_logistics_travelLegs", row)
        await recordAudit(sys, actor, { action: `staffing-logistics.travel_leg.${a.legId ? "update" : "create"}`, targetType: "staffing_logistics_travelLegs", targetId: id, changes: { date: row.date, booked: row.booked } })
        return { id, operationId: op }
      },
    }),

    setTravelLegBooked: mutationGeneric({
      args: { ...actorArgs, legId: v.id("staffing_logistics_travelLegs"), booked: v.boolean() },
      handler: async (ctx, a) => {
        const { sys, actor } = await system.requirePermission(ctx, P.planManage, opts(a))
        const op = sys.operationId
        const db = writer(ctx)
        const cur = await db.get("staffing_logistics_travelLegs", a.legId)
        if (!cur) fail("NOT_FOUND", "travel_leg_not_found", op)
        await db.patch("staffing_logistics_travelLegs", cur._id, { booked: a.booked, updatedAt: Date.now() })
        await recordAudit(sys, actor, { action: "staffing-logistics.travel_leg.update", targetType: "staffing_logistics_travelLegs", targetId: cur._id, changes: { booked: a.booked } })
        return { operationId: op }
      },
    }),

    deleteTravelLeg: mutationGeneric({
      args: { ...actorArgs, legId: v.id("staffing_logistics_travelLegs") },
      handler: async (ctx, a) => {
        const { sys, actor } = await system.requirePermission(ctx, P.planManage, opts(a))
        const op = sys.operationId
        const db = writer(ctx)
        const cur = await db.get("staffing_logistics_travelLegs", a.legId)
        if (!cur) fail("NOT_FOUND", "travel_leg_not_found", op)
        await db.delete("staffing_logistics_travelLegs", cur._id)
        await recordAudit(sys, actor, { action: "staffing-logistics.travel_leg.delete", targetType: "staffing_logistics_travelLegs", targetId: cur._id, changes: { date: cur.date } })
        return { operationId: op }
      },
    }),

    // ---------------------------------------------------------------- allocations

    /** Bed and seat of a worker. `null` clears; omitted keeps. A driver must be marked as driver on the assignment and hold a valid licence. */
    setAllocation: mutationGeneric({
      args: {
        ...actorArgs,
        projectId: v.id("staffing_projects"),
        workerId: v.id("staffing_workers"),
        accommodationId: v.optional(v.union(v.id("staffing_logistics_accommodations"), v.null())),
        vehicleId: v.optional(v.union(v.id("staffing_logistics_vehicles"), v.null())),
        driver: v.optional(v.boolean()),
      },
      handler: async (ctx, a) => {
        const { sys, actor } = await system.requirePermission(ctx, P.planManage, opts(a))
        const op = sys.operationId
        await projectOr404(ctx, a.projectId, op)
        const assignments = await memberOr422(ctx, a.projectId, a.workerId, op)
        const db = writer(ctx)
        if (a.accommodationId) {
          const acc = await db.get("staffing_logistics_accommodations", a.accommodationId)
          if (!acc || acc.projectId !== a.projectId) fail("NOT_FOUND", "accommodation_not_found", op)
        }
        if (a.vehicleId) {
          const veh = await db.get("staffing_logistics_vehicles", a.vehicleId)
          if (!veh || veh.projectId !== a.projectId) fail("NOT_FOUND", "vehicle_not_found", op)
        }
        const cur = await db
          .query("staffing_logistics_allocations")
          .withIndex("by_project", (q) => q.eq("projectId", a.projectId).eq("workerId", a.workerId))
          .first()
        const accommodationId = a.accommodationId === undefined ? cur?.accommodationId : (a.accommodationId ?? undefined)
        const vehicleId = a.vehicleId === undefined ? cur?.vehicleId : (a.vehicleId ?? undefined)
        const driver = Boolean(vehicleId) && (a.driver ?? cur?.driver ?? false)
        if (driver && !(cur?.driver && a.driver === undefined)) {
          const worker = await db.get("staffing_workers", a.workerId)
          const today = todayIso()
          const eligible = assignments.some((x) => x.isDriver) && worker && hasValidLicence({ licenceCategories: worker.driverLicenseCategories, licenceExpiresAt: worker.driverLicenseExpiresAt ?? null }, today)
          if (!eligible) fail("VALIDATION", "driver_not_eligible", op, ["driver"])
        }
        const row = { projectId: a.projectId, workerId: a.workerId, accommodationId, vehicleId, driver, updatedAt: Date.now() }
        if (cur) await db.replace("staffing_logistics_allocations", cur._id, row)
        else await db.insert("staffing_logistics_allocations", row)
        await recordAudit(sys, actor, { action: "staffing-logistics.allocation.set", targetType: "staffing_workers", targetId: a.workerId, changes: { projectId: a.projectId, accommodationId: accommodationId ?? null, vehicleId: vehicleId ?? null, driver } })
        return { operationId: op }
      },
    }),

    /** Fills free beds (`beds`) or seats with drivers first (`seats`) for workers without one. */
    autoAssign: mutationGeneric({
      args: { ...actorArgs, projectId: v.id("staffing_projects"), kind: v.union(v.literal("beds"), v.literal("seats")) },
      handler: async (ctx, a) => {
        const { sys, actor } = await system.requirePermission(ctx, P.planManage, opts(a))
        const op = sys.operationId
        await projectOr404(ctx, a.projectId, op)
        const today = todayIso()
        const plan = (await loadPlan(ctx, a.projectId, { from: today, days: 92, today }))!
        // Members with a bed in the housing pool keep it: they don't get a project bed.
        const pooled = new Map(plan.poolStays.map((s) => [s.workerId, `pool:${s.accommodationId}`]))
        const allocations = plan.members.map((m) => ({ workerId: m.workerId, accommodationId: m.accommodationId ?? pooled.get(m.workerId) ?? null, vehicleId: m.vehicleId, driver: m.driver }))
        const input = { today, horizonEnd: plan.window.to, members: plan.members, allocations }
        const db = writer(ctx)
        const upsert = async (workerId: string, patch: { accommodationId?: string; vehicleId?: string; driver?: boolean }) => {
          const cur = await db
            .query("staffing_logistics_allocations")
            .withIndex("by_project", (q) => q.eq("projectId", a.projectId).eq("workerId", workerId as WorkerId))
            .first()
          if (cur) await db.patch("staffing_logistics_allocations", cur._id, { ...(patch as object), updatedAt: Date.now() })
          else await db.insert("staffing_logistics_allocations", { projectId: a.projectId, workerId: workerId as WorkerId, driver: false, ...(patch as object), updatedAt: Date.now() })
        }
        let assigned = 0
        if (a.kind === "beds") {
          for (const [workerId, accommodationId] of autoAssignBeds({ ...input, accommodations: plan.accommodations })) {
            await upsert(workerId, { accommodationId })
            assigned++
          }
        } else {
          for (const [workerId, s] of autoAssignSeats({ ...input, vehicles: plan.vehicles })) {
            await upsert(workerId, { vehicleId: s.vehicleId, driver: s.driver })
            assigned++
          }
        }
        await recordAudit(sys, actor, { action: "staffing-logistics.allocation.auto", targetType: "staffing_projects", targetId: a.projectId, changes: { kind: a.kind, assigned } })
        return { assigned, operationId: op }
      },
    }),

    // ---------------------------------------------------------------- plan changes and notifications

    /** Marks the current team as seen: "Planas pasikeitė" clears until the team changes again. */
    acknowledgePlan: mutationGeneric({
      args: { ...actorArgs, projectId: v.id("staffing_projects") },
      handler: async (ctx, a) => {
        const { sys, actor } = await system.requirePermission(ctx, P.planManage, opts(a))
        const op = sys.operationId
        await projectOr404(ctx, a.projectId, op)
        const plan = (await loadPlan(ctx, a.projectId))!
        const snap = planSnapshot(plan.members)
        const cur = await settingsOf(ctx, a.projectId)
        const db = writer(ctx)
        const patch = { ackSnapshot: snap, ackAt: Date.now(), ackBy: actorId(actor), updatedAt: Date.now() }
        if (cur) await db.patch("staffing_logistics_settings", cur._id, patch)
        else await db.insert("staffing_logistics_settings", { projectId: a.projectId, dailyDigest: false, ...patch })
        await recordAudit(sys, actor, { action: "staffing-logistics.plan.acknowledge", targetType: "staffing_projects", targetId: a.projectId, changes: { people: snap.length } })
        return { operationId: op }
      },
    }),

    setDailyDigest: mutationGeneric({
      args: { ...actorArgs, projectId: v.id("staffing_projects"), enabled: v.boolean() },
      handler: async (ctx, a) => {
        const { sys, actor } = await system.requirePermission(ctx, P.planManage, opts(a))
        const op = sys.operationId
        await projectOr404(ctx, a.projectId, op)
        const cur = await settingsOf(ctx, a.projectId)
        const db = writer(ctx)
        if (cur) await db.patch("staffing_logistics_settings", cur._id, { dailyDigest: a.enabled, updatedAt: Date.now() })
        else await db.insert("staffing_logistics_settings", { projectId: a.projectId, dailyDigest: a.enabled, updatedAt: Date.now() })
        await recordAudit(sys, actor, { action: "staffing-logistics.digest.set", targetType: "staffing_projects", targetId: a.projectId, changes: { enabled: a.enabled } })
        return { operationId: op }
      },
    }),

    /** Sends the current warnings to the project's coordinator (n8n webhook). Delivery runs in the background. */
    notifyCoordinator: mutationGeneric({
      args: { ...actorArgs, projectId: v.id("staffing_projects") },
      handler: async (ctx, a) => {
        const { sys, actor } = await system.requirePermission(ctx, P.planManage, opts(a))
        const op = sys.operationId
        await projectOr404(ctx, a.projectId, op)
        const plan = (await loadPlan(ctx, a.projectId, { from: todayIso(), days: 28 }))!
        const { id, lines } = await queueNotification(ctx, plan, "manual", actorId(actor))
        await recordAudit(sys, actor, { action: "staffing-logistics.notification.send", targetType: "staffing_logistics_notifications", targetId: id, changes: { lines } })
        return { notificationId: id, lines, operationId: op }
      },
    }),

    // ---------------------------------------------------------------- internal

    /** Daily cron: warnings of every open project with the digest switched on. */
    _dailyDigest: internalMutationGeneric({
      args: {},
      handler: async (ctx): Promise<{ projects: number; queued: number }> => {
        const db = logisticsReader(ctx)
        const on = await db
          .query("staffing_logistics_settings")
          .withIndex("by_digest", (q) => q.eq("dailyDigest", true))
          .collect()
        let queued = 0
        for (const s of on) {
          const plan = await loadPlan(ctx, s.projectId, { from: todayIso(), days: 28 })
          if (!plan || !OPEN_PROJECT_STATUSES.includes(plan.project.status) || alertLines(plan).length === 0) continue
          await queueNotification(ctx, plan, "daily", "cron")
          queued++
        }
        return { projects: on.length, queued }
      },
    }),

    /** POSTs a notification to the n8n webhook; without N8N_URL / N8N_WEBHOOK_SECRET / a webhook it records `not_configured`. */
    _deliver: internalActionGeneric({
      args: { notificationId: v.id("staffing_logistics_notifications"), to: v.string(), title: v.string(), lines: v.array(v.string()), appUrl: v.optional(v.string()) },
      handler: async (ctx, a) => {
        const markRef = makeFunctionReference<"mutation">(`${path}:_markNotification`)
        const url = process.env.N8N_URL
        const secret = process.env.N8N_WEBHOOK_SECRET
        if (!url || !secret || !options.notifyWebhook) {
          await ctx.runMutation(markRef, { notificationId: a.notificationId, status: "not_configured" })
          return { status: "not_configured" as const }
        }
        const redirectTo = process.env.APP_ENV !== "production" ? firstSuperUser() : null
        const to = a.to || firstSuperUser() || ""
        try {
          const res = await fetch(`${url.replace(/\/$/, "")}/webhook/${options.notifyWebhook}`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Webhook-Secret": secret },
            body: JSON.stringify({ to, ...(redirectTo ? { redirectTo } : {}), language: "lt", title: a.title, lines: a.lines, ...(a.appUrl ? { appUrl: a.appUrl } : {}) }),
          })
          // Status only: the body may echo recipients.
          const status = res.ok ? ("sent" as const) : ("failed" as const)
          await ctx.runMutation(markRef, { notificationId: a.notificationId, status, ...(res.ok ? {} : { error: `HTTP ${res.status}` }) })
          return { status }
        } catch (e) {
          await ctx.runMutation(markRef, { notificationId: a.notificationId, status: "failed", error: e instanceof Error ? e.message.slice(0, 200) : "fetch failed" })
          return { status: "failed" as const }
        }
      },
    }),

    _markNotification: internalMutationGeneric({
      args: { notificationId: v.id("staffing_logistics_notifications"), status: v.union(v.literal("sent"), v.literal("not_configured"), v.literal("failed")), error: v.optional(v.string()) },
      handler: async (ctx, a) => {
        await writer(ctx).patch("staffing_logistics_notifications", a.notificationId, { status: a.status, ...(a.error ? { error: a.error } : {}), ...(a.status === "sent" ? { sentAt: Date.now() } : {}) })
      },
    }),

    ...defineLogisticsSeed(),
    ...defineHousing(system),
    ...defineHousingSeed(),
  }
}

export type LogisticsFunctions = ReturnType<typeof defineLogistics>
