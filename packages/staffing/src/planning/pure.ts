// The weekly planning board and the quick capacity answer of the "planning"
// area: pure, no Convex, unit-tested. Safe to import from the browser
// (`@digimuza/staffing/planning/pure`).
//
// Two levels of planning (interview, 06:03): projects, and every worker as a
// timeline of their own (project → rest at home → next project). The board
// replaces the weekly Excel: per week, who is free (own reserve, people freed
// by ending projects, people back from rest, subcontractor capacity) against
// what open client requests need.
import { addDays, availabilityBlocks, availabilityCovers, daysBetween, isBlockingAssignment, rangeCovers, rangesOverlap, type AssignmentStatus, type AvailabilityKind, type WorkerSource } from "../pure"

// ---------------------------------------------------------------- weeks

/** Monday of the ISO week holding `date`. */
export function mondayOf(date: string): string {
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay() // 0 = Sunday
  return addDays(date, dow === 0 ? -6 : 1 - dow)
}

/** The next Monday after `date` (a Monday gives the following one). */
export const nextMonday = (date: string): string => addDays(mondayOf(date), 7)

/** ISO week number (1–53). */
function isoWeekNumber(date: string): number {
  const thursday = addDays(mondayOf(date), 3)
  const jan1 = `${thursday.slice(0, 4)}-01-01`
  return Math.floor(daysBetween(jan1, thursday) / 7) + 1
}

export interface Week {
  /** Monday. */
  start: string
  /** Sunday. */
  end: string
  number: number
}

/** `count` weeks from the week holding `from`. */
export function weeksFrom(from: string, count: number): Week[] {
  const first = mondayOf(from)
  return Array.from({ length: Math.max(0, count) }, (_, i) => {
    const start = addDays(first, i * 7)
    return { start, end: addDays(start, 6), number: isoWeekNumber(start) }
  })
}

// ---------------------------------------------------------------- inputs

export interface PlanWorker {
  id: string
  name: string
  nationality: string
  languages: readonly string[]
  source: WorkerSource
  subcontractorClientId: string | null
  /** Trade IDs, main trade first. */
  tradeIds: readonly string[]
}
export interface PlanAssignment {
  workerId: string
  projectId: string
  projectCode: string
  clientId: string | null
  startDate: string
  endDate: string | null
  status: AssignmentStatus
}
export interface PlanAvailability {
  id?: string
  workerId: string
  kind: AvailabilityKind
  startDate: string
  endDate: string | null
  note?: string
}
/** A subcontractor's declared capacity: how many people of a trade it can supply, and when. */
export interface PlanCapacity {
  clientId: string
  clientName: string
  tradeId: string
  count: number
  validFrom: string
  validTo: string | null
}
/** Open demand: a client request line (people of a trade for a period). */
export interface PlanDemand {
  requestId: string
  clientName: string
  label: string
  tradeId: string
  count: number
  startDate: string
  endDate: string | null
}

export interface PlanData {
  workers: readonly PlanWorker[]
  assignments: readonly PlanAssignment[]
  availability: readonly PlanAvailability[]
  capacities: readonly PlanCapacity[]
  demand: readonly PlanDemand[]
}

// ---------------------------------------------------------------- one worker's timeline

const live = (a: PlanAssignment) => a.status !== "cancelled" && a.status !== "ended"

/** Not on a blocking assignment and not away on any day of the range. */
export function isFree(workerId: string, range: { startDate: string; endDate: string | null }, data: Pick<PlanData, "assignments" | "availability">): boolean {
  return (
    !data.assignments.some((a) => a.workerId === workerId && isBlockingAssignment(a) && rangesOverlap(a, range)) &&
    !data.availability.some((p) => p.workerId === workerId && availabilityBlocks(p, range))
  )
}

export const WORKER_STATES = ["working", "resting", "unavailable", "reserve"] as const
export type WorkerState = (typeof WORKER_STATES)[number]

export interface WorkerPlanStatus {
  /** `working` (Dirba), `resting` (Namuose, ilsisi), `unavailable`, `reserve` (Rezerve, pasiruošęs). */
  state: WorkerState
  /** Last day of the current project or rest; the first day available for `available_from`. */
  until: string | null
  projectCode: string | null
  /** The next planned thing after today: a project start or a rest. */
  next: { kind: "project" | AvailabilityKind; startDate: string; label: string } | null
}

/** Where the worker is on `day`: on a project, home resting, unavailable, or in reserve. */
export function workerStatusOn(workerId: string, day: string, data: Pick<PlanData, "assignments" | "availability">): WorkerPlanStatus {
  const mine = data.assignments.filter((a) => a.workerId === workerId && live(a))
  const away = data.availability.filter((p) => p.workerId === workerId)
  const working = mine.filter((a) => isBlockingAssignment(a) && rangeCovers(a, day)).sort((a, b) => (b.endDate ?? "9999").localeCompare(a.endDate ?? "9999"))[0]
  const off = away.find((p) => availabilityCovers(p, day))
  const nextProject = mine.filter((a) => a.startDate > day).sort((a, b) => a.startDate.localeCompare(b.startDate))[0]
  const nextAway = away.filter((p) => p.kind !== "available_from" && p.startDate > day).sort((a, b) => a.startDate.localeCompare(b.startDate))[0]
  const next =
    nextAway && (!nextProject || nextAway.startDate < nextProject.startDate)
      ? { kind: nextAway.kind, startDate: nextAway.startDate, label: nextAway.note ?? "" }
      : nextProject
        ? { kind: "project" as const, startDate: nextProject.startDate, label: nextProject.projectCode }
        : null
  if (working) return { state: "working", until: working.endDate, projectCode: working.projectCode, next }
  if (off) {
    const until = off.kind === "available_from" ? off.startDate : off.endDate
    return { state: off.kind === "rest" ? "resting" : "unavailable", until, projectCode: null, next }
  }
  return { state: "reserve", until: null, projectCode: null, next }
}

export const CELL_STATES = ["project", "ending", "proposed", "rest", "unavailable", "free"] as const
export type CellState = (typeof CELL_STATES)[number]

export interface WeekCell {
  state: CellState
  /** Project code (project, ending, proposed) or the note of the rest. */
  label: string | null
  /** Last day of the project or rest when it ends inside the week. */
  until: string | null
}

/**
 * One worker's week: on a project (`ending` when it ends inside the week and
 * the rest of the week is free), proposed for one (not blocking), resting,
 * unavailable, or free for the whole week.
 */
export function weekCell(workerId: string, week: Week, data: Pick<PlanData, "assignments" | "availability">): WeekCell {
  const range = { startDate: week.start, endDate: week.end }
  const mine = data.assignments.filter((a) => a.workerId === workerId && live(a) && rangesOverlap(a, range))
  const blocking = mine.filter(isBlockingAssignment).sort((a, b) => (b.endDate ?? "9999").localeCompare(a.endDate ?? "9999"))[0]
  if (blocking) {
    const ends = blocking.endDate && blocking.endDate < week.end ? blocking.endDate : null
    return { state: ends ? "ending" : "project", label: blocking.projectCode, until: ends }
  }
  const away = data.availability.filter((p) => p.workerId === workerId && availabilityBlocks(p, range))
  const rest = away.find((p) => p.kind === "rest") ?? away[0]
  if (rest) {
    const until = rest.kind === "available_from" ? addDays(rest.startDate, -1) : rest.endDate
    return { state: rest.kind === "rest" ? "rest" : "unavailable", label: rest.note || null, until: until && until < week.end ? until : null }
  }
  const proposed = mine.find((a) => a.status === "proposed")
  if (proposed) return { state: "proposed", label: proposed.projectCode, until: null }
  return { state: "free", label: null, until: null }
}

// ---------------------------------------------------------------- supply vs demand

export interface TradeWeek {
  tradeId: string
  /** Own workers free for the whole week (main trade). */
  own: number
  /** Subcontractors: per company the larger of declared capacity and their registered free workers. */
  subcontractor: number
  supply: number
  demand: number
  /** supply − demand (negative: shortfall). */
  gap: number
}
export interface BoardWeek extends Week {
  trades: TradeWeek[]
  supply: number
  demand: number
  gap: number
  /** Free this week because their project ended the week before / they came back from rest. */
  freed: number
  back: number
}

const capacityValid = (c: PlanCapacity, range: { startDate: string; endDate: string | null }) => rangesOverlap({ startDate: c.validFrom, endDate: c.validTo }, range)

/** Subcontractor supply per trade for a range: per company, max(declared capacity, registered free workers). */
function subcontractorSupply(free: readonly PlanWorker[], capacities: readonly PlanCapacity[], range: { startDate: string; endDate: string | null }, tradeIds: ReadonlySet<string>, mainTradeOnly: boolean) {
  const declared = new Map<string, number>()
  for (const c of capacities) if (tradeIds.has(c.tradeId) && capacityValid(c, range)) declared.set(c.clientId, (declared.get(c.clientId) ?? 0) + c.count)
  const registered = new Map<string, number>()
  for (const w of free) {
    if (w.source !== "subcontractor") continue
    const has = mainTradeOnly ? tradeIds.has(w.tradeIds[0] ?? "") : w.tradeIds.some((t) => tradeIds.has(t))
    if (has) registered.set(w.subcontractorClientId ?? "?", (registered.get(w.subcontractorClientId ?? "?") ?? 0) + 1)
  }
  const companies = new Set([...declared.keys(), ...registered.keys()])
  const per = [...companies].map((id) => ({ clientId: id, declared: declared.get(id) ?? 0, registered: registered.get(id) ?? 0, count: Math.max(declared.get(id) ?? 0, registered.get(id) ?? 0) }))
  return { total: per.reduce((s, x) => s + x.count, 0), per }
}

/**
 * Supply against demand per week and trade. Supply: workers free for the
 * whole week counted once under their main trade (own) plus subcontractor
 * capacity valid that week. Demand: open request lines overlapping the week.
 */
export function supplyDemand(weeks: readonly Week[], data: PlanData, tradeIds: readonly string[]): BoardWeek[] {
  return weeks.map((week) => {
    const range = { startDate: week.start, endDate: week.end }
    const free = data.workers.filter((w) => isFree(w.id, range, data))
    const trades = tradeIds.map((tradeId) => {
      const own = free.filter((w) => w.source === "own" && w.tradeIds[0] === tradeId).length
      const subcontractor = subcontractorSupply(free, data.capacities, range, new Set([tradeId]), true).total
      const demand = data.demand.filter((d) => d.tradeId === tradeId && rangesOverlap(d, range)).reduce((s, d) => s + d.count, 0)
      return { tradeId, own, subcontractor, supply: own + subcontractor, demand, gap: own + subcontractor - demand }
    })
    // New in this week's supply: a project or a rest ended during the week before (and the worker is free now).
    const freeIds = new Set(free.map((w) => w.id))
    const before = { startDate: addDays(week.start, -7), endDate: addDays(week.start, -1) }
    const freed = new Set(data.assignments.filter((a) => (isBlockingAssignment(a) || a.status === "ended") && a.endDate && rangeCovers(before, a.endDate) && freeIds.has(a.workerId)).map((a) => a.workerId))
    const back = new Set(
      data.availability
        .filter((p) => (p.kind === "available_from" ? p.startDate > before.startDate && p.startDate <= week.start : p.endDate && rangeCovers(before, p.endDate)) && freeIds.has(p.workerId))
        .map((p) => p.workerId),
    )
    const supply = trades.reduce((s, t) => s + t.supply, 0)
    const demand = trades.reduce((s, t) => s + t.demand, 0)
    return { ...week, trades, supply, demand, gap: supply - demand, freed: freed.size, back: back.size }
  })
}

// ---------------------------------------------------------------- quick capacity answer

export interface CapacityQuestion {
  /** Any of these trades ("suvirintojai" = every welding trade). */
  tradeIds: readonly string[]
  count: number
  /** First day (e.g. next Monday). */
  from: string
  /** Last day; default: 4 weeks (the shortest project the company takes). */
  to?: string | null | undefined
  /** Today: "freed" and "back" count what changes between today and `from`. */
  today: string
}

export interface CapacityPerson {
  workerId: string
  name: string
  /** The day it changed: project end, rest end, or the day free later. */
  date: string | null
  label: string | null
}

export interface CapacityAnswer {
  question: { tradeIds: string[]; count: number; from: string; to: string }
  /** Own workers in reserve, free for the whole period. */
  ownFree: CapacityPerson[]
  /** Own workers whose project ends between today and `from`. */
  freedByEnding: CapacityPerson[]
  /** Own workers back from rest (or newly available) between today and `from`. */
  backFromRest: CapacityPerson[]
  /** Per subcontractor: max(declared capacity, its registered free workers). */
  subcontractors: { clientId: string; name: string; declared: number; registered: number; count: number }[]
  subcontractorTotal: number
  total: number
  shortfall: number
  /** Not free from `from`, but free within two weeks after it (project ends, back from rest). */
  freedLater: CapacityPerson[]
}

export const DEFAULT_PERIOD_DAYS = 28

/** How many people of the trades the company can field from `from`, and from where. */
export function capacityAnswer(q: CapacityQuestion, data: PlanData, names: { client: (id: string) => string } = { client: (id) => id }): CapacityAnswer {
  const to = q.to ?? addDays(q.from, DEFAULT_PERIOD_DAYS - 1)
  const range = { startDate: q.from, endDate: to }
  const trades = new Set(q.tradeIds)
  const fits = data.workers.filter((w) => w.tradeIds.some((t) => trades.has(t)))
  const ownFree: CapacityPerson[] = []
  const freedByEnding: CapacityPerson[] = []
  const backFromRest: CapacityPerson[] = []
  const freedLater: CapacityPerson[] = []
  const freeWorkers: PlanWorker[] = []
  for (const w of fits) {
    if (!isFree(w.id, range, data)) {
      // Free a little later? The first day within two weeks from which the rest of the period is free.
      if (w.source === "own")
        for (let d = 1; d <= 14; d++) {
          const day = addDays(q.from, d)
          if (day > to) break
          if (isFree(w.id, { startDate: day, endDate: to }, data)) {
            freedLater.push({ workerId: w.id, name: w.name, date: day, label: null })
            break
          }
        }
      continue
    }
    freeWorkers.push(w)
    if (w.source !== "own") continue
    const ended = data.assignments
      .filter((a) => a.workerId === w.id && a.status !== "cancelled" && isBlockingAssignmentOrEnded(a) && a.endDate && a.endDate >= q.today && a.endDate < q.from)
      .sort((a, b) => (b.endDate ?? "").localeCompare(a.endDate ?? ""))[0]
    if (ended) {
      freedByEnding.push({ workerId: w.id, name: w.name, date: ended.endDate, label: ended.projectCode })
      continue
    }
    const back = data.availability
      .filter((p) => p.workerId === w.id && (p.kind === "available_from" ? p.startDate > q.today && p.startDate <= q.from : p.endDate && p.endDate >= q.today && p.endDate < q.from))
      .sort((a, b) => b.startDate.localeCompare(a.startDate))[0]
    if (back) {
      backFromRest.push({ workerId: w.id, name: w.name, date: back.kind === "available_from" ? back.startDate : back.endDate, label: back.note || null })
      continue
    }
    ownFree.push({ workerId: w.id, name: w.name, date: null, label: null })
  }
  // Declared capacity counts when it is valid on the first day.
  const subs = subcontractorSupply(freeWorkers, data.capacities, { startDate: q.from, endDate: q.from }, trades, false)
  const subcontractors = subs.per.map((s) => ({ ...s, name: data.capacities.find((c) => c.clientId === s.clientId)?.clientName ?? names.client(s.clientId) })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
  const total = ownFree.length + freedByEnding.length + backFromRest.length + subs.total
  const byName = (a: CapacityPerson, b: CapacityPerson) => a.name.localeCompare(b.name)
  return {
    question: { tradeIds: [...q.tradeIds], count: q.count, from: q.from, to },
    ownFree: ownFree.sort(byName),
    freedByEnding: freedByEnding.sort(byName),
    backFromRest: backFromRest.sort(byName),
    subcontractors,
    subcontractorTotal: subs.total,
    total,
    shortfall: Math.max(0, q.count - total),
    freedLater: freedLater.sort((a, b) => (a.date ?? "").localeCompare(b.date ?? "") || byName(a, b)),
  }
}

const isBlockingAssignmentOrEnded = (a: PlanAssignment) => isBlockingAssignment(a) || a.status === "ended"

const LT_WEEKDAY = ["sekmadienio", "pirmadienio", "antradienio", "trečiadienio", "ketvirtadienio", "penktadienio", "šeštadienio"]
const EN_WEEKDAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
const dow = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay()

/** "nuo pirmadienio (2026-11-16)" / "from Monday 2026-11-16". */
export function fromDayText(date: string, locale: "lt" | "en"): string {
  return locale === "lt" ? `nuo ${LT_WEEKDAY[dow(date)]} (${date})` : `from ${EN_WEEKDAY[dow(date)]} ${date}`
}

/**
 * The answer in two short texts: `internal` (for the planner: where the
 * people come from) and `client` (copy into the reply to the client).
 */
export function capacityReply(a: CapacityAnswer, tradeLabel: { lt: string; en: string }, locale: "lt" | "en"): { internal: string; client: string } {
  const lt = locale === "lt"
  const n = a.question.count
  const from = fromDayText(a.question.from, locale)
  const can = Math.min(n, a.total)
  // freedLater is sorted by date: the day by which enough of them (up to the shortfall) are free.
  const extra = Math.min(a.shortfall, a.freedLater.length)
  const later = extra > 0 ? (a.freedLater[extra - 1]!.date ?? null) : null
  const first = a.freedLater[0]?.date ?? null
  const parts = lt
    ? [`savi laisvi ${a.ownFree.length}`, `atsilaisvina iš baigiamų projektų ${a.freedByEnding.length}`, `grįžta po poilsio ${a.backFromRest.length}`, `subranga ${a.subcontractorTotal}`]
    : [`own reserve ${a.ownFree.length}`, `freed by ending projects ${a.freedByEnding.length}`, `back from rest ${a.backFromRest.length}`, `subcontractors ${a.subcontractorTotal}`]
  const head = lt
    ? a.shortfall === 0
      ? `Taip: ${n} ${tradeLabel.lt} ${from} turime (iš viso galima ${a.total}).`
      : `Ne visus: ${from} galime ${can} iš ${n} ${tradeLabel.lt}, trūksta ${a.shortfall}.`
    : a.shortfall === 0
      ? `Yes: ${n} ${tradeLabel.en} ${from} are available (${a.total} possible in total).`
      : `Not all: ${from} we can field ${can} of ${n} ${tradeLabel.en}, ${a.shortfall} short.`
  const tail = a.freedLater.length && first ? (lt ? ` Per 2 sav. atsilaisvins dar ${a.freedLater.length} (pirmieji nuo ${first}).` : ` ${a.freedLater.length} more become free within 2 weeks (first from ${first}).`) : ""
  const internal = `${head} ${lt ? "Iš jų" : "Of these"}: ${parts.join(", ")}.${tail}`
  const client = lt
    ? a.shortfall === 0
      ? `Laba diena, taip – ${n} ${tradeLabel.lt} galime pateikti ${from}. Komandos sąrašą ir dokumentus atsiųsime šiandien.`
      : `Laba diena, ${from} galime pateikti ${can} ${tradeLabel.lt}${later ? `, dar ${extra} – nuo ${later}` : ""}. Likusias pozicijas patvirtinsime per 2 darbo dienas.`
    : a.shortfall === 0
      ? `Hello, yes – we can supply ${n} ${tradeLabel.en} ${from}. We will send the team list and documents today.`
      : `Hello, ${from} we can supply ${can} ${tradeLabel.en}${later ? `, and ${extra} more from ${later}` : ""}. We will confirm the remaining positions within 2 working days.`
  return { internal, client }
}
