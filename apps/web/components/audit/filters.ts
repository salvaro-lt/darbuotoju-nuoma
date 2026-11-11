// Audit log filter state. It lives in the URL (shareable links); this module is
// pure so it can be unit-tested without React or Convex.

export const RANGES = ["24h", "7d", "30d", "all", "custom"] as const
export type RangePreset = (typeof RANGES)[number]
export const RESULTS = ["success", "denied", "failed"] as const
export type AuditResult = (typeof RESULTS)[number]
export type SearchScope = "op" | "target"

export const DEFAULT_RANGE: RangePreset = "7d"

/** Filter as it appears in the URL. Dates are local `YYYY-MM-DD` (native date inputs). */
export interface AuditUrlFilter {
  range: RangePreset
  from?: string
  to?: string
  actor?: string
  key?: string
  module?: string
  action?: string
  result?: AuditResult
  op?: string
  target?: string
}

/** `listAudit` / `recordAuditExport` filter fields (`filterOperationId` is the operation filter). */
export interface AuditQueryArgs {
  from?: number
  to?: number
  actorUserId?: string
  apiKeyId?: string
  targetId?: string
  filterOperationId?: string
  action?: string
  moduleId?: string
}

const HOUR = 60 * 60 * 1000
const PRESET_MS: Partial<Record<RangePreset, number>> = { "24h": 24 * HOUR, "7d": 7 * 24 * HOUR, "30d": 30 * 24 * HOUR }
const DATE = /^\d{4}-\d{2}-\d{2}$/
const TEXT_KEYS = ["actor", "key", "module", "action", "op", "target"] as const

const clean = (v: string | null | undefined) => {
  const s = v?.trim()
  return s ? s.slice(0, 200) : undefined
}

export function parseFilter(params: { get(name: string): string | null }): AuditUrlFilter {
  const range = params.get("range")
  const result = params.get("result")
  const f: AuditUrlFilter = { range: (RANGES as readonly string[]).includes(range ?? "") ? (range as RangePreset) : DEFAULT_RANGE }
  if (f.range === "custom") {
    const from = params.get("from")
    const to = params.get("to")
    if (from && DATE.test(from)) f.from = from
    if (to && DATE.test(to)) f.to = to
  }
  for (const k of TEXT_KEYS) {
    const v = clean(params.get(k))
    if (v) f[k] = v
  }
  if ((RESULTS as readonly string[]).includes(result ?? "")) f.result = result as AuditResult
  return f
}

/** Query string for a filter (no leading `?`); the default range is left out. */
export function filterToSearch(f: AuditUrlFilter): string {
  const p = new URLSearchParams()
  if (f.range !== DEFAULT_RANGE) p.set("range", f.range)
  if (f.range === "custom") {
    if (f.from) p.set("from", f.from)
    if (f.to) p.set("to", f.to)
  }
  for (const k of TEXT_KEYS) if (f[k]) p.set(k, f[k])
  if (f.result) p.set("result", f.result)
  return p.toString()
}

/** Anything narrower than the default view. */
export function isFiltered(f: AuditUrlFilter): boolean {
  return filterToSearch(f) !== ""
}

/** Local midnight of a `YYYY-MM-DD` date, plus `addDays`. */
export function localDayStart(date: string, addDays = 0): number {
  const [y = 1970, m = 1, d = 1] = date.split("-").map(Number)
  return new Date(y, m - 1, d + addDays).getTime()
}

/** Today (or `ms`) as a local `YYYY-MM-DD`, for date inputs and file names. */
export function localDate(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

/** Server-side filter args. Presets are relative to `now`, fixed once per search. */
export function toQueryArgs(f: AuditUrlFilter, now: number): AuditQueryArgs {
  const a: AuditQueryArgs = {}
  const span = PRESET_MS[f.range]
  if (span) a.from = now - span
  if (f.range === "custom") {
    if (f.from) a.from = localDayStart(f.from)
    // Inclusive end date: up to the last millisecond of that day.
    if (f.to) a.to = localDayStart(f.to, 1) - 1
  }
  if (f.actor) a.actorUserId = f.actor
  if (f.key) a.apiKeyId = f.key
  if (f.target) a.targetId = f.target
  if (f.op) a.filterOperationId = f.op
  if (f.action) a.action = f.action
  if (f.module) a.moduleId = f.module
  return a
}

/** Filters the server can't apply (the result), checked on each page in the browser. */
export function matchesClient(f: AuditUrlFilter, row: { result: string }): boolean {
  return !f.result || row.result === f.result
}
