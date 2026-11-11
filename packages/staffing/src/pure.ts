// Pure helpers and enums of the staffing module: no Convex, no I/O. Safe to
// import from the browser, from tests and from every staffing area.
//
// Conventions shared by every staffing table and area:
// - Dates are ISO calendar days, `YYYY-MM-DD` strings (no time, no zone).
//   Comparing two of them as strings compares them as dates.
// - A missing end date means "open-ended" (until further notice).
// - Date ranges are inclusive on both ends: 2026-01-01..2026-01-01 is one day.
// - Money is integer cents (`hourlyRateCents: 4250` = 42.50 EUR).

export const WORKER_STATUSES = ["active", "inactive"] as const
export type WorkerStatus = (typeof WORKER_STATUSES)[number]

export const WORKER_SOURCES = ["own", "subcontractor"] as const
export type WorkerSource = (typeof WORKER_SOURCES)[number]

/** How well a worker masters a trade, from least to most. */
export const TRADE_LEVELS = ["trainee", "skilled", "senior", "foreman"] as const
export type TradeLevel = (typeof TRADE_LEVELS)[number]

export const CLIENT_KINDS = ["client", "subcontractor", "both"] as const
export type ClientKind = (typeof CLIENT_KINDS)[number]

export const INVOICING_PERIODS = ["weekly", "biweekly", "monthly"] as const
export type InvoicingPeriod = (typeof INVOICING_PERIODS)[number]

export const PROJECT_STATUSES = ["draft", "active", "finished", "cancelled"] as const
export type ProjectStatus = (typeof PROJECT_STATUSES)[number]
/** Projects that still take new assignments. */
export const OPEN_PROJECT_STATUSES: readonly ProjectStatus[] = ["draft", "active"]

export const ASSIGNMENT_STATUSES = ["proposed", "confirmed", "active", "ended", "cancelled"] as const
export type AssignmentStatus = (typeof ASSIGNMENT_STATUSES)[number]
/** Assignments that occupy the worker: no other blocking assignment may overlap them. */
export const BLOCKING_ASSIGNMENT_STATUSES: readonly AssignmentStatus[] = ["confirmed", "active"]

export const CERT_APPLIES_TO = ["worker"] as const
export type CertAppliesTo = (typeof CERT_APPLIES_TO)[number]

export const CERTIFICATE_STATUSES = ["valid", "expiring60", "expiring30", "expired", "missing"] as const
export type CertificateStatus = (typeof CERTIFICATE_STATUSES)[number]

/** Higher is worse. `missing` and `expired` both stop a worker from working. */
export const CERTIFICATE_STATUS_RANK: Record<CertificateStatus, number> = { valid: 0, expiring60: 1, expiring30: 2, missing: 3, expired: 4 }

export const CURRENCIES = ["EUR"] as const

// ---------------------------------------------------------------- dates

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/** `YYYY-MM-DD` and a real calendar day (no 2026-02-30). */
export function isIsoDate(s: unknown): s is string {
  if (typeof s !== "string" || !ISO_DATE.test(s)) return false
  const d = new Date(`${s}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
}

/** Today (UTC) as `YYYY-MM-DD`. */
export const todayIso = (now: number | Date = Date.now()): string => new Date(now).toISOString().slice(0, 10)

const toUtc = (d: string) => Date.parse(`${d}T00:00:00Z`)

export function addDays(date: string, days: number): string {
  return new Date(toUtc(date) + days * 86_400_000).toISOString().slice(0, 10)
}

/** Calendar months; the day is clamped to the month's last day (2026-01-31 + 1 → 2026-02-28). */
export function addMonths(date: string, months: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number]
  const first = new Date(Date.UTC(y, m - 1 + months, 1))
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate()
  first.setUTCDate(Math.min(d, last))
  return first.toISOString().slice(0, 10)
}

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export const daysBetween = (from: string, to: string): number => Math.round((toUtc(to) - toUtc(from)) / 86_400_000)

export interface DateRange {
  startDate: string
  /** Missing: open-ended. */
  endDate?: string | null | undefined
}

/** Inclusive ranges share at least one day. Open ends reach forever. */
export function rangesOverlap(a: DateRange, b: DateRange): boolean {
  return (!a.endDate || a.endDate >= b.startDate) && (!b.endDate || b.endDate >= a.startDate)
}

/** The day is inside the inclusive range. */
export const rangeCovers = (r: DateRange, day: string): boolean => r.startDate <= day && (!r.endDate || r.endDate >= day)

// ---------------------------------------------------------------- certificates

export interface CertificateLike {
  expiresAt?: string | null | undefined
}

/**
 * Status of one certificate on a day. No certificate → `missing`; no expiry
 * date → `valid` (e.g. a passport scan kept without date). Expiring on the day
 * itself still counts as valid that day (`expiring30`).
 */
export function certificateStatus(cert: CertificateLike | null | undefined, onDate: string): CertificateStatus {
  if (!cert) return "missing"
  if (!cert.expiresAt) return "valid"
  const left = daysBetween(onDate, cert.expiresAt)
  if (left < 0) return "expired"
  if (left <= 30) return "expiring30"
  if (left <= 60) return "expiring60"
  return "valid"
}

/** The worst of several statuses; `valid` for none. */
export function worstCertificateStatus(statuses: Iterable<CertificateStatus>): CertificateStatus {
  let worst: CertificateStatus = "valid"
  for (const s of statuses) if (CERTIFICATE_STATUS_RANK[s] > CERTIFICATE_STATUS_RANK[worst]) worst = s
  return worst
}

/** The worker may work on that day with it (`valid`, `expiring60`, `expiring30`). */
export const isUsableCertificateStatus = (s: CertificateStatus): boolean => s !== "expired" && s !== "missing"

/**
 * Best certificate per type: a worker may hold several (renewals). The one
 * with the latest expiry wins; one without expiry beats any dated one.
 */
export function latestCertificateByType<C extends CertificateLike & { certificateTypeId: string }>(certs: readonly C[]): Map<string, C> {
  const out = new Map<string, C>()
  for (const c of certs) {
    const cur = out.get(c.certificateTypeId)
    if (!cur || (cur.expiresAt && (!c.expiresAt || c.expiresAt > cur.expiresAt))) out.set(c.certificateTypeId, c)
  }
  return out
}

/** Default expiry of a new certificate from the type's validity. */
export function defaultExpiry(issuedAt: string | undefined, defaultValidityMonths: number | undefined): string | undefined {
  if (!issuedAt || !defaultValidityMonths) return undefined
  return addMonths(issuedAt, defaultValidityMonths)
}

// ---------------------------------------------------------------- assignments

export interface AssignmentLike extends DateRange {
  status: AssignmentStatus
}

export const isBlockingAssignment = (a: { status: AssignmentStatus }): boolean => BLOCKING_ASSIGNMENT_STATUSES.includes(a.status)

/** Blocking assignments among `others` that overlap `range`. */
export function overlappingBlocking<A extends AssignmentLike>(others: readonly A[], range: DateRange): A[] {
  return others.filter((o) => isBlockingAssignment(o) && rangesOverlap(o, range))
}

/**
 * The assignment covering `onDate` (`current`) and the earliest one starting
 * after it (`next`), ignoring cancelled and ended ones. Proposed ones count:
 * the card shows what is planned.
 */
export function currentAndNext<A extends AssignmentLike>(assignments: readonly A[], onDate: string): { current: A | null; next: A | null } {
  const live = assignments.filter((a) => a.status !== "cancelled" && a.status !== "ended")
  const rank = (a: A) => (isBlockingAssignment(a) ? 0 : 1)
  const current = live.filter((a) => rangeCovers(a, onDate)).sort((x, y) => rank(x) - rank(y) || x.startDate.localeCompare(y.startDate))[0] ?? null
  const next = live.filter((a) => a.startDate > onDate).sort((x, y) => x.startDate.localeCompare(y.startDate) || rank(x) - rank(y))[0] ?? null
  return { current, next }
}

// ---------------------------------------------------------------- availability (rotation)

/**
 * Why a worker can't be planned for a while (`staffing_workerAvailability`):
 * `rest` (home to rest, e.g. 2 weeks after a project), `unavailable` (sick,
 * personal), `available_from` (not before `startDate`: new recruit, documents
 * pending). `rest` / `unavailable` cover `[startDate, endDate]` (no end = until
 * further notice); `available_from` covers every day before `startDate`.
 */
export const AVAILABILITY_KINDS = ["rest", "unavailable", "available_from"] as const
export type AvailabilityKind = (typeof AVAILABILITY_KINDS)[number]

export interface AvailabilityLike {
  kind: AvailabilityKind
  startDate: string
  endDate?: string | null | undefined
}

/** The availability period takes away at least one day of `range`. */
export function availabilityBlocks(p: AvailabilityLike, range: DateRange): boolean {
  if (p.kind === "available_from") return range.startDate < p.startDate
  return rangesOverlap(p, range)
}

/** The period covers `day` (the worker is away / not yet available that day). */
export const availabilityCovers = (p: AvailabilityLike, day: string): boolean => availabilityBlocks(p, { startDate: day, endDate: day })

// ---------------------------------------------------------------- money and rates

export interface TradeRate {
  tradeId: string
  hourlyRateCents: number
}

/** Sell rate for a trade: the project's own rate, else the client's default, else null. */
export function sellRateFor(tradeId: string, projectRates: readonly TradeRate[], clientRates: readonly TradeRate[] = []): number | null {
  return projectRates.find((r) => r.tradeId === tradeId)?.hourlyRateCents ?? clientRates.find((r) => r.tradeId === tradeId)?.hourlyRateCents ?? null
}

/** 42.5 → 4250. Rounds to the nearest cent. */
export const toCents = (major: number): number => Math.round(major * 100)
/** 4250 → "42.50". */
export const formatCents = (cents: number): string => (cents / 100).toFixed(2)

// ---------------------------------------------------------------- text

export const fullName = (w: { firstName: string; lastName: string }): string => `${w.firstName} ${w.lastName}`.trim()

/** Lower-case, accents removed: "Žydrūnas" → "zydrunas". For search text and matching. */
export function fold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
}
