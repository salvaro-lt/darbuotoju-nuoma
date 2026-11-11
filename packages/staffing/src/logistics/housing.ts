// Housing pool, pure: long-term flats in a region (paid whether occupied or
// not), who sleeps where and when (stays), occupancy and wasted money, the
// rules of who can live together, the consolidation optimizer, the incoming
// team allocator and the split of housing and vehicle costs over projects.
// No Convex imports (browser-safe, unit-tested in test/housing.test.ts).
import { addDays, rangeCovers } from "../pure"
import { daysIn, type CostPeriod, type VehicleCostPeriod } from "./pure"

// ---------------------------------------------------------------- regions

export const DEFAULT_REGION = "Rotterdam"

/** Cities within ~100 km of the region's centre. Unknown cities are their own region. */
const REGION_CITIES: Record<string, readonly string[]> = {
  Rotterdam: [
    "rotterdam",
    "schiedam",
    "vlaardingen",
    "maassluis",
    "dordrecht",
    "zwijndrecht",
    "papendrecht",
    "sliedrecht",
    "alblasserdam",
    "spijkenisse",
    "barendrecht",
    "ridderkerk",
    "capelle aan den ijssel",
    "krimpen aan den ijssel",
    "hellevoetsluis",
    "europoort",
    "maasvlakte",
    "rozenburg",
    "pernis",
    "botlek",
    "hoogvliet",
    "gorinchem",
    "delft",
    "den haag",
    "the hague",
    "gouda",
    "moerdijk",
    "breda",
    "vlissingen",
    "terneuzen",
  ],
}

const norm = (s: string) => s.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")

/** The housing region of a city (`"Schiedam"` → `"Rotterdam"`); unknown cities are their own region. */
export function regionOf(city: string): string {
  const c = norm(city)
  for (const [region, cities] of Object.entries(REGION_CITIES)) if (cities.includes(c)) return region
  return city.trim()
}

// ---------------------------------------------------------------- shapes

export interface HousingFlat {
  id: string
  name: string
  region: string
  beds: number
  /** Whole place, per night or per month. */
  costCents: number
  costPeriod: CostPeriod
  /** Lease, inclusive. */
  startDate: string
  endDate: string
  /** Legacy flats booked for one project. Pool flats have none. */
  projectId?: string | null
  /** A vehicle is parked at this flat (its residents ride together). */
  hasVehicle?: boolean
}
/** A worker in a bed of a flat for a period (inclusive; open end = until further notice). */
export interface HousingStay {
  id?: string
  workerId: string
  accommodationId: string
  startDate: string
  endDate: string | null
}
export interface HousingPerson {
  workerId: string
  name: string
  /** ISO-2 */
  nationality: string
  /** ISO-639-1 */
  languages: readonly string[]
  /** Only when stored; unknown never blocks. */
  gender?: string | null
  /** Holds a valid car licence (B or higher). */
  canDrive: boolean
}

const covers = (r: { startDate: string; endDate: string | null }, day: string) => rangeCovers({ startDate: r.startDate, endDate: r.endDate ?? undefined }, day)
const overlaps = (a: { startDate: string; endDate: string | null }, from: string, to: string) => a.startDate <= to && (a.endDate === null || a.endDate >= from)
const minDate = (a: string, b: string) => (a < b ? a : b)
const maxDate = (a: string, b: string) => (a > b ? a : b)

// ---------------------------------------------------------------- money per day

const daysInMonth = (day: string) => {
  const [y, m] = day.split("-").map(Number) as [number, number]
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

/** Cost of one calendar day: per night/day as is; per month spread over that month's days (a full month costs exactly `costCents`). */
export function dayCostCents(costCents: number, period: CostPeriod | VehicleCostPeriod, day: string): number {
  return period === "month" ? costCents / daysInMonth(day) : costCents
}

/** Monthly equivalent of a cost (per night/day × 30). */
export const monthlyCostCents = (costCents: number, period: CostPeriod | VehicleCostPeriod) => (period === "month" ? costCents : costCents * 30)

/** `"2026-11"` → first and last day. */
export function monthRange(month: string): { from: string; to: string } {
  const from = `${month}-01`
  return { from, to: `${month}-${String(daysInMonth(from)).padStart(2, "0")}` }
}

/** Monday of the ISO week of `day`. */
export function mondayOf(day: string): string {
  const dow = new Date(`${day}T00:00:00Z`).getUTCDay()
  return addDays(day, -((dow + 6) % 7))
}

/** `n` Mondays from the week of `from`. */
export function weekStarts(from: string, n: number): string[] {
  const first = mondayOf(from)
  return Array.from({ length: n }, (_, i) => addDays(first, i * 7))
}

// ---------------------------------------------------------------- occupancy

/** Distinct workers sleeping in the flat on `day`. */
export function occupantsOn(flatId: string, stays: readonly HousingStay[], day: string): string[] {
  return [...new Set(stays.filter((s) => s.accommodationId === flatId && covers(s, day)).map((s) => s.workerId))]
}

export interface FlatStats {
  /** Days of the window the flat is leased. */
  days: number
  paidBedNights: number
  usedBedNights: number
  /** Most people on one day. */
  peak: number
  /** used / paid (0..1); 0 when not leased. */
  occupancy: number
  /** Average beds in use per leased day. */
  avgOccupied: number
  costCents: number
  /** Cost of the window per average occupied bed; null when nobody slept there. */
  costPerOccupiedBedCents: number | null
  /** Money paid for beds nobody slept in. */
  emptyBedCents: number
}

/** Occupancy and money of a flat over `[from, to]`. */
export function flatStats(flat: HousingFlat, stays: readonly HousingStay[], from: string, to: string): FlatStats {
  const mine = stays.filter((s) => s.accommodationId === flat.id && overlaps(s, from, to))
  let days = 0
  let used = 0
  let peak = 0
  let cost = 0
  let empty = 0
  for (const day of daysIn(maxDate(from, flat.startDate), minDate(to, flat.endDate))) {
    const n = new Set(mine.filter((s) => covers(s, day)).map((s) => s.workerId)).size
    const c = dayCostCents(flat.costCents, flat.costPeriod, day)
    days++
    used += Math.min(n, flat.beds)
    peak = Math.max(peak, n)
    cost += c
    empty += (c * Math.max(flat.beds - n, 0)) / Math.max(flat.beds, 1)
  }
  const paid = days * flat.beds
  const avg = days ? used / days : 0
  return {
    days,
    paidBedNights: paid,
    usedBedNights: used,
    peak,
    occupancy: paid ? used / paid : 0,
    avgOccupied: Math.round(avg * 10) / 10,
    costCents: Math.round(cost),
    costPerOccupiedBedCents: avg > 0 ? Math.round(cost / avg) : null,
    emptyBedCents: Math.round(empty),
  }
}

export interface RegionTotals {
  flats: number
  beds: number
  occupiedToday: number
  paidBedNights: number
  usedBedNights: number
  occupancy: number
  costCents: number
  emptyBedCents: number
  costPerOccupiedBedCents: number | null
}

/** Sums of the flats' stats (same window) plus today's occupied beds. */
export function regionTotals(rows: readonly { beds: number; occupiedToday: number; stats: FlatStats }[]): RegionTotals {
  const t = rows.reduce(
    (s, r) => ({
      beds: s.beds + r.beds,
      occupiedToday: s.occupiedToday + r.occupiedToday,
      paid: s.paid + r.stats.paidBedNights,
      used: s.used + r.stats.usedBedNights,
      cost: s.cost + r.stats.costCents,
      empty: s.empty + r.stats.emptyBedCents,
      avg: s.avg + (r.stats.days ? r.stats.usedBedNights / r.stats.days : 0),
    }),
    { beds: 0, occupiedToday: 0, paid: 0, used: 0, cost: 0, empty: 0, avg: 0 },
  )
  return {
    flats: rows.length,
    beds: t.beds,
    occupiedToday: t.occupiedToday,
    paidBedNights: t.paid,
    usedBedNights: t.used,
    occupancy: t.paid ? t.used / t.paid : 0,
    costCents: t.cost,
    emptyBedCents: t.empty,
    costPerOccupiedBedCents: t.avg > 0 ? Math.round(t.cost / t.avg) : null,
  }
}

// ---------------------------------------------------------------- grouping rules

/** Languages every person speaks (lower case). */
export function commonLanguages(people: readonly Pick<HousingPerson, "languages">[]): string[] {
  if (people.length === 0) return []
  const sets = people.map((p) => new Set(p.languages.map((l) => l.trim().toLowerCase()).filter(Boolean)))
  return [...sets[0]!].filter((l) => sets.every((s) => s.has(l))).sort()
}

export const GROUP_ISSUES = ["no_common_language", "mixed_gender", "no_driver"] as const
export type GroupIssue = (typeof GROUP_ISSUES)[number]

/**
 * Rules for people sharing a flat (and its car):
 * - everyone must share at least one language;
 * - one gender per flat, when genders are stored (unknown never blocks);
 * - with `needsDriver` (the flat has a vehicle), someone must hold a valid licence.
 */
export function groupIssues(people: readonly HousingPerson[], opts: { needsDriver?: boolean } = {}): GroupIssue[] {
  const out: GroupIssue[] = []
  if (people.length > 1 && commonLanguages(people).length === 0) out.push("no_common_language")
  const genders = new Set(people.map((p) => p.gender?.trim().toLowerCase()).filter((g): g is string => Boolean(g)))
  if (genders.size > 1) out.push("mixed_gender")
  if (opts.needsDriver && people.length > 0 && !people.some((p) => p.canDrive)) out.push("no_driver")
  return out
}

/** Hard rules only (language, gender): may these people live together? */
export const canLiveTogether = (people: readonly HousingPerson[]) => groupIssues(people).length === 0

/** Share (0..1) of `group` with the newcomer's nationality; 1 for an empty group. */
export function nationalityAffinity(group: readonly Pick<HousingPerson, "nationality">[], newcomer: Pick<HousingPerson, "nationality">): number {
  if (group.length === 0) return 1
  return group.filter((p) => p.nationality === newcomer.nationality).length / group.length
}

// ---------------------------------------------------------------- capacity

/** Most distinct people in the flat on any day of `[from, to]`, optionally with `extra` stays. */
export function peakIn(flatId: string, stays: readonly HousingStay[], from: string, to: string, extra: readonly HousingStay[] = []): number {
  const mine = [...stays, ...extra].filter((s) => s.accommodationId === flatId && overlaps(s, from, to))
  let peak = 0
  for (const day of daysIn(from, to)) peak = Math.max(peak, new Set(mine.filter((s) => covers(s, day)).map((s) => s.workerId)).size)
  return peak
}

/** Workers whose stays in the flat overlap `[from, to]`. */
export function residentsIn(flatId: string, stays: readonly HousingStay[], from: string, to: string): string[] {
  return [...new Set(stays.filter((s) => s.accommodationId === flatId && overlaps(s, from, to)).map((s) => s.workerId))]
}

interface PlaceCheck {
  flats: readonly HousingFlat[]
  stays: readonly HousingStay[]
  people: ReadonlyMap<string, HousingPerson>
  horizonEnd: string
}

/** Candidate flats for one person and period, best first. Hard rules: region, lease, free bed on every day, language/gender. */
function rankFlats(c: PlaceCheck, person: HousingPerson, period: { startDate: string; endDate: string | null }, region: string, opts: { exclude?: ReadonlySet<string>; mates?: ReadonlySet<string> } = {}) {
  const to = period.endDate ?? c.horizonEnd
  const from = period.startDate
  const out: { flat: HousingFlat; score: number }[] = []
  let anyBed = false
  for (const f of c.flats) {
    if (f.projectId || f.region !== region || opts.exclude?.has(f.id)) continue
    if (f.startDate > from || f.endDate < minDate(to, c.horizonEnd)) continue
    const stay: HousingStay = { workerId: person.workerId, accommodationId: f.id, startDate: from, endDate: to }
    const peak = peakIn(f.id, c.stays, from, to, [stay])
    if (peak > f.beds) continue
    anyBed = true
    const residents = residentsIn(f.id, c.stays, from, to)
      .filter((id) => id !== person.workerId)
      .map((id) => c.people.get(id))
      .filter((p): p is HousingPerson => Boolean(p))
    if (!canLiveTogether([...residents, person])) continue
    const occupied = residents.length > 0 ? 3 : 0
    const mates = opts.mates ? residents.filter((r) => opts.mates!.has(r.workerId)).length : 0
    const driver = f.hasVehicle && !residents.some((r) => r.canDrive) && person.canDrive ? 1 : 0
    const free = f.beds - peak
    out.push({ flat: f, score: occupied + 2 * (residents.length ? nationalityAffinity(residents, person) : 0) + Math.min(mates, 3) + driver - free * 0.1 })
  }
  out.sort((a, b) => b.score - a.score || a.flat.name.localeCompare(b.flat.name))
  return { ranked: out, anyBed }
}

// ---------------------------------------------------------------- consolidation optimizer

export interface Move {
  workerId: string
  toId: string
  /** First night in the new flat. */
  from: string
  /** Last night (the stay's end); null = open. */
  to: string | null
}
export interface MoveSuggestion {
  sourceId: string
  moves: Move[]
  /** The source flat's monthly cost: what ending (or subletting) it saves. */
  monthlySavingCents: number
  /** Occupancy of the source on the move date. */
  occupied: number
  beds: number
}

/**
 * Greedy consolidation: under-occupied flats (occupancy on `from` below
 * `minOccupancy`), emptiest and most expensive first, are emptied when every
 * resident fits into another flat of the same region on every day of their
 * stay, with a common language (and one gender, when known). Targets prefer
 * already occupied flats, the same nationality and the tightest fit. A flat
 * that receives people is never emptied afterwards.
 */
export function suggestMoves(input: { flats: readonly HousingFlat[]; stays: readonly HousingStay[]; people: readonly HousingPerson[]; from: string; horizonDays?: number; minOccupancy?: number }): MoveSuggestion[] {
  const horizonEnd = addDays(input.from, input.horizonDays ?? 90)
  const people = new Map(input.people.map((p) => [p.workerId, p]))
  let stays = input.stays.map((s) => ({ ...s }))
  const minOcc = input.minOccupancy ?? 0.6
  const pool = input.flats.filter((f) => !f.projectId && covers({ startDate: f.startDate, endDate: f.endDate }, input.from))
  const sources = pool
    .map((f) => ({ f, n: occupantsOn(f.id, stays, input.from).length }))
    .filter(({ f, n }) => n > 0 && n / f.beds < minOcc)
    .sort((a, b) => a.n / a.f.beds - b.n / b.f.beds || monthlyCostCents(b.f.costCents, b.f.costPeriod) - monthlyCostCents(a.f.costCents, a.f.costPeriod))
  const emptied = new Set<string>()
  const receivers = new Set<string>()
  const out: MoveSuggestion[] = []
  for (const { f: src, n } of sources) {
    if (receivers.has(src.id)) continue
    // Stays in the source still running on or after the move date, nationality groups together.
    const moving = stays
      .filter((s) => s.accommodationId === src.id && (s.endDate === null || s.endDate >= input.from))
      .sort((a, b) => (people.get(a.workerId)?.nationality ?? "").localeCompare(people.get(b.workerId)?.nationality ?? "") || a.workerId.localeCompare(b.workerId))
    if (moving.some((s) => !people.has(s.workerId))) continue
    let trial = stays
    const moves: Move[] = []
    const exclude = new Set([...emptied, src.id])
    const mates = new Set(moving.map((s) => s.workerId))
    let ok = true
    for (const s of moving) {
      const person = people.get(s.workerId)!
      const from = maxDate(s.startDate, input.from)
      // Leave the source for the checks.
      const without = trial.filter((x) => x !== s)
      const { ranked } = rankFlats({ flats: input.flats, stays: without, people, horizonEnd }, person, { startDate: from, endDate: s.endDate }, src.region, { exclude, mates })
      const best = ranked[0]
      if (!best) {
        ok = false
        break
      }
      const kept = s.startDate < from ? [{ ...s, endDate: addDays(from, -1) }] : []
      trial = [...without, ...kept, { workerId: s.workerId, accommodationId: best.flat.id, startDate: from, endDate: s.endDate }]
      moves.push({ workerId: s.workerId, toId: best.flat.id, from, to: s.endDate })
    }
    if (!ok || moves.length === 0) continue
    stays = trial
    emptied.add(src.id)
    for (const m of moves) receivers.add(m.toId)
    out.push({ sourceId: src.id, moves, monthlySavingCents: monthlyCostCents(src.costCents, src.costPeriod), occupied: n, beds: src.beds })
  }
  return out
}

// ---------------------------------------------------------------- incoming team

export interface IncomingWorker {
  workerId: string
  projectId: string
  /** Region of the project's site. */
  region: string
  startDate: string
  endDate: string | null
}
export type UnplacedReason = "no_flat_in_region" | "no_free_bed" | "no_compatible_flat" | "unknown_worker"
export interface AllocationResult {
  placed: { workerId: string; accommodationId: string; startDate: string; endDate: string | null }[]
  unplaced: { workerId: string; reason: UnplacedReason }[]
}

/**
 * Beds for an incoming team in pool flats of the project's region. Fills paid
 * beds of occupied flats first (an empty flat is opened only when needed),
 * keeps nationality groups and the incoming team together, and never breaks
 * the language/gender rules or the capacity of any day.
 */
export function allocateIncoming(input: { flats: readonly HousingFlat[]; stays: readonly HousingStay[]; people: readonly HousingPerson[]; incoming: readonly IncomingWorker[]; horizonDays?: number }): AllocationResult {
  const people = new Map(input.people.map((p) => [p.workerId, p]))
  const firstStart = input.incoming.reduce((m, w) => minDate(m, w.startDate), "9999-12-31")
  const horizonEnd = addDays(firstStart === "9999-12-31" ? "2000-01-01" : firstStart, input.horizonDays ?? 120)
  let stays = [...input.stays]
  const placed: AllocationResult["placed"] = []
  const unplaced: AllocationResult["unplaced"] = []
  // Biggest nationality groups first, then by start; drivers lead their group.
  const size = new Map<string, number>()
  for (const w of input.incoming) {
    const nat = people.get(w.workerId)?.nationality ?? ""
    size.set(nat, (size.get(nat) ?? 0) + 1)
  }
  const order = [...input.incoming].sort((a, b) => {
    const pa = people.get(a.workerId)
    const pb = people.get(b.workerId)
    const na = pa?.nationality ?? ""
    const nb = pb?.nationality ?? ""
    return (size.get(nb) ?? 0) - (size.get(na) ?? 0) || na.localeCompare(nb) || Number(pb?.canDrive ?? false) - Number(pa?.canDrive ?? false) || a.startDate.localeCompare(b.startDate) || a.workerId.localeCompare(b.workerId)
  })
  const team = new Set(input.incoming.map((w) => w.workerId))
  for (const w of order) {
    const person = people.get(w.workerId)
    if (!person) {
      unplaced.push({ workerId: w.workerId, reason: "unknown_worker" })
      continue
    }
    if (!input.flats.some((f) => !f.projectId && f.region === w.region)) {
      unplaced.push({ workerId: w.workerId, reason: "no_flat_in_region" })
      continue
    }
    const { ranked, anyBed } = rankFlats({ flats: input.flats, stays, people, horizonEnd }, person, w, w.region, { mates: team })
    const best = ranked[0]
    if (!best) {
      unplaced.push({ workerId: w.workerId, reason: anyBed ? "no_compatible_flat" : "no_free_bed" })
      continue
    }
    const stay = { workerId: w.workerId, accommodationId: best.flat.id, startDate: w.startDate, endDate: w.endDate }
    stays = [...stays, stay]
    placed.push(stay)
  }
  return { placed, unplaced }
}

// ---------------------------------------------------------------- flags

export const HOUSING_FLAGS = ["lonely", "empty", "under_occupied", "overfull", "no_common_language", "mixed_gender", "no_driver", "lease_ending"] as const
export type HousingFlagKind = (typeof HOUSING_FLAGS)[number]
export interface HousingFlag {
  kind: HousingFlagKind
  severity: "error" | "warning" | "info"
  count?: number
  capacity?: number
  date?: string
}

/** What the coordinator should look at for one flat (today's residents, the month's occupancy). */
export function flatFlags(flat: HousingFlat, stays: readonly HousingStay[], people: ReadonlyMap<string, HousingPerson>, today: string, month: FlatStats): HousingFlag[] {
  const out: HousingFlag[] = []
  const leased = covers({ startDate: flat.startDate, endDate: flat.endDate }, today)
  const ids = occupantsOn(flat.id, stays, today)
  if (leased && ids.length === 0) out.push({ kind: "empty", severity: "error", count: 0, capacity: flat.beds })
  else if (leased && ids.length === 1 && flat.beds >= 3) out.push({ kind: "lonely", severity: "error", count: 1, capacity: flat.beds })
  else if (leased && month.days > 0 && month.occupancy < 0.6) out.push({ kind: "under_occupied", severity: "warning", count: Math.round(month.occupancy * 100), capacity: flat.beds })
  if (ids.length > flat.beds) out.push({ kind: "overfull", severity: "error", count: ids.length, capacity: flat.beds })
  const residents = ids.map((id) => people.get(id)).filter((p): p is HousingPerson => Boolean(p))
  for (const issue of groupIssues(residents, { needsDriver: flat.hasVehicle ?? false })) out.push({ kind: issue, severity: issue === "no_driver" ? "warning" : "error" })
  if (flat.endDate >= today && flat.endDate <= addDays(today, 30)) out.push({ kind: "lease_ending", severity: "info", date: flat.endDate })
  return out
}

// ---------------------------------------------------------------- vehicles

export const VEHICLE_LOG_KINDS = ["fuel", "trip", "service"] as const
export type VehicleLogKind = (typeof VEHICLE_LOG_KINDS)[number]
export interface CostVehicle {
  id: string
  costCents: number
  costPeriod: VehicleCostPeriod
  startDate: string
  endDate: string
  projectId?: string | null
  accommodationId?: string | null
}
export interface VehicleLogEntry {
  vehicleId: string
  date: string
  kind: VehicleLogKind
  /** Distance driven (km). */
  km: number
  litres: number
  costCents: number
}
export interface VehicleStats {
  fixedCents: number
  fuelCents: number
  serviceCents: number
  totalCents: number
  km: number
  litres: number
  costPerKmCents: number | null
  litresPer100Km: number | null
}

/** A vehicle's money and kilometres over `[from, to]`: rent/lease share + fuel + service from the log. */
export function vehicleStats(v: CostVehicle, logs: readonly VehicleLogEntry[], from: string, to: string): VehicleStats {
  let fixed = 0
  for (const day of daysIn(maxDate(from, v.startDate), minDate(to, v.endDate))) fixed += dayCostCents(v.costCents, v.costPeriod, day)
  const mine = logs.filter((l) => l.vehicleId === v.id && l.date >= from && l.date <= to)
  const fuel = mine.filter((l) => l.kind === "fuel").reduce((s, l) => s + l.costCents, 0)
  const other = mine.filter((l) => l.kind !== "fuel").reduce((s, l) => s + l.costCents, 0)
  const km = mine.reduce((s, l) => s + l.km, 0)
  const litres = mine.reduce((s, l) => s + l.litres, 0)
  const total = Math.round(fixed) + fuel + other
  return {
    fixedCents: Math.round(fixed),
    fuelCents: fuel,
    serviceCents: other,
    totalCents: total,
    km,
    litres: Math.round(litres * 10) / 10,
    costPerKmCents: km > 0 ? Math.round(total / km) : null,
    litresPer100Km: km > 0 && litres > 0 ? Math.round((litres / km) * 1000) / 10 : null,
  }
}

// ---------------------------------------------------------------- costs per project

/** A worker on a project for a period (confirmed/active assignment). */
export interface WorkerProjectSpan {
  workerId: string
  projectId: string
  startDate: string
  endDate: string | null
}
export interface ProjectHousingCost {
  projectId: string
  /** The project's share of flat rent (its people's beds plus their share of empty beds). */
  accommodationCents: number
  /** Part of `accommodationCents` paid for empty beds. */
  emptyBedCents: number
  vehicleCents: number
  bedNights: number
}
export interface HousingCostSplit {
  projects: ProjectHousingCost[]
  /** Cost nobody can be charged with (empty flats, cars without riders, workers between projects). */
  unallocatedCents: number
  totalCents: number
}

/**
 * Splits flat and vehicle costs of `[from, to]` over projects. Each day a
 * flat's cost is shared equally by the people sleeping there and charged to
 * the project each of them works on that day (empty beds included). Empty
 * legacy flats go to their project. A vehicle goes to its project, else to
 * the projects of its flat's residents that day.
 */
export function allocateHousingCosts(input: { flats: readonly HousingFlat[]; stays: readonly HousingStay[]; spans: readonly WorkerProjectSpan[]; vehicles: readonly CostVehicle[]; logs: readonly VehicleLogEntry[]; from: string; to: string }): HousingCostSplit {
  const by = new Map<string, { acc: number; empty: number; veh: number; nights: number }>()
  const add = (projectId: string, k: "acc" | "empty" | "veh" | "nights", n: number) => {
    const e = by.get(projectId) ?? { acc: 0, empty: 0, veh: 0, nights: 0 }
    e[k] += n
    by.set(projectId, e)
  }
  let unallocated = 0
  let total = 0
  const spansOf = new Map<string, WorkerProjectSpan[]>()
  for (const s of input.spans) spansOf.set(s.workerId, [...(spansOf.get(s.workerId) ?? []), s])
  const projectOn = (workerId: string, day: string) => spansOf.get(workerId)?.find((s) => covers(s, day))?.projectId ?? null
  const residentProjects = new Map<string, (string | null)[]>() // `${flatId}|${day}` → projects of residents

  for (const f of input.flats) {
    const mine = input.stays.filter((s) => s.accommodationId === f.id && overlaps(s, input.from, input.to))
    for (const day of daysIn(maxDate(input.from, f.startDate), minDate(input.to, f.endDate))) {
      const c = dayCostCents(f.costCents, f.costPeriod, day)
      total += c
      const ids = [...new Set(mine.filter((s) => covers(s, day)).map((s) => s.workerId))]
      const projects = ids.map((id) => projectOn(id, day) ?? f.projectId ?? null)
      residentProjects.set(`${f.id}|${day}`, projects)
      if (ids.length === 0) {
        if (f.projectId) {
          add(f.projectId, "acc", c)
          add(f.projectId, "empty", c)
        } else unallocated += c
        continue
      }
      const share = c / ids.length
      const emptyShare = (c * Math.max(f.beds - ids.length, 0)) / Math.max(f.beds, 1) / ids.length
      for (const p of projects) {
        if (!p) {
          unallocated += share
          continue
        }
        add(p, "acc", share)
        add(p, "empty", emptyShare)
        add(p, "nights", 1)
      }
    }
  }

  for (const v of input.vehicles) {
    const logsByDay = new Map<string, number>()
    for (const l of input.logs) if (l.vehicleId === v.id && l.date >= input.from && l.date <= input.to) logsByDay.set(l.date, (logsByDay.get(l.date) ?? 0) + l.costCents)
    const leased = new Set(daysIn(maxDate(input.from, v.startDate), minDate(input.to, v.endDate)))
    for (const day of new Set([...leased, ...logsByDay.keys()])) {
      const c = (leased.has(day) ? dayCostCents(v.costCents, v.costPeriod, day) : 0) + (logsByDay.get(day) ?? 0)
      if (c === 0) continue
      total += c
      if (v.projectId) {
        add(v.projectId, "veh", c)
        continue
      }
      const riders = v.accommodationId ? (residentProjects.get(`${v.accommodationId}|${day}`) ?? []) : []
      if (riders.length === 0) {
        unallocated += c
        continue
      }
      for (const p of riders) {
        if (p) add(p, "veh", c / riders.length)
        else unallocated += c / riders.length
      }
    }
  }

  const projects = [...by.entries()]
    .map(([projectId, e]) => ({ projectId, accommodationCents: Math.round(e.acc), emptyBedCents: Math.round(e.empty), vehicleCents: Math.round(e.veh), bedNights: e.nights }))
    .sort((a, b) => b.accommodationCents + b.vehicleCents - (a.accommodationCents + a.vehicleCents))
  return { projects, unallocatedCents: Math.round(unallocated), totalCents: Math.round(total) }
}
