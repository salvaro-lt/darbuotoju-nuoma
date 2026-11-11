// Loads a project's logistics data and computes its plan. No permission checks:
// the calling function guards first.
import { loadCatalog } from "../operations"
import { addDays, fullName, isBlockingAssignment, todayIso } from "../pure"
import { readerOf, type DataModelOf, type DbCtxLike, type ProjectDoc, type ProjectId, type WorkerDoc, type WorkerId } from "../shared"
import type { staffingTables } from "../tables"
import {
  computePlan,
  diffSnapshots,
  hasValidLicence,
  packingList,
  planSnapshot,
  warningLine,
  type PackingList,
  type Plan,
  type PlanAccommodation,
  type PlanAllocation,
  type PlanDiff,
  type PlanMember,
  type PlanTravelLeg,
  type PlanVehicle,
  type Severity,
  type TravelDirection,
  type TravelMode,
  type VehicleOwnership,
} from "./pure"
import type { logisticsTables } from "./tables"

export type LogisticsDataModel = DataModelOf<typeof staffingTables & typeof logisticsTables>
export const logisticsReader = (ctx: DbCtxLike) => readerOf<LogisticsDataModel>(ctx)

export const DEFAULT_WINDOW_DAYS = 42

export interface MemberRow extends PlanMember {
  assignmentId: string
  status: "confirmed" | "active"
  tradeName: string
  tradeNameEn: string
  /** Licence valid on the later of today and the start. */
  licenceOk: boolean
  accommodationId: string | null
  vehicleId: string | null
  driver: boolean
}
export interface AccommodationRow extends PlanAccommodation {
  address: string
  notes: string
}
export interface VehicleRow extends PlanVehicle {
  model: string
  ownership: VehicleOwnership
  notes: string
}
export interface TravelLegRow extends PlanTravelLeg {
  workerName: string
  fromCity: string
  toCity: string
  mode: TravelMode
  direction: TravelDirection
  bookingRef: string | null
  notes: string
}
export interface Segment {
  workerId: string
  projectId: string
  projectCode: string
  from: string
  to: string
  own: boolean
}
export interface NotificationRow {
  id: string
  trigger: "manual" | "daily"
  to: string
  title: string
  lines: string[]
  status: "pending" | "sent" | "not_configured" | "failed"
  createdAt: number
  sentAt: number | null
}
export interface LogisticsPlan {
  project: { id: ProjectId; code: string; name: string; city: string; country: string; clientName: string; status: ProjectDoc["status"]; startDate: string; endDate: string | null }
  window: { from: string; to: string; today: string }
  members: MemberRow[]
  accommodations: AccommodationRow[]
  vehicles: VehicleRow[]
  travelLegs: TravelLegRow[]
  plan: Plan
  /** Text of each warning (Lithuanian), same order as `plan.warnings`. */
  warningLines: string[]
  segments: Segment[]
  /** Team changes since the coordinator last acknowledged the plan; null when never acknowledged. */
  diff: PlanDiff | null
  ackAt: number | null
  dailyDigest: boolean
  notifications: NotificationRow[]
  packing: PackingList
}

export async function loadPlan(ctx: DbCtxLike, projectId: ProjectId, opts: { from?: string; days?: number; today?: string } = {}): Promise<LogisticsPlan | null> {
  const db = logisticsReader(ctx)
  const project = await db.get("staffing_projects", projectId)
  if (!project) return null
  const today = opts.today ?? todayIso()
  const from = opts.from ?? addDays(today, -7)
  const to = addDays(from, Math.min(Math.max(opts.days ?? DEFAULT_WINDOW_DAYS, 7), 92) - 1)
  const catalog = await loadCatalog(ctx)
  const client = await db.get("staffing_clients", project.clientId)

  const assignments = (
    await db
      .query("staffing_assignments")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect()
  ).filter(isBlockingAssignment)
  const workers = new Map<string, WorkerDoc>()
  for (const id of new Set(assignments.map((a) => a.workerId))) {
    const w = await db.get("staffing_workers", id)
    if (w) workers.set(id, w)
  }
  const allocations = await db
    .query("staffing_logistics_allocations")
    .withIndex("by_project", (q) => q.eq("projectId", projectId))
    .collect()
  const allocBy = new Map(allocations.map((a) => [a.workerId as string, a]))

  const members: MemberRow[] = assignments
    .filter((a) => workers.has(a.workerId))
    .map((a) => {
      const w = workers.get(a.workerId)!
      const trade = catalog.trades.get(a.tradeId)
      const al = allocBy.get(a.workerId)
      const m: PlanMember = {
        workerId: a.workerId,
        name: fullName(w),
        startDate: a.startDate,
        endDate: a.endDate ?? null,
        isDriver: a.isDriver,
        licenceCategories: w.driverLicenseCategories,
        licenceExpiresAt: w.driverLicenseExpiresAt ?? null,
        sizes: w.clothingSizes,
        tradeCodes: w.trades.map((t) => catalog.trades.get(t.tradeId)?.code ?? "").filter(Boolean),
      }
      return {
        ...m,
        assignmentId: a._id,
        status: a.status as "confirmed" | "active",
        tradeName: trade?.nameLt ?? "?",
        tradeNameEn: trade?.nameEn ?? "?",
        licenceOk: hasValidLicence(m, a.startDate > today ? a.startDate : today),
        accommodationId: al?.accommodationId ?? null,
        vehicleId: al?.vehicleId ?? null,
        driver: al?.driver ?? false,
      }
    })
    .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.name.localeCompare(b.name))

  const accommodations: AccommodationRow[] = (
    await db
      .query("staffing_logistics_accommodations")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect()
  ).map((a) => ({ id: a._id, name: a.name, address: a.address, beds: a.beds, costCents: a.costCents, costPeriod: a.costPeriod, startDate: a.startDate, endDate: a.endDate, notes: a.notes }))
  const vehicles: VehicleRow[] = (
    await db
      .query("staffing_logistics_vehicles")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect()
  ).map((v) => ({ id: v._id, plate: v.plate, model: v.model, seats: v.seats, ownership: v.ownership, costCents: v.costCents, costPeriod: v.costPeriod, startDate: v.startDate, endDate: v.endDate, notes: v.notes }))
  const legDocs = await db
    .query("staffing_logistics_travelLegs")
    .withIndex("by_project", (q) => q.eq("projectId", projectId))
    .collect()
  const nameOf = async (id: WorkerId) => {
    const w = workers.get(id) ?? (await db.get("staffing_workers", id))
    return w ? fullName(w) : "?"
  }
  const travelLegs: TravelLegRow[] = []
  for (const l of legDocs)
    travelLegs.push({
      id: l._id,
      workerId: l.workerId,
      workerName: await nameOf(l.workerId),
      direction: l.direction,
      fromCity: l.fromCity,
      toCity: l.toCity,
      date: l.date,
      mode: l.mode,
      ticketCostCents: l.ticketCostCents,
      booked: l.booked,
      bookingRef: l.bookingRef ?? null,
      notes: l.notes,
    })

  const planAllocations: PlanAllocation[] = allocations.map((a) => ({ workerId: a.workerId, accommodationId: a.accommodationId ?? null, vehicleId: a.vehicleId ?? null, driver: a.driver }))
  const plan = computePlan({ today, from, to, members, accommodations, vehicles, allocations: planAllocations, travelLegs })
  const resourceName = new Map<string, string>([...accommodations.map((a) => [a.id, a.name] as const), ...vehicles.map((v) => [v.id, `${v.model} ${v.plate}`.trim()] as const)])
  const memberName = new Map(members.map((m) => [m.workerId, m.name]))
  for (const l of travelLegs) if (!memberName.has(l.workerId)) memberName.set(l.workerId, l.workerName)
  const warningLines = plan.warnings.map((w) => warningLine(w, { worker: (id) => memberName.get(id) ?? "?", resource: (id) => resourceName.get(id) ?? "?" }))

  // Timeline: each member's confirmed/active assignments (any project) inside the window.
  const segments: Segment[] = []
  const codes = new Map<string, string>([[projectId, project.code]])
  for (const workerId of workers.keys()) {
    const rows = await db
      .query("staffing_assignments")
      .withIndex("by_worker", (q) => q.eq("workerId", workerId as WorkerId).lte("startDate", to))
      .collect()
    for (const a of rows) {
      if (!isBlockingAssignment(a) || (a.endDate && a.endDate < from)) continue
      if (!codes.has(a.projectId)) codes.set(a.projectId, (await db.get("staffing_projects", a.projectId))?.code ?? "?")
      segments.push({ workerId, projectId: a.projectId, projectCode: codes.get(a.projectId)!, from: a.startDate < from ? from : a.startDate, to: !a.endDate || a.endDate > to ? to : a.endDate, own: a.projectId === projectId })
    }
  }

  const settings = await db
    .query("staffing_logistics_settings")
    .withIndex("by_project", (q) => q.eq("projectId", projectId))
    .first()
  const notifications = (
    await db
      .query("staffing_logistics_notifications")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .order("desc")
      .take(5)
  ).map((n) => ({ id: n._id, trigger: n.trigger, to: n.to, title: n.title, lines: n.lines, status: n.status, createdAt: n._creationTime, sentAt: n.sentAt ?? null }))

  const upcoming = members.filter((m) => !m.endDate || m.endDate >= today)
  return {
    project: { id: project._id, code: project.code, name: project.name, city: project.city, country: project.country, clientName: client?.name ?? "?", status: project.status, startDate: project.startDate, endDate: project.endDate ?? null },
    window: { from, to, today },
    members,
    accommodations,
    vehicles,
    travelLegs: travelLegs.sort((a, b) => a.date.localeCompare(b.date) || a.workerName.localeCompare(b.workerName)),
    plan,
    warningLines,
    segments,
    diff: settings?.ackSnapshot ? diffSnapshots(settings.ackSnapshot, planSnapshot(members)) : null,
    ackAt: settings?.ackAt ?? null,
    dailyDigest: settings?.dailyDigest ?? false,
    notifications,
    packing: packingList(upcoming),
  }
}

/** Warnings worth a message (errors and warnings, not info), as text lines. */
export function alertLines(p: LogisticsPlan, severities: readonly Severity[] = ["error", "warning"]): string[] {
  return p.plan.warnings.map((w, i) => [w, p.warningLines[i]!] as const).filter(([w]) => severities.includes(w.severity)).map(([, line]) => line)
}

/** The coordinator's email (project's coordinator user), else the first super user. */
export async function coordinatorEmail(ctx: DbCtxLike, project: { coordinatorUserId?: string | undefined }): Promise<string | null> {
  if (project.coordinatorUserId) {
    // `users` is a system-core table, outside the staffing data model.
    const db = ctx.db as { normalizeId: (table: "users", id: string) => string | null; get: (id: string) => Promise<{ email?: unknown } | null> }
    const id = db.normalizeId("users", project.coordinatorUserId)
    const user = id ? await db.get(id) : null
    if (typeof user?.email === "string") return user.email
  }
  return firstSuperUser()
}

export function firstSuperUser(): string | null {
  return (process.env.SUPER_USER_EMAILS ?? "").split(",").map((s) => s.trim()).filter(Boolean)[0] ?? null
}
