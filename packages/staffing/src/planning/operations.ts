// Shared read operations of the "planning" area (no permission checks: the
// calling function guards first). The teams area uses `clientRulesFor`,
// `clientFeedback` and `capacityOffers` too.
import { loadCatalog, workerAssignments, type Catalog } from "../operations"
import { addDays, fold, fullName, todayIso, TRADE_LEVELS, type TradeLevel } from "../pure"
import { readerOf, type ClientId, type DataModelOf, type DbCtxLike, type TradeId, type WorkerId } from "../shared"
import type { staffingTables } from "../tables"
import type { teamsTables } from "../teams/tables"
import type { PlanAssignment, PlanAvailability, PlanCapacity, PlanData, PlanDemand, PlanWorker } from "./pure"
import { resolveTeamRules, type TeamRules } from "./rules"
import type { FeedbackVerdict, planningTables } from "./tables"

export type PlanningDataModel = DataModelOf<typeof staffingTables & typeof teamsTables & typeof planningTables>
export const planningReader = (ctx: DbCtxLike) => readerOf<PlanningDataModel>(ctx)

/** Trades in the order a worker masters them: highest level first, then as listed. */
function mainTradeFirst(trades: readonly { tradeId: string; level: TradeLevel }[]): string[] {
  return trades
    .map((t, i) => ({ t, i }))
    .sort((a, b) => TRADE_LEVELS.indexOf(b.t.level) - TRADE_LEVELS.indexOf(a.t.level) || a.i - b.i)
    .map((x) => x.t.tradeId)
}

/**
 * Everything the board and the capacity answer need: active workers, their
 * live assignments (not cancelled, reaching `from` or later), availability
 * periods, subcontractor capacities and open request lines (status `open` or
 * `proposed`).
 */
export async function loadPlanData(ctx: DbCtxLike, opts: { from: string }): Promise<PlanData & { clientNames: Map<string, string> }> {
  const db = planningReader(ctx)
  const keepFrom = addDays(opts.from, -21)
  const workersDocs = await db
    .query("staffing_workers")
    .withIndex("by_status", (q) => q.eq("status", "active"))
    .collect()
  const clients = await db.query("staffing_clients").take(1000)
  const clientNames = new Map(clients.map((c) => [c._id as string, c.name]))
  const projects = new Map((await db.query("staffing_projects").take(2000)).map((p) => [p._id as string, p]))
  const workers: PlanWorker[] = workersDocs.map((w) => ({
    id: w._id,
    name: fullName(w),
    nationality: w.nationality,
    languages: w.languages,
    source: w.source,
    subcontractorClientId: w.subcontractorClientId ?? null,
    tradeIds: mainTradeFirst(w.trades),
  }))
  const assignments: PlanAssignment[] = []
  for (const status of ["proposed", "confirmed", "active", "ended"] as const) {
    const rows = await db
      .query("staffing_assignments")
      .withIndex("by_status", (q) => q.eq("status", status))
      .collect()
    for (const a of rows) {
      if (a.endDate && a.endDate < keepFrom) continue
      const p = projects.get(a.projectId)
      assignments.push({ workerId: a.workerId, projectId: a.projectId, projectCode: p?.code ?? "?", clientId: p?.clientId ?? null, startDate: a.startDate, endDate: a.endDate ?? null, status: a.status })
    }
  }
  const availability: PlanAvailability[] = (await db.query("staffing_workerAvailability").take(5000))
    .filter((p) => p.kind === "available_from" || !p.endDate || p.endDate >= keepFrom)
    .map((p) => ({ id: p._id, workerId: p.workerId, kind: p.kind, startDate: p.startDate, endDate: p.endDate ?? null, note: p.note }))
  const capacities: PlanCapacity[] = (await db.query("staffing_planning_capacities").take(2000)).map((c) => ({
    clientId: c.clientId,
    clientName: clientNames.get(c.clientId) ?? "?",
    tradeId: c.tradeId,
    count: c.count,
    validFrom: c.validFrom,
    validTo: c.validTo ?? null,
  }))
  const demand: PlanDemand[] = []
  for (const status of ["open", "proposed"] as const) {
    const rows = await db
      .query("staffing_teams_requests")
      .withIndex("by_status", (q) => q.eq("status", status))
      .collect()
    for (const r of rows) {
      if (r.endDate && r.endDate < opts.from) continue
      const project = r.projectId ? projects.get(r.projectId) : null
      const label = project ? project.code : (r.projectName ?? r.site)
      for (const l of r.lines) demand.push({ requestId: r._id, clientName: clientNames.get(r.clientId) ?? "?", label, tradeId: l.tradeId, count: l.count, startDate: r.startDate, endDate: r.endDate ?? null })
    }
  }
  return { workers, assignments, availability, capacities, demand, clientNames }
}

/** The client's team rules (defaults when none stored). */
export async function clientRulesFor(ctx: DbCtxLike, clientId: ClientId | string | null | undefined): Promise<TeamRules & { stored: boolean }> {
  if (!clientId) return { ...resolveTeamRules(null), stored: false }
  const row = await planningReader(ctx)
    .query("staffing_planning_clientRules")
    .withIndex("by_client", (q) => q.eq("clientId", clientId as ClientId))
    .first()
    .catch(() => null)
  return { ...resolveTeamRules(row), stored: Boolean(row) }
}

export interface FeedbackNote {
  verdict: FeedbackVerdict
  comment: string
  updatedAt: number
}

/** Planner's verdicts on workers for one client, by worker ID. */
export async function clientFeedback(ctx: DbCtxLike, clientId: ClientId | string | null | undefined): Promise<Map<string, FeedbackNote>> {
  if (!clientId) return new Map()
  const rows = await planningReader(ctx)
    .query("staffing_planning_feedback")
    .withIndex("by_client", (q) => q.eq("clientId", clientId as ClientId))
    .collect()
    .catch(() => [])
  return new Map(rows.map((r) => [r.workerId as string, { verdict: r.verdict, comment: r.comment, updatedAt: r.updatedAt }]))
}

export interface CapacityOffer {
  clientId: string
  name: string
  tradeId: string
  count: number
  validFrom: string
  validTo: string | null
}

/** Subcontractor capacities for a trade valid on `onDate`, largest first. */
export async function capacityOffers(ctx: DbCtxLike, tradeId: TradeId | string, onDate: string): Promise<CapacityOffer[]> {
  const db = planningReader(ctx)
  const rows = await db
    .query("staffing_planning_capacities")
    .withIndex("by_trade", (q) => q.eq("tradeId", tradeId as TradeId).lte("validFrom", onDate))
    .collect()
    .catch(() => [])
  const out: CapacityOffer[] = []
  for (const c of rows) {
    if (c.validTo && c.validTo < onDate) continue
    const client = await db.get("staffing_clients", c.clientId)
    out.push({ clientId: c.clientId, name: client?.name ?? "?", tradeId: c.tradeId, count: c.count, validFrom: c.validFrom, validTo: c.validTo ?? null })
  }
  return out.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
}

export interface ClientHistory {
  clientId: string
  clientName: string
  /** Not cancelled, not merely proposed assignments on this client's projects. */
  times: number
  /** Last day worked there (latest end, or the start of an ongoing one). */
  lastDate: string | null
  ongoing: boolean
  projects: string[]
  feedback: FeedbackNote | null
}

/** Per client the worker worked for (or has feedback from): how often, when last, the planner's verdict. */
export async function workerClientHistory(ctx: DbCtxLike, workerId: WorkerId, onDate = todayIso()): Promise<ClientHistory[]> {
  const db = planningReader(ctx)
  const by = new Map<string, ClientHistory>()
  const clientName = async (id: string) => (await db.get("staffing_clients", id as ClientId))?.name ?? "?"
  for (const a of await workerAssignments(ctx, workerId)) {
    if (a.status === "cancelled" || a.status === "proposed") continue
    const p = await db.get("staffing_projects", a.projectId)
    if (!p) continue
    const h = by.get(p.clientId) ?? { clientId: p.clientId, clientName: await clientName(p.clientId), times: 0, lastDate: null, ongoing: false, projects: [], feedback: null }
    h.times++
    const ongoing = a.startDate <= onDate && (!a.endDate || a.endDate >= onDate)
    if (ongoing) h.ongoing = true
    const last = a.endDate && a.endDate < onDate ? a.endDate : a.startDate <= onDate ? onDate : null
    if (last && (!h.lastDate || last > h.lastDate)) h.lastDate = last
    if (!h.projects.includes(p.code)) h.projects.push(p.code)
    by.set(p.clientId, h)
  }
  for (const f of await db
    .query("staffing_planning_feedback")
    .withIndex("by_worker", (q) => q.eq("workerId", workerId))
    .collect()) {
    const h = by.get(f.clientId) ?? { clientId: f.clientId, clientName: await clientName(f.clientId), times: 0, lastDate: null, ongoing: false, projects: [], feedback: null }
    h.feedback = { verdict: f.verdict, comment: f.comment, updatedAt: f.updatedAt }
    by.set(f.clientId, h)
  }
  return [...by.values()].sort((a, b) => (b.lastDate ?? "").localeCompare(a.lastDate ?? "") || a.clientName.localeCompare(b.clientName))
}

/**
 * Trades for a free-text trade ("WELD-MAG", "suvirintojai", "welder"): an
 * exact code first, else every trade whose name contains the text (so
 * "suvirintoj" means every welding trade).
 */
export function tradesForText(catalog: Catalog, text: string): string[] {
  const n = fold(text.trim())
  if (!n) return []
  const exact = catalog.tradeList.find((t) => fold(t.code) === n)
  if (exact) return [exact._id]
  // Lithuanian plurals and English plurals: "suvirintojai" → "suvirintoj", "welders" → "welder".
  const stem = n.replace(/(ai|ų|us|ius|as|is|ys|s)$/u, "")
  return catalog.tradeList.filter((t) => [t.nameLt, t.nameEn, t.code].some((x) => fold(x).includes(stem.length >= 4 ? stem : n))).map((t) => t._id)
}

export { loadCatalog }
