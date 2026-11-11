// Loads the housing pool (flats of every region, stays, vehicles, logs,
// workers and their project spans) and builds the dashboard views. No
// permission checks: the calling function guards first.
import { addDays, fullName, todayIso } from "../pure"
import type { DbCtxLike } from "../shared"
import {
  allocateHousingCosts,
  flatFlags,
  flatStats,
  monthRange,
  occupantsOn,
  regionOf,
  regionTotals,
  suggestMoves,
  vehicleStats,
  weekStarts,
  type FlatStats,
  type HousingCostSplit,
  type HousingFlag,
  type HousingFlat,
  type HousingPerson,
  type HousingStay,
  type IncomingWorker,
  type MoveSuggestion,
  type ProjectHousingCost,
  type RegionTotals,
  type VehicleLogEntry,
  type VehicleLogKind,
  type VehicleStats,
  type WorkerProjectSpan,
} from "./housing"
import { logisticsReader } from "./plan"
import { hasValidLicence, type CostPeriod, type VehicleCostPeriod, type VehicleOwnership } from "./pure"

const SCAN = 5000

export interface FlatRow extends HousingFlat {
  address: string
  city: string
  rooms: number | null
  landlord: string
  notes: string
  /** Pool flat (no project): beds through stays. */
  pool: boolean
  projectCode: string | null
}
export interface StayRow extends HousingStay {
  id: string
  /** Derived from a project allocation (legacy flats); read-only here. */
  legacy: boolean
}
export interface PersonRow extends HousingPerson {
  active: boolean
}
export interface FleetVehicle {
  id: string
  plate: string
  model: string
  seats: number
  ownership: VehicleOwnership
  costCents: number
  costPeriod: VehicleCostPeriod
  startDate: string
  endDate: string
  region: string
  accommodationId: string | null
  projectId: string | null
  notes: string
}
export interface ProjectInfo {
  id: string
  code: string
  name: string
  city: string
  region: string
}

export interface HousingWorld {
  today: string
  flats: FlatRow[]
  stays: StayRow[]
  people: Map<string, PersonRow>
  vehicles: FleetVehicle[]
  logs: (VehicleLogEntry & { id: string; driverId: string | null; notes: string })[]
  projects: Map<string, ProjectInfo>
  /** Confirmed, active and ended assignments. */
  spans: (WorkerProjectSpan & { status: string })[]
}

/** Everything the housing pool needs, in one read. */
export async function loadHousingWorld(ctx: DbCtxLike, today = todayIso()): Promise<HousingWorld> {
  const db = logisticsReader(ctx)
  const projects = new Map<string, ProjectInfo>()
  for (const p of await db.query("staffing_projects").take(SCAN)) projects.set(p._id, { id: p._id, code: p.code, name: p.name, city: p.city, region: regionOf(p.city) })

  const spans: HousingWorld["spans"] = []
  for (const status of ["confirmed", "active", "ended"] as const)
    for (const a of await db
      .query("staffing_assignments")
      .withIndex("by_status", (q) => q.eq("status", status))
      .take(SCAN))
      spans.push({ workerId: a.workerId, projectId: a.projectId, startDate: a.startDate, endDate: a.endDate ?? null, status: a.status })

  const flats: FlatRow[] = (await db.query("staffing_logistics_accommodations").take(SCAN)).map((a) => {
    const project = a.projectId ? projects.get(a.projectId) : undefined
    return {
      id: a._id,
      name: a.name,
      region: a.region ?? (project ? project.region : regionOf(a.city ?? "")),
      city: a.city ?? project?.city ?? "",
      beds: a.beds,
      costCents: a.costCents,
      costPeriod: a.costPeriod as CostPeriod,
      startDate: a.startDate,
      endDate: a.endDate,
      projectId: a.projectId ?? null,
      address: a.address,
      rooms: a.rooms ?? null,
      landlord: a.landlord ?? "",
      notes: a.notes,
      pool: !a.projectId,
      projectCode: project?.code ?? null,
    }
  })
  const flatById = new Map(flats.map((f) => [f.id, f]))

  const vehicles: FleetVehicle[] = (await db.query("staffing_logistics_vehicles").take(SCAN)).map((v) => ({
    id: v._id,
    plate: v.plate,
    model: v.model,
    seats: v.seats,
    ownership: v.ownership,
    costCents: v.costCents,
    costPeriod: v.costPeriod,
    startDate: v.startDate,
    endDate: v.endDate,
    region: v.region ?? (v.projectId ? (projects.get(v.projectId)?.region ?? "") : ""),
    accommodationId: v.accommodationId ?? null,
    projectId: v.projectId ?? null,
    notes: v.notes,
  }))
  for (const v of vehicles) {
    const f = v.accommodationId ? flatById.get(v.accommodationId) : undefined
    if (f) f.hasVehicle = true
  }

  const stays: StayRow[] = (await db.query("staffing_logistics_stays").take(SCAN)).map((s) => ({ id: s._id, workerId: s.workerId, accommodationId: s.accommodationId, startDate: s.startDate, endDate: s.endDate ?? null, legacy: false }))
  // Legacy project flats: a bed allocation lasts as long as the worker's assignments on that project (within the booking).
  for (const al of await db.query("staffing_logistics_allocations").take(SCAN)) {
    const f = al.accommodationId ? flatById.get(al.accommodationId) : undefined
    if (!f) continue
    for (const sp of spans) {
      if (sp.workerId !== al.workerId || sp.projectId !== al.projectId || sp.status === "ended") continue
      const startDate = sp.startDate > f.startDate ? sp.startDate : f.startDate
      const endDate = sp.endDate === null || sp.endDate > f.endDate ? f.endDate : sp.endDate
      if (endDate < startDate) continue
      stays.push({ id: `legacy:${al._id}:${sp.startDate}`, workerId: al.workerId, accommodationId: f.id, startDate, endDate, legacy: true })
    }
  }

  const people = new Map<string, PersonRow>()
  for (const w of await db.query("staffing_workers").take(SCAN))
    people.set(w._id, {
      workerId: w._id,
      name: fullName(w),
      nationality: w.nationality,
      languages: w.languages,
      canDrive: hasValidLicence({ licenceCategories: w.driverLicenseCategories, licenceExpiresAt: w.driverLicenseExpiresAt ?? null }, today),
      active: w.status === "active",
    })

  const logs: HousingWorld["logs"] = (await db.query("staffing_logistics_vehicleLogs").take(SCAN)).map((l) => ({
    id: l._id,
    vehicleId: l.vehicleId,
    date: l.date,
    kind: l.kind as VehicleLogKind,
    km: l.km,
    litres: l.litres,
    costCents: l.costCents,
    driverId: l.driverId ?? null,
    notes: l.notes,
  }))

  return { today, flats, stays, people, vehicles, logs, projects, spans }
}

// ---------------------------------------------------------------- incoming

export interface IncomingRow extends IncomingWorker {
  name: string
  nationality: string
  languages: readonly string[]
  canDrive: boolean
  projectCode: string
}

/**
 * Workers with a confirmed/active assignment in `region` that starts within
 * `days` (or is running) and no bed (pool stay or project flat) on its first
 * remaining day.
 */
export function incomingWorkers(w: HousingWorld, region: string, days = 28): IncomingRow[] {
  const until = addDays(w.today, days)
  const seen = new Set<string>()
  const out: IncomingRow[] = []
  const spans = w.spans.filter((s) => s.status !== "ended").sort((a, b) => a.startDate.localeCompare(b.startDate))
  for (const s of spans) {
    const project = w.projects.get(s.projectId)
    if (!project || project.region !== region || seen.has(s.workerId)) continue
    if (s.startDate > until || (s.endDate && s.endDate < w.today)) continue
    const first = s.startDate > w.today ? s.startDate : w.today
    const housed = w.stays.some((st) => st.workerId === s.workerId && st.startDate <= first && (st.endDate === null || st.endDate >= first))
    if (housed) continue
    const p = w.people.get(s.workerId)
    if (!p?.active) continue
    seen.add(s.workerId)
    out.push({ workerId: s.workerId, projectId: s.projectId, region, startDate: first, endDate: s.endDate, name: p.name, nationality: p.nationality, languages: p.languages, canDrive: p.canDrive, projectCode: project.code })
  }
  return out
}

// ---------------------------------------------------------------- dashboard

export interface ResidentRow {
  workerId: string
  name: string
  nationality: string
  languages: readonly string[]
  canDrive: boolean
  projectCodes: string[]
  stayId: string
  legacy: boolean
  startDate: string
  endDate: string | null
}
export interface WeekCell {
  weekStart: string
  usedBedNights: number
  paidBedNights: number
  occupancy: number
  peak: number
}
export interface FlatOverview extends FlatRow {
  occupiedToday: number
  residents: ResidentRow[]
  /** Residents arriving later (stays starting after today). */
  upcoming: ResidentRow[]
  weeks: WeekCell[]
  month: FlatStats
  flags: HousingFlag[]
  vehicles: { id: string; plate: string; model: string; seats: number }[]
}
export interface SuggestionRow extends MoveSuggestion {
  sourceName: string
  moves: (MoveSuggestion["moves"][number] & { workerName: string; toName: string })[]
}
export interface HousingOverview {
  today: string
  month: string
  monthFrom: string
  monthTo: string
  regions: string[]
  region: string
  weeks: string[]
  flats: FlatOverview[]
  totals: RegionTotals
  suggestions: SuggestionRow[]
  incoming: IncomingRow[]
  /** Active workers, for the "add a resident" form. */
  workers: { workerId: string; name: string; nationality: string; languages: readonly string[] }[]
}

/** Occupancy per flat and week, the month's money, flags, consolidation moves and the incoming team of a region. */
export function housingOverview(w: HousingWorld, opts: { region?: string; month?: string; weeks?: number } = {}): HousingOverview {
  const regions = [...new Set(w.flats.map((f) => f.region).filter(Boolean))].sort((a, b) => (a === "Rotterdam" ? -1 : b === "Rotterdam" ? 1 : a.localeCompare(b)))
  const region = opts.region && regions.includes(opts.region) ? opts.region : (regions[0] ?? "Rotterdam")
  const month = opts.month && /^\d{4}-\d{2}$/.test(opts.month) ? opts.month : w.today.slice(0, 7)
  const { from: monthFrom, to: monthTo } = monthRange(month)
  const weeks = weekStarts(addDays(w.today, -14), opts.weeks ?? 8)
  const flats = w.flats.filter((f) => f.region === region && f.endDate >= addDays(w.today, -31))
  const projectsOn = (workerId: string, from: string, to: string | null) =>
    [...new Set(w.spans.filter((s) => s.workerId === workerId && s.status !== "ended" && s.startDate <= (to ?? "9999-12-31") && (s.endDate === null || s.endDate >= from)).map((s) => w.projects.get(s.projectId)?.code ?? "?"))]
  const resident = (s: StayRow): ResidentRow => {
    const p = w.people.get(s.workerId)
    return {
      workerId: s.workerId,
      name: p?.name ?? "?",
      nationality: p?.nationality ?? "",
      languages: p?.languages ?? [],
      canDrive: p?.canDrive ?? false,
      projectCodes: projectsOn(s.workerId, s.startDate > w.today ? s.startDate : w.today, s.endDate),
      stayId: s.id,
      legacy: s.legacy,
      startDate: s.startDate,
      endDate: s.endDate,
    }
  }
  const rows: FlatOverview[] = flats.map((f) => {
    const mine = w.stays.filter((s) => s.accommodationId === f.id)
    const todayIds = new Set(occupantsOn(f.id, mine, w.today))
    const month = flatStats(f, mine, monthFrom, monthTo)
    return {
      ...f,
      occupiedToday: todayIds.size,
      residents: mine.filter((s) => todayIds.has(s.workerId) && s.startDate <= w.today && (s.endDate === null || s.endDate >= w.today)).map(resident).sort((a, b) => a.name.localeCompare(b.name)),
      upcoming: mine.filter((s) => s.startDate > w.today).map(resident).sort((a, b) => a.startDate.localeCompare(b.startDate)),
      weeks: weeks.map((ws) => {
        const st = flatStats(f, mine, ws, addDays(ws, 6))
        return { weekStart: ws, usedBedNights: st.usedBedNights, paidBedNights: st.paidBedNights, occupancy: st.occupancy, peak: st.peak }
      }),
      month,
      flags: flatFlags(f, mine, w.people, w.today, month),
      vehicles: w.vehicles.filter((v) => v.accommodationId === f.id).map((v) => ({ id: v.id, plate: v.plate, model: v.model, seats: v.seats })),
    }
  })
  rows.sort((a, b) => Number(b.pool) - Number(a.pool) || a.month.occupancy - b.month.occupancy || a.name.localeCompare(b.name))

  const flatName = new Map(w.flats.map((f) => [f.id, f.name]))
  const suggestions: SuggestionRow[] = suggestMoves({ flats: flats, stays: w.stays, people: [...w.people.values()], from: addDays(w.today, 1) }).map((s) => ({
    ...s,
    sourceName: flatName.get(s.sourceId) ?? "?",
    moves: s.moves.map((m) => ({ ...m, workerName: w.people.get(m.workerId)?.name ?? "?", toName: flatName.get(m.toId) ?? "?" })),
  }))

  return {
    today: w.today,
    month,
    monthFrom,
    monthTo,
    regions,
    region,
    weeks,
    flats: rows,
    totals: regionTotals(rows.map((r) => ({ beds: r.beds, occupiedToday: r.occupiedToday, stats: r.month }))),
    suggestions,
    incoming: incomingWorkers(w, region),
    workers: [...w.people.values()].filter((p) => p.active).map((p) => ({ workerId: p.workerId, name: p.name, nationality: p.nationality, languages: p.languages })).sort((a, b) => a.name.localeCompare(b.name)),
  }
}

// ---------------------------------------------------------------- fleet

export interface FleetRow extends FleetVehicle {
  accommodationName: string | null
  projectCode: string | null
  month: VehicleStats
  /** Residents of the vehicle's flat today who may drive. */
  drivers: { workerId: string; name: string }[]
  riders: number
  logs: (HousingWorld["logs"][number] & { driverName: string | null })[]
}
export interface FleetOverview {
  today: string
  month: string
  regions: string[]
  region: string
  vehicles: FleetRow[]
  totals: { vehicles: number; fixedCents: number; fuelCents: number; serviceCents: number; totalCents: number; km: number; costPerKmCents: number | null }
  flats: { id: string; name: string }[]
  /** Workers who may be logged as drivers (valid licence). */
  drivers: { workerId: string; name: string }[]
}

/** Vehicles of a region with the month's cost, km and fuel. */
export function fleetOverview(w: HousingWorld, opts: { region?: string; month?: string } = {}): FleetOverview {
  const regions = [...new Set([...w.vehicles.map((v) => v.region), ...w.flats.map((f) => f.region)].filter(Boolean))].sort((a, b) => (a === "Rotterdam" ? -1 : b === "Rotterdam" ? 1 : a.localeCompare(b)))
  const region = opts.region && regions.includes(opts.region) ? opts.region : (regions[0] ?? "Rotterdam")
  const month = opts.month && /^\d{4}-\d{2}$/.test(opts.month) ? opts.month : w.today.slice(0, 7)
  const { from, to } = monthRange(month)
  const flatName = new Map(w.flats.map((f) => [f.id, f.name]))
  const vehicles: FleetRow[] = w.vehicles
    .filter((v) => v.region === region)
    .map((v) => {
      const residents = v.accommodationId ? occupantsOn(v.accommodationId, w.stays, w.today) : []
      return {
        ...v,
        accommodationName: v.accommodationId ? (flatName.get(v.accommodationId) ?? null) : null,
        projectCode: v.projectId ? (w.projects.get(v.projectId)?.code ?? null) : null,
        month: vehicleStats(v, w.logs, from, to),
        drivers: residents
          .map((id) => w.people.get(id))
          .filter((p): p is PersonRow => Boolean(p?.canDrive))
          .map((p) => ({ workerId: p.workerId, name: p.name })),
        riders: residents.length,
        logs: w.logs
          .filter((l) => l.vehicleId === v.id)
          .sort((a, b) => b.date.localeCompare(a.date))
          .slice(0, 30)
          .map((l) => ({ ...l, driverName: l.driverId ? (w.people.get(l.driverId)?.name ?? null) : null })),
      }
    })
    .sort((a, b) => b.month.totalCents - a.month.totalCents)
  const sum = (k: "fixedCents" | "fuelCents" | "serviceCents" | "totalCents" | "km") => vehicles.reduce((s, v) => s + v.month[k], 0)
  const km = sum("km")
  return {
    today: w.today,
    month,
    regions,
    region,
    vehicles,
    totals: { vehicles: vehicles.length, fixedCents: sum("fixedCents"), fuelCents: sum("fuelCents"), serviceCents: sum("serviceCents"), totalCents: sum("totalCents"), km, costPerKmCents: km > 0 ? Math.round(sum("totalCents") / km) : null },
    flats: w.flats.filter((f) => f.pool && f.region === region).map((f) => ({ id: f.id, name: f.name })),
    drivers: [...w.people.values()].filter((p) => p.active && p.canDrive).map((p) => ({ workerId: p.workerId, name: p.name })).sort((a, b) => a.name.localeCompare(b.name)),
  }
}

// ---------------------------------------------------------------- costs per project (for invoicing)

export interface ProjectHousingCostRow extends ProjectHousingCost {
  projectCode: string
  projectName: string
}
export interface HousingCostsByProject extends Omit<HousingCostSplit, "projects"> {
  from: string
  to: string
  projects: ProjectHousingCostRow[]
}

/**
 * Housing and vehicle costs of `[from, to]` per project, for profitability
 * and invoicing. Each day a flat's rent (empty beds included) is shared by the
 * people sleeping there and charged to the project each works on; a vehicle
 * goes to its project or to its flat's residents' projects; fuel and service
 * come from the vehicle log. No permission check: guard before calling.
 *
 * ```ts
 * const { projects } = await housingCostsByProject(ctx, { from: "2026-11-01", to: "2026-11-30" })
 * // → [{ projectId, projectCode, accommodationCents, emptyBedCents, vehicleCents, bedNights }, …]
 * ```
 */
export async function housingCostsByProject(ctx: DbCtxLike, range: { from: string; to: string }): Promise<HousingCostsByProject> {
  const w = await loadHousingWorld(ctx)
  const split = allocateHousingCosts({ flats: w.flats, stays: w.stays, spans: w.spans, vehicles: w.vehicles, logs: w.logs, from: range.from, to: range.to })
  return {
    from: range.from,
    to: range.to,
    unallocatedCents: split.unallocatedCents,
    totalCents: split.totalCents,
    projects: split.projects.map((p) => ({ ...p, projectCode: w.projects.get(p.projectId)?.code ?? "?", projectName: w.projects.get(p.projectId)?.name ?? "?" })),
  }
}
