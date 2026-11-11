// Pure logic of the timesheets area (browser-safe, unit-tested): weeks and
// hours, reading a client's timesheet table, fuzzy worker-name matching, the
// reconciliation of client rows against our own entries, and when a client's
// timesheet is late.
import { addDays, addMonths, daysBetween, fold, isIsoDate } from "../pure"

export const TIMESHEET_CADENCES = ["weekly", "biweekly", "monthly"] as const
export type TimesheetCadence = (typeof TIMESHEET_CADENCES)[number]

export const CLIENT_SHEET_SOURCES = ["csv", "xlsx", "pdf", "image", "manual"] as const
export type ClientSheetSource = (typeof CLIENT_SHEET_SOURCES)[number]

/** `parsing` (AI running), `ready` (rows present), `ai_not_configured` / `failed` (enter rows by hand). */
export const CLIENT_SHEET_STATUSES = ["parsing", "ready", "ai_not_configured", "failed"] as const
export type ClientSheetStatus = (typeof CLIENT_SHEET_STATUSES)[number]

export const RESOLUTION_ACTIONS = ["accept_client", "keep_ours", "note"] as const
export type ResolutionAction = (typeof RESOLUTION_ACTIONS)[number]

export const REMINDER_STATUSES = ["queued", "sent", "not_configured", "no_contact", "failed"] as const
export type ReminderStatus = (typeof REMINDER_STATUSES)[number]

/** Hours above this per day count as overtime when a total is split. */
export const REGULAR_DAY_HOURS = 8
/** Hours are kept to a quarter hour. */
export const roundHours = (h: number): number => Math.round(h * 4) / 4

// ---------------------------------------------------------------- weeks

/** 0 = Monday … 6 = Sunday. */
export const weekday = (date: string): number => (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7
export const isWeekend = (date: string): boolean => weekday(date) >= 5
/** The Monday of the ISO week holding `date`. */
export const weekStartOf = (date: string): string => addDays(date, -weekday(date))
/** The seven days Monday … Sunday from a week start. */
export const weekDays = (weekStart: string): string[] => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))

/** ISO week number (1–53) of a date. */
export function isoWeek(date: string): number {
  const thursday = addDays(date, 3 - weekday(date))
  const jan1 = `${thursday.slice(0, 4)}-01-01`
  return Math.floor(daysBetween(jan1, thursday) / 7) + 1
}

/** Splits a day's total into regular hours (up to `cap`) and overtime. */
export function splitHours(total: number, cap = REGULAR_DAY_HOURS): { regular: number; overtime: number } {
  const t = roundHours(Math.max(0, total))
  return { regular: Math.min(t, cap), overtime: roundHours(Math.max(0, t - cap)) }
}

/** `null` when valid, otherwise the reason. */
export function hoursProblem(regular: number, overtime: number): string | null {
  for (const h of [regular, overtime]) if (!Number.isFinite(h) || h < 0 || h > 24) return "invalid_hours"
  if (roundHours(regular) !== regular || roundHours(overtime) !== overtime) return "invalid_hours_step"
  if (regular + overtime > 24) return "too_many_hours"
  return null
}

// ---------------------------------------------------------------- reading cells

/** A day from a spreadsheet or text cell: ISO, `dd.mm.yyyy`, `dd/mm/yyyy`, `dd.mm.` (with `year`), Excel serials, Dates. */
export function parseDateCell(value: unknown, year?: number): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    // Spreadsheet readers give local midnight: keep the local calendar day.
    return new Date(Date.UTC(value.getFullYear(), value.getMonth(), value.getDate())).toISOString().slice(0, 10)
  }
  if (typeof value === "number" && value > 30000 && value < 80000) return addDays("1899-12-30", Math.floor(value))
  if (typeof value !== "string") return null
  const s = value.trim()
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (iso) return pad(Number(iso[1]), Number(iso[2]), Number(iso[3]))
  const eu = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/)
  if (eu) {
    const y = Number(eu[3])
    return pad(y < 100 ? 2000 + y : y, Number(eu[2]), Number(eu[1]))
  }
  const short = s.match(/^(\d{1,2})[./](\d{1,2})\.?$/)
  if (short && year) return pad(year, Number(short[2]), Number(short[1]))
  return null
}

function pad(y: number, m: number, d: number): string | null {
  const s = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`
  return isIsoDate(s) ? s : null
}

/** Hours from `8`, `8,5`, `7.5`, `7:30`, `8h`. `null` when not a number; blanks are `null`. */
export function parseHoursCell(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 && value <= 24 ? roundHours(value) : null
  if (typeof value !== "string") return null
  const s = value.trim().toLowerCase().replace(/\s*(h|val\.?|t|std\.?)$/, "")
  if (!s) return null
  const hm = s.match(/^(\d{1,2}):(\d{2})$/)
  if (hm) return roundHours(Number(hm[1]) + Number(hm[2]) / 60)
  if (!/^\d{1,2}([.,]\d+)?$/.test(s)) return null
  const n = Number(s.replace(",", "."))
  return n <= 24 ? roundHours(n) : null
}

export interface ClientRowInput {
  name: string
  date: string
  hours: number
}

const NAME_HEADERS = ["name", "worker", "employee", "vardas", "pavarde", "darbuotojas", "navn", "ansatt", "medarbejder", "mitarbeiter", "nimi", "imie", "nazwisko"]
const DATE_HEADERS = ["date", "data", "dato", "datum", "paiva", "day", "diena"]
const HOURS_HEADERS = ["hours", "hrs", "valandos", "val", "timer", "stunden", "std", "tunnit", "godziny", "total"]

const headerIs = (cell: unknown, words: string[]) => typeof cell === "string" && words.some((w) => fold(cell).replace(/[^a-z ]/g, " ").split(/\s+/).includes(w))

/**
 * Reads a client's timesheet table (rows of cells from CSV or a spreadsheet).
 * Two shapes: long (`name | date | hours` columns, a header row anywhere in the
 * first 20 rows) and wide (`name | 03.11 | 04.11 | …`, one row per worker).
 * `year` completes dates written without one. Zero-hour cells are skipped.
 */
export function rowsFromTable(table: readonly (readonly unknown[])[], opts: { year?: number } = {}): ClientRowInput[] {
  for (let h = 0; h < Math.min(table.length, 20); h++) {
    const header = table[h] ?? []
    const nameCol = header.findIndex((c) => headerIs(c, NAME_HEADERS))
    if (nameCol < 0) continue
    const dateCol = header.findIndex((c) => headerIs(c, DATE_HEADERS))
    const hoursCol = header.findIndex((c) => headerIs(c, HOURS_HEADERS))
    const out: ClientRowInput[] = []
    if (dateCol >= 0 && hoursCol >= 0) {
      for (const row of table.slice(h + 1)) {
        const name = cellText(row[nameCol])
        const date = parseDateCell(row[dateCol], opts.year)
        const hours = parseHoursCell(row[hoursCol])
        if (name && date && hours) out.push({ name, date, hours })
      }
      return out
    }
    const dateCols = header.map((c, i) => ({ i, date: i === nameCol ? null : parseDateCell(c, opts.year) })).filter((c): c is { i: number; date: string } => c.date !== null)
    if (dateCols.length === 0) continue
    for (const row of table.slice(h + 1)) {
      const name = cellText(row[nameCol])
      if (!name || headerIs(name, ["total", "viso", "sum", "summe", "i alt"])) continue
      for (const { i, date } of dateCols) {
        const hours = parseHoursCell(row[i])
        if (hours) out.push({ name, date, hours })
      }
    }
    return out
  }
  return []
}

const cellText = (c: unknown): string => (typeof c === "string" ? c.trim().replace(/\s+/g, " ") : typeof c === "number" ? String(c) : "")

/** Minimal CSV reader (`,` or `;` separated, quoted fields). */
export function parseCsv(text: string): string[][] {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? ""
  const sep = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ";" : (firstLine.match(/\t/g)?.length ?? 0) > 0 && !firstLine.includes(",") ? "\t" : ","
  const rows: string[][] = []
  let row: string[] = []
  let cell = ""
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"'
        i++
      } else if (ch === '"') quoted = false
      else cell += ch
    } else if (ch === '"' && cell === "") quoted = true
    else if (ch === sep) {
      row.push(cell)
      cell = ""
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++
      row.push(cell)
      rows.push(row)
      row = []
      cell = ""
    } else cell += ch
  }
  if (cell || row.length) {
    row.push(cell)
    rows.push(row)
  }
  return rows.filter((r) => r.some((c) => c.trim()))
}

// ---------------------------------------------------------------- name matching

const tokens = (s: string) =>
  fold(s)
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter(Boolean)

function levenshtein(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]!
    prev[0] = i
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j]!
      prev[j] = Math.min(prev[j]! + 1, prev[j - 1]! + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1))
      diag = tmp
    }
  }
  return prev[b.length]!
}

const similar = (a: string, b: string) => (a.length && b.length ? 1 - levenshtein(a, b) / Math.max(a.length, b.length) : 0)

/**
 * How well a written name matches a worker (0–1). Order-free, accents and case
 * ignored; an initial (`J.`) matches a first name; small typos are tolerated
 * (`Zrazkovich Sergii` ≈ Serhii Zrazkovych).
 */
export function nameScore(written: string, worker: { firstName: string; lastName: string }): number {
  const w = tokens(written)
  const first = tokens(worker.firstName)
  const last = tokens(worker.lastName)
  if (!w.length || !last.length) return 0
  const lastJoined = last.join(" ")
  // Best token for the last name (or the joined surname for double names).
  const lastScore = Math.max(...w.map((t) => similar(t, lastJoined.replace(/ /g, ""))), ...last.map((l) => Math.max(...w.map((t) => similar(t, l)))))
  const rest = w.filter((t) => !last.some((l) => similar(t, l) >= 0.8))
  let firstScore = 0.5 // no first name written: surname alone
  if (rest.length && first.length) {
    firstScore = Math.max(
      ...rest.map((t) =>
        Math.max(
          ...first.map((f) => (t.length === 1 ? (f.startsWith(t) ? 0.9 : 0) : similar(t, f))),
        ),
      ),
    )
  }
  return Math.round((lastScore * 0.65 + firstScore * 0.35) * 1000) / 1000
}

export const NAME_MATCH_THRESHOLD = 0.75

export interface MatchCandidate {
  id: string
  firstName: string
  lastName: string
}

/** The best worker for a written name, if it clears the threshold and is not a tie. */
export function matchWorker<W extends MatchCandidate>(written: string, workers: readonly W[]): { worker: W; score: number } | null {
  let best: { worker: W; score: number } | null = null
  let second = 0
  for (const worker of workers) {
    const score = nameScore(written, worker)
    if (!best || score > best.score) {
      second = best?.score ?? 0
      best = { worker, score }
    } else if (score > second) second = score
  }
  if (!best || best.score < NAME_MATCH_THRESHOLD || best.score - second < 0.05) return null
  return best
}

// ---------------------------------------------------------------- reconciliation

export type ReconcileKind = "ok" | "diff" | "missing_ours" | "missing_theirs" | "unknown_worker"

export interface OwnDay {
  workerId: string
  date: string
  hours: number
}

export interface ReconcileLine {
  key: string
  kind: ReconcileKind
  workerId: string | null
  /** As written by the client (null when the client has no row). */
  clientName: string | null
  date: string
  ours: number | null
  theirs: number | null
  /** theirs − ours (missing side counts as 0). */
  diff: number
}

export interface Reconciliation {
  names: { clientName: string; workerId: string | null; score: number; manual: boolean }[]
  lines: ReconcileLine[]
  totals: { ours: number; theirs: number; mismatches: number }
}

export const reconcileKey = (workerId: string | null, date: string, clientName?: string | null) => `${workerId ?? `?${clientName ?? ""}`}|${date}`

/**
 * Compares the client's rows with our entries per worker per day within
 * `[from, to]`. Client names map to workers via `nameMap` (manual choices) or
 * fuzzy matching against `workers`. Lines come sorted by worker name, then
 * date; `ok` lines included so the UI can show the full picture.
 */
export function reconcile(input: { from: string; to: string; workers: readonly MatchCandidate[]; ours: readonly OwnDay[]; theirs: readonly ClientRowInput[]; nameMap?: Readonly<Record<string, string>> }): Reconciliation {
  const inRange = (d: string) => d >= input.from && d <= input.to
  const names = new Map<string, Reconciliation["names"][number]>()
  for (const r of input.theirs) {
    if (names.has(r.name)) continue
    const manual = input.nameMap?.[r.name]
    if (manual) names.set(r.name, { clientName: r.name, workerId: manual, score: 1, manual: true })
    else {
      const m = matchWorker(r.name, input.workers)
      names.set(r.name, { clientName: r.name, workerId: m?.worker.id ?? null, score: m?.score ?? 0, manual: false })
    }
  }
  const theirs = new Map<string, { hours: number; clientName: string; workerId: string | null; date: string }>()
  for (const r of input.theirs) {
    if (!inRange(r.date)) continue
    const workerId = names.get(r.name)!.workerId
    const key = reconcileKey(workerId, r.date, r.name)
    const prev = theirs.get(key)
    theirs.set(key, { hours: roundHours((prev?.hours ?? 0) + r.hours), clientName: r.name, workerId, date: r.date })
  }
  const ours = new Map<string, OwnDay>()
  for (const o of input.ours) {
    if (!inRange(o.date) || o.hours <= 0) continue
    const key = reconcileKey(o.workerId, o.date)
    const prev = ours.get(key)
    ours.set(key, { ...o, hours: roundHours((prev?.hours ?? 0) + o.hours) })
  }
  const lines: ReconcileLine[] = []
  for (const [key, t] of theirs) {
    const o = t.workerId ? ours.get(key) : undefined
    const kind: ReconcileKind = !t.workerId ? "unknown_worker" : !o ? "missing_ours" : o.hours === t.hours ? "ok" : "diff"
    lines.push({ key, kind, workerId: t.workerId, clientName: t.clientName, date: t.date, ours: o?.hours ?? null, theirs: t.hours, diff: roundHours(t.hours - (o?.hours ?? 0)) })
  }
  for (const [key, o] of ours) {
    if (theirs.has(key)) continue
    lines.push({ key, kind: "missing_theirs", workerId: o.workerId, clientName: null, date: o.date, ours: o.hours, theirs: null, diff: -o.hours })
  }
  const nameOf = new Map(input.workers.map((w) => [w.id, `${w.lastName} ${w.firstName}`]))
  lines.sort((a, b) => (a.workerId ? (nameOf.get(a.workerId) ?? "") : `~${a.clientName}`).localeCompare(b.workerId ? (nameOf.get(b.workerId) ?? "") : `~${b.clientName}`) || a.date.localeCompare(b.date))
  const sum = (xs: (number | null)[]) => roundHours(xs.reduce<number>((s, x) => s + (x ?? 0), 0))
  return {
    names: [...names.values()],
    lines,
    totals: { ours: sum(lines.map((l) => l.ours)), theirs: sum(lines.map((l) => l.theirs)), mismatches: lines.filter((l) => l.kind !== "ok").length },
  }
}

// ---------------------------------------------------------------- late client timesheets

export interface DueInput {
  cadence: TimesheetCadence
  /** Days after the period end the client has to send it. */
  graceDays: number
  projectStart: string
  /** The last day covered by a received client timesheet, if any. */
  lastReceivedTo: string | null
  today: string
}

export interface DueState {
  /** The last completed period's last day (`null` when no period ended yet). */
  expectedTo: string | null
  /** First day not covered by a received timesheet. */
  missingFrom: string | null
  dueDate: string | null
  late: boolean
  daysLate: number
}

/** The end of the latest period that finished before `today`. Weeks start on Monday; bi-weekly periods count from the project's first week. */
export function lastCompletedPeriodEnd(cadence: TimesheetCadence, projectStart: string, today: string): string | null {
  let end: string
  if (cadence === "monthly") end = addDays(`${today.slice(0, 7)}-01`, -1)
  else if (cadence === "weekly") end = addDays(weekStartOf(today), -1)
  else {
    const anchor = weekStartOf(projectStart)
    const periods = Math.floor(daysBetween(anchor, today) / 14)
    end = addDays(anchor, periods * 14 - 1)
  }
  return end >= projectStart ? end : null
}

export function timesheetDue(i: DueInput): DueState {
  const expectedTo = lastCompletedPeriodEnd(i.cadence, i.projectStart, i.today)
  if (!expectedTo || (i.lastReceivedTo && i.lastReceivedTo >= expectedTo)) return { expectedTo, missingFrom: null, dueDate: null, late: false, daysLate: 0 }
  const missingFrom = i.lastReceivedTo && i.lastReceivedTo >= i.projectStart ? addDays(i.lastReceivedTo, 1) : i.projectStart
  const dueDate = addDays(expectedTo, i.graceDays)
  const daysLate = Math.max(0, daysBetween(dueDate, i.today))
  return { expectedTo, missingFrom, dueDate, late: daysLate > 0, daysLate }
}

/** Default period covered by a client timesheet ending at `periodEnd`. */
export function periodStart(cadence: TimesheetCadence, periodEnd: string): string {
  if (cadence === "weekly") return addDays(periodEnd, -6)
  if (cadence === "biweekly") return addDays(periodEnd, -13)
  return addDays(addMonths(addDays(periodEnd, 1), -1), 0)
}
