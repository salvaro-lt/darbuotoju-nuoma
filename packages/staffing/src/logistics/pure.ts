// Logistics planning, pure: who is on site when, beds, seats, travel, sizes,
// and the checks shown as warnings. No Convex imports (browser-safe, unit-tested).
import { addDays, rangeCovers } from "../pure"

export const COST_PERIODS = ["night", "month"] as const
export type CostPeriod = (typeof COST_PERIODS)[number]
export const VEHICLE_COST_PERIODS = ["day", "month"] as const
export type VehicleCostPeriod = (typeof VEHICLE_COST_PERIODS)[number]
export const VEHICLE_OWNERSHIP = ["rented", "owned"] as const
export type VehicleOwnership = (typeof VEHICLE_OWNERSHIP)[number]
export const TRAVEL_MODES = ["bus", "flight", "car", "ferry", "train"] as const
export type TravelMode = (typeof TRAVEL_MODES)[number]
export const TRAVEL_DIRECTIONS = ["arrival", "departure"] as const
export type TravelDirection = (typeof TRAVEL_DIRECTIONS)[number]

export const WARNING_KINDS = [
  "beds_short",
  "no_bed",
  "accommodation_overfull",
  "vehicle_no_driver",
  "seats_short",
  "travel_missing",
  "travel_unbooked",
  "sizes_missing",
  "empty_beds",
] as const
export type WarningKind = (typeof WARNING_KINDS)[number]
export type Severity = "error" | "warning" | "info"
export const WARNING_SEVERITY: Record<WarningKind, Severity> = {
  beds_short: "error",
  no_bed: "error",
  accommodation_overfull: "error",
  vehicle_no_driver: "error",
  seats_short: "error",
  travel_missing: "warning",
  travel_unbooked: "warning",
  sizes_missing: "warning",
  empty_beds: "info",
}

/** One confirmed/active assignment of a worker on the project. */
export interface PlanMember {
  workerId: string
  name: string
  startDate: string
  endDate: string | null
  isDriver: boolean
  /** Driving licence categories and expiry from the worker card. */
  licenceCategories: readonly string[]
  licenceExpiresAt: string | null
  sizes: { jacket?: string | undefined; trousers?: string | undefined; shoes?: string | undefined }
  tradeCodes: readonly string[]
}
export interface PlanAccommodation {
  id: string
  name: string
  beds: number
  costCents: number
  costPeriod: CostPeriod
  startDate: string
  endDate: string
}
export interface PlanVehicle {
  id: string
  plate: string
  seats: number
  costCents: number
  costPeriod: VehicleCostPeriod
  startDate: string
  endDate: string
}
export interface PlanAllocation {
  workerId: string
  accommodationId: string | null
  vehicleId: string | null
  driver: boolean
}
export interface PlanTravelLeg {
  id: string
  workerId: string
  direction: TravelDirection
  date: string
  booked: boolean
  ticketCostCents: number
}
export interface PlanInput {
  today: string
  from: string
  to: string
  members: readonly PlanMember[]
  accommodations: readonly PlanAccommodation[]
  vehicles: readonly PlanVehicle[]
  allocations: readonly PlanAllocation[]
  travelLegs: readonly PlanTravelLeg[]
  /** Beds of members in the regional housing pool (stays in pool flats): they count as beds and silence "no bed". */
  pooled?: readonly { workerId: string; startDate: string; endDate: string | null }[]
}

export interface Warning {
  kind: WarningKind
  severity: Severity
  from?: string
  to?: string
  workerId?: string
  resourceId?: string
  /** People / passengers / empty beds, depending on the kind. */
  count?: number
  /** Beds / seats. */
  capacity?: number
  /** Money wasted (empty beds) in cents. */
  cents?: number
}
export interface PlanDay {
  date: string
  people: number
  beds: number
}
export interface ResourceLoad {
  id: string
  /** Per day of the window: people allocated and on site, or null when the resource isn't booked that day. */
  load: (number | null)[]
  /** Vehicles: a valid driver is on board that day. */
  driverOk?: boolean[]
}
export interface PlanCosts {
  accommodationCents: number
  vehicleCents: number
  ticketCents: number
  emptyBedCents: number
}
export interface Plan {
  days: PlanDay[]
  accommodations: ResourceLoad[]
  vehicles: ResourceLoad[]
  warnings: Warning[]
  costs: PlanCosts
}

/** Every ISO day in `[from, to]` (inclusive). */
export function daysIn(from: string, to: string): string[] {
  const out: string[] = []
  for (let d = from; d <= to && out.length < 400; d = addDays(d, 1)) out.push(d)
  return out
}

const covers = (r: { startDate: string; endDate: string | null }, day: string) => rangeCovers({ startDate: r.startDate, endDate: r.endDate ?? undefined }, day)

/** Consecutive days (sorted ISO strings) collapsed into `[from, to]` runs. */
export function groupRuns(days: readonly string[]): { from: string; to: string }[] {
  const out: { from: string; to: string }[] = []
  for (const d of days) {
    const last = out.at(-1)
    if (last && addDays(last.to, 1) === d) last.to = d
    else out.push({ from: d, to: d })
  }
  return out
}

/** A licence that lets the worker drive a car (category B or higher) on `day`. */
export function hasValidLicence(m: Pick<PlanMember, "licenceCategories" | "licenceExpiresAt">, day: string): boolean {
  if (!m.licenceCategories.some((c) => /^(B|BE|C|C1|CE|D|D1)$/i.test(c.trim()))) return false
  return !m.licenceExpiresAt || m.licenceExpiresAt >= day
}

/** May drive the project's vehicles on `day`: marked as driver on the assignment and holds a valid licence. */
export const canDrive = (m: PlanMember, day: string) => m.isDriver && hasValidLicence(m, day)

export const hasAllSizes = (s: PlanMember["sizes"]) => Boolean(s.jacket?.trim() && s.trousers?.trim() && s.shoes?.trim())

/** Cost of one day: per night as is; per month spread over 30 days. */
export const dailyCostCents = (costCents: number, period: CostPeriod | VehicleCostPeriod) => (period === "month" ? costCents / 30 : costCents)

/**
 * The logistics plan of a project for `[from, to]`: people and beds per day,
 * each resource's load, warnings (only from `today` on) and costs of the window.
 */
export function computePlan(input: PlanInput): Plan {
  const days = daysIn(input.from, input.to)
  const checkFrom = input.today > input.from ? input.today : input.from
  const alloc = new Map(input.allocations.map((a) => [a.workerId, a]))
  const memberById = new Map<string, PlanMember[]>()
  for (const m of input.members) memberById.set(m.workerId, [...(memberById.get(m.workerId) ?? []), m])
  const onSite = (day: string) => [...new Set(input.members.filter((m) => covers(m, day)).map((m) => m.workerId))]
  const memberOn = (workerId: string, day: string) => memberById.get(workerId)?.find((m) => covers(m, day)) ?? null

  const warnings: Warning[] = []
  const push = (w: Omit<Warning, "severity">) => warnings.push({ ...w, severity: WARNING_SEVERITY[w.kind] })

  const planDays: PlanDay[] = []
  const shortDays: { day: string; people: number; beds: number }[] = []
  const noBed = new Map<string, string[]>()
  const accLoad = new Map(input.accommodations.map((a) => [a.id, [] as (number | null)[]]))
  const overfull = new Map<string, string[]>()
  const empty = new Map<string, { days: string[]; beds: number; cents: number }>()
  const vehLoad = new Map(input.vehicles.map((v) => [v.id, { load: [] as (number | null)[], driverOk: [] as boolean[] }]))
  const noDriver = new Map<string, string[]>()
  const seatsShort = new Map<string, { days: string[]; max: number }>()
  const costs: PlanCosts = { accommodationCents: 0, vehicleCents: 0, ticketCents: 0, emptyBedCents: 0 }

  for (const day of days) {
    const people = onSite(day)
    const check = day >= checkFrom
    const accs = input.accommodations.filter((a) => covers(a, day))
    const hasProjectBed = (w: string) => {
      const accId = alloc.get(w)?.accommodationId
      return Boolean(accId && accs.some((a) => a.id === accId))
    }
    const pooledToday = new Set(people.filter((w) => !hasProjectBed(w) && (input.pooled ?? []).some((p) => p.workerId === w && covers(p, day))))
    const beds = accs.reduce((s, a) => s + a.beds, 0) + pooledToday.size
    planDays.push({ date: day, people: people.length, beds })
    if (check && people.length > beds) shortDays.push({ day, people: people.length, beds })

    for (const w of people) {
      if (!hasProjectBed(w) && !pooledToday.has(w)) {
        if (check) noBed.set(w, [...(noBed.get(w) ?? []), day])
      }
    }

    for (const a of input.accommodations) {
      const row = accLoad.get(a.id)!
      if (!covers(a, day)) {
        row.push(null)
        continue
      }
      const n = people.filter((w) => alloc.get(w)?.accommodationId === a.id).length
      row.push(n)
      const perBed = dailyCostCents(a.costCents, a.costPeriod) / Math.max(a.beds, 1)
      costs.accommodationCents += dailyCostCents(a.costCents, a.costPeriod)
      if (n < a.beds) costs.emptyBedCents += (a.beds - n) * perBed
      if (!check) continue
      if (n > a.beds) overfull.set(a.id, [...(overfull.get(a.id) ?? []), day])
      if (n < a.beds) {
        const e = empty.get(a.id) ?? { days: [], beds: 0, cents: 0 }
        e.days.push(day)
        e.beds = Math.max(e.beds, a.beds - n)
        e.cents += (a.beds - n) * perBed
        empty.set(a.id, e)
      }
    }

    for (const v of input.vehicles) {
      const row = vehLoad.get(v.id)!
      if (!covers(v, day)) {
        row.load.push(null)
        row.driverOk.push(false)
        continue
      }
      costs.vehicleCents += dailyCostCents(v.costCents, v.costPeriod)
      const riders = people.filter((w) => alloc.get(w)?.vehicleId === v.id)
      const driverOk = riders.some((w) => {
        const m = memberOn(w, day)
        return Boolean(m && alloc.get(w)?.driver && canDrive(m, day))
      })
      row.load.push(riders.length)
      row.driverOk.push(driverOk)
      if (!check) continue
      if (!driverOk) noDriver.set(v.id, [...(noDriver.get(v.id) ?? []), day])
      if (riders.length > v.seats) {
        const s = seatsShort.get(v.id) ?? { days: [], max: 0 }
        s.days.push(day)
        s.max = Math.max(s.max, riders.length)
        seatsShort.set(v.id, s)
      }
    }
  }

  // Runs of short days, with the worst count of the run.
  for (const run of groupRuns(shortDays.map((d) => d.day))) {
    const inRun = shortDays.filter((d) => d.day >= run.from && d.day <= run.to)
    const worst = inRun.reduce((a, b) => (b.people - b.beds > a.people - a.beds ? b : a))
    push({ kind: "beds_short", ...run, count: worst.people, capacity: worst.beds })
  }
  for (const [workerId, ds] of noBed) for (const run of groupRuns(ds)) push({ kind: "no_bed", workerId, ...run })
  for (const [id, ds] of overfull) for (const run of groupRuns(ds)) push({ kind: "accommodation_overfull", resourceId: id, ...run, capacity: input.accommodations.find((a) => a.id === id)!.beds })
  for (const [id, ds] of noDriver) for (const run of groupRuns(ds)) push({ kind: "vehicle_no_driver", resourceId: id, ...run })
  for (const [id, s] of seatsShort) for (const run of groupRuns(s.days)) push({ kind: "seats_short", resourceId: id, ...run, count: s.max, capacity: input.vehicles.find((v) => v.id === id)!.seats })
  for (const [id, e] of empty) {
    const runs = groupRuns(e.days)
    push({ kind: "empty_beds", resourceId: id, from: runs[0]!.from, to: runs.at(-1)!.to, count: e.beds, cents: Math.round(e.cents) })
  }

  // Travel: every arrival in the checked window needs a leg (≤ 7 days before the start), booked.
  for (const m of input.members) {
    if (m.startDate < checkFrom || m.startDate > input.to) continue
    const legs = input.travelLegs.filter((l) => l.workerId === m.workerId && l.direction === "arrival" && l.date <= m.startDate && l.date >= addDays(m.startDate, -7))
    if (legs.length === 0) push({ kind: "travel_missing", workerId: m.workerId, from: m.startDate, to: m.startDate })
  }
  for (const l of input.travelLegs) {
    if (l.date >= input.from && l.date <= input.to) costs.ticketCents += l.ticketCostCents
    if (!l.booked && l.date >= checkFrom && l.date <= input.to) push({ kind: "travel_unbooked", workerId: l.workerId, resourceId: l.id, from: l.date, to: l.date })
  }

  // Sizes: anyone on site (or arriving) in the checked window.
  const sized = new Set<string>()
  for (const m of input.members) {
    if (sized.has(m.workerId) || (m.endDate && m.endDate < checkFrom) || m.startDate > input.to) continue
    sized.add(m.workerId)
    if (!hasAllSizes(m.sizes)) push({ kind: "sizes_missing", workerId: m.workerId })
  }

  const rank: Record<Severity, number> = { error: 0, warning: 1, info: 2 }
  warnings.sort((a, b) => rank[a.severity] - rank[b.severity] || (a.from ?? "9999").localeCompare(b.from ?? "9999") || a.kind.localeCompare(b.kind))
  costs.accommodationCents = Math.round(costs.accommodationCents)
  costs.vehicleCents = Math.round(costs.vehicleCents)
  costs.emptyBedCents = Math.round(costs.emptyBedCents)
  return {
    days: planDays,
    accommodations: input.accommodations.map((a) => ({ id: a.id, load: accLoad.get(a.id)! })),
    vehicles: input.vehicles.map((v) => ({ id: v.id, ...vehLoad.get(v.id)! })),
    warnings,
    costs,
  }
}

// ---------------------------------------------------------------- auto-assign

/** Peak number of `ranges` overlapping any day of `[from, to]` (≤ 400 days scanned). */
function peakLoad(ranges: readonly { startDate: string; endDate: string | null }[], from: string, to: string): number {
  let peak = 0
  for (const day of daysIn(from, to)) peak = Math.max(peak, ranges.filter((r) => covers(r, day)).length)
  return peak
}

export interface AutoAssignInput {
  today: string
  horizonEnd: string
  members: readonly PlanMember[]
  allocations: readonly PlanAllocation[]
}

/** The part of a member's stay that matters for planning: from today (or start) to the end (or horizon). */
function stay(m: PlanMember, today: string, horizonEnd: string) {
  const from = m.startDate > today ? m.startDate : today
  const to = m.endDate && m.endDate < horizonEnd ? m.endDate : horizonEnd
  return { from, to }
}

/** One stay per worker (earliest start, latest end) among their assignments still relevant on/after today. */
function workerStays(members: readonly PlanMember[], today: string) {
  const byWorker = new Map<string, PlanMember>()
  for (const m of members) {
    if (m.endDate && m.endDate < today) continue
    const cur = byWorker.get(m.workerId)
    if (!cur) byWorker.set(m.workerId, m)
    else
      byWorker.set(m.workerId, {
        ...cur,
        startDate: m.startDate < cur.startDate ? m.startDate : cur.startDate,
        endDate: !cur.endDate || !m.endDate ? null : m.endDate > cur.endDate ? m.endDate : cur.endDate,
        isDriver: cur.isDriver || m.isDriver,
      })
  }
  return [...byWorker.values()].sort((a, b) => a.startDate.localeCompare(b.startDate) || a.name.localeCompare(b.name))
}

/**
 * Beds for workers without one: each goes to the first accommodation that has
 * a free bed on every day of their stay (and is booked for all of it).
 * Returns the new `workerId → accommodationId` choices only.
 */
export function autoAssignBeds(input: AutoAssignInput & { accommodations: readonly PlanAccommodation[] }): Map<string, string> {
  const current = new Map(input.allocations.filter((a) => a.accommodationId).map((a) => [a.workerId, a.accommodationId!]))
  const stays = workerStays(input.members, input.today)
  const out = new Map<string, string>()
  for (const m of stays) {
    if (current.has(m.workerId)) continue
    const s = stay(m, input.today, input.horizonEnd)
    for (const acc of input.accommodations) {
      if (acc.startDate > s.from || acc.endDate < s.to) continue
      const guests = stays.filter((o) => current.get(o.workerId) === acc.id).map((o) => ({ startDate: o.startDate, endDate: o.endDate }))
      if (peakLoad([...guests, { startDate: m.startDate, endDate: m.endDate }], s.from, s.to) > acc.beds) continue
      current.set(m.workerId, acc.id)
      out.set(m.workerId, acc.id)
      break
    }
  }
  return out
}

/**
 * Seats for workers without one. First every vehicle without a driver gets a
 * free eligible driver, then the others fill free seats. Returns the new
 * `workerId → { vehicleId, driver }` choices only.
 */
export function autoAssignSeats(input: AutoAssignInput & { vehicles: readonly PlanVehicle[] }): Map<string, { vehicleId: string; driver: boolean }> {
  const current = new Map(input.allocations.filter((a) => a.vehicleId).map((a) => [a.workerId, { vehicleId: a.vehicleId!, driver: a.driver }]))
  const stays = workerStays(input.members, input.today)
  const out = new Map<string, { vehicleId: string; driver: boolean }>()
  const fits = (m: PlanMember, v: PlanVehicle) => {
    const s = stay(m, input.today, input.horizonEnd)
    if (v.endDate < s.from || v.startDate > s.to) return false
    const riders = stays.filter((o) => current.get(o.workerId)?.vehicleId === v.id).map((o) => ({ startDate: o.startDate, endDate: o.endDate }))
    return peakLoad([...riders, { startDate: m.startDate, endDate: m.endDate }], s.from, s.to) <= v.seats
  }
  const take = (m: PlanMember, v: PlanVehicle, driver: boolean) => {
    current.set(m.workerId, { vehicleId: v.id, driver })
    out.set(m.workerId, { vehicleId: v.id, driver })
  }
  for (const v of input.vehicles) {
    if (stays.some((o) => current.get(o.workerId)?.vehicleId === v.id && current.get(o.workerId)?.driver)) continue
    const d = stays.find((m) => !current.has(m.workerId) && canDrive(m, stay(m, input.today, input.horizonEnd).from) && fits(m, v))
    if (d) take(d, v, true)
  }
  for (const m of stays) {
    if (current.has(m.workerId)) continue
    const v = input.vehicles.find((x) => fits(m, x))
    if (v) take(m, v, false)
  }
  return out
}

// ---------------------------------------------------------------- plan changes

/** What the coordinator acknowledged: per worker, their stay(s) and driver flag. */
export interface SnapshotEntry {
  workerId: string
  name: string
  ranges: string
  isDriver: boolean
}
export function planSnapshot(members: readonly Pick<PlanMember, "workerId" | "name" | "startDate" | "endDate" | "isDriver">[]): SnapshotEntry[] {
  const by = new Map<string, { name: string; ranges: string[]; isDriver: boolean }>()
  for (const m of members) {
    const e = by.get(m.workerId) ?? { name: m.name, ranges: [], isDriver: false }
    e.ranges.push(`${m.startDate}..${m.endDate ?? ""}`)
    e.isDriver ||= m.isDriver
    by.set(m.workerId, e)
  }
  return [...by.entries()].map(([workerId, e]) => ({ workerId, name: e.name, ranges: e.ranges.sort().join(","), isDriver: e.isDriver })).sort((a, b) => a.workerId.localeCompare(b.workerId))
}

export interface PlanDiff {
  added: SnapshotEntry[]
  removed: SnapshotEntry[]
  changed: { before: SnapshotEntry; after: SnapshotEntry }[]
}
export function diffSnapshots(before: readonly SnapshotEntry[], after: readonly SnapshotEntry[]): PlanDiff {
  const prev = new Map(before.map((e) => [e.workerId, e]))
  const next = new Map(after.map((e) => [e.workerId, e]))
  return {
    added: after.filter((e) => !prev.has(e.workerId)),
    removed: before.filter((e) => !next.has(e.workerId)),
    changed: after.filter((e) => prev.has(e.workerId) && (prev.get(e.workerId)!.ranges !== e.ranges || prev.get(e.workerId)!.isDriver !== e.isDriver)).map((after) => ({ before: prev.get(after.workerId)!, after })),
  }
}
export const isEmptyDiff = (d: PlanDiff) => d.added.length + d.removed.length + d.changed.length === 0

// ---------------------------------------------------------------- workwear

export const PPE_ITEMS = ["helmet", "glasses", "gloves", "earProtection", "hiVis", "safetyBoots", "weldingHelmet", "weldingJacket", "harness"] as const
export type PpeItem = (typeof PPE_ITEMS)[number]

/** PPE kit for one person by trade: everyone gets the base kit; welders and height trades get extras. */
export function ppeKit(tradeCodes: readonly string[]): { item: PpeItem; qty: number }[] {
  const kit: { item: PpeItem; qty: number }[] = [
    { item: "helmet", qty: 1 },
    { item: "glasses", qty: 2 },
    { item: "gloves", qty: 6 },
    { item: "earProtection", qty: 1 },
    { item: "hiVis", qty: 1 },
    { item: "safetyBoots", qty: 1 },
  ]
  if (tradeCodes.some((c) => c.startsWith("WELD") || c === "GRINDER")) kit.push({ item: "weldingHelmet", qty: 1 }, { item: "weldingJacket", qty: 1 })
  if (tradeCodes.some((c) => ["STEEL-ERECT", "SCAFF", "RIGGER"].includes(c))) kit.push({ item: "harness", qty: 1 })
  return kit
}

const JACKET_ORDER = ["XXS", "XS", "S", "M", "L", "XL", "XXL", "2XL", "XXXL", "3XL", "4XL"]
function sizeOrder(a: string, b: string) {
  const ia = JACKET_ORDER.indexOf(a.toUpperCase())
  const ib = JACKET_ORDER.indexOf(b.toUpperCase())
  if (ia >= 0 && ib >= 0) return ia - ib
  const na = Number(a.replace(",", "."))
  const nb = Number(b.replace(",", "."))
  if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb
  return a.localeCompare(b)
}

export interface PackingList {
  people: number
  jacket: { size: string; count: number }[]
  trousers: { size: string; count: number }[]
  shoes: { size: string; count: number }[]
  /** Workers with at least one size unknown. */
  missing: { workerId: string; name: string; fields: ("jacket" | "trousers" | "shoes")[] }[]
  ppe: { item: PpeItem; qty: number }[]
  perPerson: { workerId: string; name: string; sizes: PlanMember["sizes"]; kit: { item: PpeItem; qty: number }[] }[]
}

/** Workwear counts per size and PPE totals for one packing (each worker once). */
export function packingList(members: readonly Pick<PlanMember, "workerId" | "name" | "sizes" | "tradeCodes">[]): PackingList {
  const seen = new Map<string, Pick<PlanMember, "workerId" | "name" | "sizes" | "tradeCodes">>()
  for (const m of members) if (!seen.has(m.workerId)) seen.set(m.workerId, m)
  const people = [...seen.values()].sort((a, b) => a.name.localeCompare(b.name))
  const count = (field: "jacket" | "trousers" | "shoes") => {
    const c = new Map<string, number>()
    for (const p of people) {
      const s = p.sizes[field]?.trim()
      if (s) c.set(s, (c.get(s) ?? 0) + 1)
    }
    return [...c.entries()].sort(([a], [b]) => sizeOrder(a, b)).map(([size, count]) => ({ size, count }))
  }
  const ppe = new Map<PpeItem, number>()
  const perPerson = people.map((p) => {
    const kit = ppeKit(p.tradeCodes)
    for (const k of kit) ppe.set(k.item, (ppe.get(k.item) ?? 0) + k.qty)
    return { workerId: p.workerId, name: p.name, sizes: p.sizes, kit }
  })
  return {
    people: people.length,
    jacket: count("jacket"),
    trousers: count("trousers"),
    shoes: count("shoes"),
    missing: people
      .map((p) => ({ workerId: p.workerId, name: p.name, fields: (["jacket", "trousers", "shoes"] as const).filter((f) => !p.sizes[f]?.trim()) }))
      .filter((p) => p.fields.length > 0),
    ppe: PPE_ITEMS.filter((i) => ppe.has(i)).map((item) => ({ item, qty: ppe.get(item)! })),
    perPerson,
  }
}

// ---------------------------------------------------------------- notification text (LT, for the coordinator)

const fmtEur = (cents: number) => `${(cents / 100).toFixed(2)} EUR`
const span = (w: Warning) => (w.from && w.to && w.from !== w.to ? `${w.from}–${w.to}` : (w.from ?? ""))

/** One plain-text line per warning (Lithuanian), for the n8n notification. */
export function warningLine(w: Warning, names: { worker: (id: string) => string; resource: (id: string) => string }): string {
  const who = w.workerId ? names.worker(w.workerId) : ""
  const what = w.resourceId ? names.resource(w.resourceId) : ""
  switch (w.kind) {
    case "beds_short":
      return `Trūksta lovų ${span(w)}: žmonių ${w.count}, lovų ${w.capacity}`
    case "no_bed":
      return `${who} neturi lovos ${span(w)}`
    case "accommodation_overfull":
      return `${what}: per daug žmonių ${span(w)} (lovų ${w.capacity})`
    case "vehicle_no_driver":
      return `${what}: nėra vairuotojo su galiojančiu pažymėjimu ${span(w)}`
    case "seats_short":
      return `${what}: keleivių ${w.count}, vietų ${w.capacity} (${span(w)})`
    case "travel_missing":
      return `${who} atvyksta ${span(w)}, bet kelionė nesuplanuota`
    case "travel_unbooked":
      return `${who}: bilietas ${span(w)} dar nenupirktas`
    case "sizes_missing":
      return `${who}: nežinomi darbo rūbų dydžiai`
    case "empty_beds":
      return `${what}: tuščios lovos (${w.count}) ${span(w)}, švaistoma ${fmtEur(w.cents ?? 0)}`
  }
}
