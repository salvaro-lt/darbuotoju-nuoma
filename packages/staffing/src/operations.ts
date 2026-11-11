// Shared read operations: THE CONTRACT the staffing areas (teams, timesheets,
// invoicing, logistics, compliance) build on. They take any Convex ctx with a
// database and do NOT check permissions: the calling function guards first
// (`system.requirePermission`), then calls these.
import {
  BLOCKING_ASSIGNMENT_STATUSES,
  CERTIFICATE_STATUS_RANK,
  certificateStatus,
  currentAndNext,
  fullName,
  isUsableCertificateStatus,
  latestCertificateByType,
  rangeCovers,
  sellRateFor,
  todayIso,
  TRADE_LEVELS,
  worstCertificateStatus,
  type AssignmentStatus,
  type CertificateStatus,
  type ProjectStatus,
  type TradeLevel,
  type WorkerSource,
  type WorkerStatus,
} from "./pure"
import {
  readerOf,
  type AssignmentDoc,
  type AssignmentId,
  type CertificateTypeDoc,
  type CertificateTypeId,
  type ClientDoc,
  type ClientId,
  type DbCtxLike,
  type ProjectDoc,
  type ProjectId,
  type TradeDoc,
  type TradeId,
  type WorkerCertificateDoc,
  type WorkerCertificateId,
  type WorkerDoc,
  type WorkerId,
} from "./shared"

// ---------------------------------------------------------------- views

export interface TradeView {
  id: TradeId
  code: string
  nameLt: string
  nameEn: string
}
export interface WorkerTradeView extends TradeView {
  level: TradeLevel
}
export interface CertificateTypeView {
  id: CertificateTypeId
  name: string
  nameEn: string | null
  appliesTo: "worker"
  mandatory: boolean
  defaultValidityMonths: number | null
}
export interface CertificateView {
  id: WorkerCertificateId
  certificateTypeId: CertificateTypeId
  typeName: string
  typeNameEn: string | null
  mandatory: boolean
  number: string | null
  issuedAt: string | null
  expiresAt: string | null
  fileName: string | null
  hasFile: boolean
  notes: string | null
  /** On the day the view was built for. */
  status: CertificateStatus
}
export interface WorkerSummary {
  id: WorkerId
  firstName: string
  lastName: string
  fullName: string
  phone: string
  email: string | null
  nationality: string
  languages: string[]
  source: WorkerSource
  subcontractorClientId: ClientId | null
  subcontractorName: string | null
  trades: WorkerTradeView[]
  driverLicenseCategories: string[]
  status: WorkerStatus
  homeCountry: string
  homeCity: string
  /** Worst status of the worker's certificates (latest per type) and mandatory types on `onDate`. */
  certStatus: CertificateStatus
  /** Mandatory certificate types the worker has no certificate of. */
  missingMandatory: CertificateTypeId[]
}
export interface AssignmentView {
  id: AssignmentId
  projectId: ProjectId
  projectName: string
  projectCode: string
  projectStatus: ProjectStatus | null
  clientId: ClientId | null
  clientName: string | null
  workerId: WorkerId
  tradeId: TradeId
  tradeCode: string
  tradeName: string
  startDate: string
  endDate: string | null
  status: AssignmentStatus
  isDriver: boolean
  notes: string
}
export interface WorkerCard {
  worker: WorkerSummary & {
    notes: string
    clothingSizes: { jacket?: string | undefined; trousers?: string | undefined; shoes?: string | undefined }
    driverLicenseExpiresAt: string | null
    createdAt: number
    updatedAt: number
  }
  /** Every certificate (all renewals), newest expiry first, with status on `onDate`. */
  certificates: CertificateView[]
  /** Mandatory types with no certificate. */
  missingMandatory: CertificateTypeView[]
  /** All assignments except cancelled ones, newest first. */
  assignments: AssignmentView[]
  current: AssignmentView | null
  next: AssignmentView | null
  onDate: string
}
export interface AvailableWorker extends WorkerSummary {
  /** The worker's trades among the requested ones (all trades when none were requested). */
  matchingTrades: WorkerTradeView[]
  /** Status on `requireValidCertsOn` (or `from`) of the required certificate types. */
  requiredCertStatus: CertificateStatus
}
export interface TeamMember extends AssignmentView {
  worker: WorkerSummary
}
export interface ExpiringCertificate extends CertificateView {
  workerId: WorkerId
  workerName: string
  workerStatus: WorkerStatus
}
export interface Catalog {
  trades: Map<string, TradeDoc>
  certificateTypes: Map<string, CertificateTypeDoc>
  /** Ordered by position. */
  tradeList: TradeDoc[]
  certificateTypeList: CertificateTypeDoc[]
}

// ---------------------------------------------------------------- catalog

/** Both catalogs (small tables), ordered by position. */
export async function loadCatalog(ctx: DbCtxLike): Promise<Catalog> {
  const db = readerOf(ctx)
  const [tradeList, certificateTypeList] = await Promise.all([
    db.query("staffing_trades").withIndex("by_position").collect(),
    db.query("staffing_certificateTypes").withIndex("by_position").collect(),
  ])
  return {
    trades: new Map(tradeList.map((t) => [t._id, t])),
    certificateTypes: new Map(certificateTypeList.map((c) => [c._id, c])),
    tradeList,
    certificateTypeList,
  }
}

export const tradeView = (t: TradeDoc): TradeView => ({ id: t._id, code: t.code, nameLt: t.nameLt, nameEn: t.nameEn })
export const certificateTypeView = (c: CertificateTypeDoc): CertificateTypeView => ({
  id: c._id,
  name: c.name,
  nameEn: c.nameEn ?? null,
  appliesTo: c.appliesTo,
  mandatory: c.mandatory,
  defaultValidityMonths: c.defaultValidityMonths ?? null,
})

function certificateView(c: WorkerCertificateDoc, catalog: Catalog, onDate: string): CertificateView {
  const type = catalog.certificateTypes.get(c.certificateTypeId)
  return {
    id: c._id,
    certificateTypeId: c.certificateTypeId,
    typeName: type?.name ?? "?",
    typeNameEn: type?.nameEn ?? null,
    mandatory: type?.mandatory ?? false,
    number: c.number ?? null,
    issuedAt: c.issuedAt ?? null,
    expiresAt: c.expiresAt ?? null,
    fileName: c.fileName ?? null,
    hasFile: Boolean(c.fileStorageId),
    notes: c.notes ?? null,
    status: certificateStatus(c, onDate),
  }
}

// ---------------------------------------------------------------- workers

export async function workerCertificates(ctx: DbCtxLike, workerId: WorkerId): Promise<WorkerCertificateDoc[]> {
  return readerOf(ctx)
    .query("staffing_workerCertificates")
    .withIndex("by_worker", (q) => q.eq("workerId", workerId))
    .collect()
}

/**
 * Certificate status of one worker on a day: the worst of the latest
 * certificate per type held, and `missing` for each mandatory type not held.
 * `requiredTypeIds` (optional) adds types that must be held too.
 */
export function certificateSummary(
  certs: readonly WorkerCertificateDoc[],
  catalog: Catalog,
  onDate: string,
  requiredTypeIds: readonly string[] = [],
): { status: CertificateStatus; requiredStatus: CertificateStatus; missingMandatory: CertificateTypeId[] } {
  const latest = latestCertificateByType(certs)
  const mandatory = catalog.certificateTypeList.filter((t) => t.mandatory).map((t) => t._id as string)
  const missingMandatory = mandatory.filter((id) => !latest.has(id)) as CertificateTypeId[]
  const held = [...latest.values()].map((c) => certificateStatus(c, onDate))
  const status = worstCertificateStatus([...held, ...missingMandatory.map(() => "missing" as const)])
  const required = [...new Set([...mandatory, ...requiredTypeIds])]
  const requiredStatus = worstCertificateStatus(required.map((id) => certificateStatus(latest.get(id), onDate)))
  return { status, requiredStatus, missingMandatory }
}

function workerTrades(w: WorkerDoc, catalog: Catalog): WorkerTradeView[] {
  return w.trades.flatMap((t) => {
    const trade = catalog.trades.get(t.tradeId)
    return trade ? [{ ...tradeView(trade), level: t.level }] : []
  })
}

async function clientNames(ctx: DbCtxLike, ids: Iterable<ClientId | undefined>): Promise<Map<string, ClientDoc>> {
  const db = readerOf(ctx)
  const unique = [...new Set([...ids].filter((x): x is ClientId => Boolean(x)))]
  const rows = await Promise.all(unique.map((id) => db.get("staffing_clients", id)))
  return new Map(rows.filter((r): r is ClientDoc => Boolean(r)).map((r) => [r._id, r]))
}

/**
 * Summaries for many workers at once (one certificate query per worker).
 * `onDate` defaults to today.
 */
export async function workerSummaries(ctx: DbCtxLike, workers: readonly WorkerDoc[], opts: { catalog?: Catalog; onDate?: string; requiredTypeIds?: readonly string[] } = {}): Promise<(WorkerSummary & { requiredCertStatus: CertificateStatus })[]> {
  const catalog = opts.catalog ?? (await loadCatalog(ctx))
  const onDate = opts.onDate ?? todayIso()
  const subs = await clientNames(
    ctx,
    workers.map((w) => w.subcontractorClientId),
  )
  return Promise.all(
    workers.map(async (w) => {
      const certs = await workerCertificates(ctx, w._id)
      const s = certificateSummary(certs, catalog, onDate, opts.requiredTypeIds)
      return {
        id: w._id,
        firstName: w.firstName,
        lastName: w.lastName,
        fullName: fullName(w),
        phone: w.phone,
        email: w.email ?? null,
        nationality: w.nationality,
        languages: w.languages,
        source: w.source,
        subcontractorClientId: w.subcontractorClientId ?? null,
        subcontractorName: (w.subcontractorClientId && subs.get(w.subcontractorClientId)?.name) || null,
        trades: workerTrades(w, catalog),
        driverLicenseCategories: w.driverLicenseCategories,
        status: w.status,
        homeCountry: w.homeCountry,
        homeCity: w.homeCity,
        certStatus: s.status,
        missingMandatory: s.missingMandatory,
        requiredCertStatus: s.requiredStatus,
      }
    }),
  )
}

/** Assignment rows with project, client and trade names. */
export async function assignmentViews(ctx: DbCtxLike, rows: readonly AssignmentDoc[], catalog?: Catalog): Promise<AssignmentView[]> {
  const db = readerOf(ctx)
  const cat = catalog ?? (await loadCatalog(ctx))
  const projectIds = [...new Set(rows.map((r) => r.projectId))]
  const projects = new Map((await Promise.all(projectIds.map((id) => db.get("staffing_projects", id)))).filter((p): p is ProjectDoc => Boolean(p)).map((p) => [p._id as string, p]))
  const clients = await clientNames(
    ctx,
    [...projects.values()].map((p) => p.clientId),
  )
  return rows.map((a) => {
    const p = projects.get(a.projectId)
    const trade = cat.trades.get(a.tradeId)
    return {
      id: a._id,
      projectId: a.projectId,
      projectName: p?.name ?? "?",
      projectCode: p?.code ?? "",
      projectStatus: p?.status ?? null,
      clientId: p?.clientId ?? null,
      clientName: (p && clients.get(p.clientId)?.name) || null,
      workerId: a.workerId,
      tradeId: a.tradeId,
      tradeCode: trade?.code ?? "",
      tradeName: trade?.nameLt ?? "?",
      startDate: a.startDate,
      endDate: a.endDate ?? null,
      status: a.status,
      isDriver: a.isDriver,
      notes: a.notes,
    }
  })
}

/** A worker's assignments (every status), oldest start first. */
export async function workerAssignments(ctx: DbCtxLike, workerId: WorkerId): Promise<AssignmentDoc[]> {
  return readerOf(ctx)
    .query("staffing_assignments")
    .withIndex("by_worker", (q) => q.eq("workerId", workerId))
    .collect()
}

/**
 * Everything about one worker for a card or a decision: details, trades,
 * certificates with status on `onDate` (default today), missing mandatory
 * certificates, assignments, and the current and next assignment.
 * `null` when the worker does not exist.
 */
export async function getWorkerCard(ctx: DbCtxLike, workerId: WorkerId, opts: { onDate?: string } = {}): Promise<WorkerCard | null> {
  const db = readerOf(ctx)
  const w = await db.get("staffing_workers", workerId)
  if (!w) return null
  const onDate = opts.onDate ?? todayIso()
  const catalog = await loadCatalog(ctx)
  const [summary] = await workerSummaries(ctx, [w], { catalog, onDate })
  const certs = await workerCertificates(ctx, w._id)
  const rows = (await workerAssignments(ctx, w._id)).filter((a) => a.status !== "cancelled")
  const views = await assignmentViews(ctx, rows, catalog)
  const byId = new Map(views.map((x) => [x.id as string, x]))
  const { current, next } = currentAndNext(rows, onDate)
  const { requiredCertStatus: _ignored, ...base } = summary!
  return {
    worker: {
      ...base,
      notes: w.notes,
      clothingSizes: w.clothingSizes,
      driverLicenseExpiresAt: w.driverLicenseExpiresAt ?? null,
      createdAt: w._creationTime,
      updatedAt: w.updatedAt,
    },
    certificates: certs
      .map((c) => certificateView(c, catalog, onDate))
      .sort((a, b) => (b.expiresAt ?? "9999").localeCompare(a.expiresAt ?? "9999") || a.typeName.localeCompare(b.typeName)),
    missingMandatory: base.missingMandatory.map((id) => certificateTypeView(catalog.certificateTypes.get(id)!)),
    assignments: [...views].sort((a, b) => b.startDate.localeCompare(a.startDate)),
    current: current ? (byId.get(current._id) ?? null) : null,
    next: next ? (byId.get(next._id) ?? null) : null,
    onDate,
  }
}

export interface AvailabilityQuery {
  /** First day of the period (inclusive). */
  from: string
  /** Last day (inclusive). Missing: open-ended, the worker must be free from `from` on. */
  to?: string | undefined
  /** Any of these trades. Missing or empty: any trade. */
  trades?: readonly TradeId[] | undefined
  /** Lowest acceptable level in the matching trade. */
  minLevel?: TradeLevel | undefined
  /**
   * When set, only workers whose mandatory certificate types (and
   * `requiredCertificateTypeIds`) are usable (not expired, not missing) on this
   * day. Pass the period's last day to require validity for the whole period.
   */
  requireValidCertsOn?: string | undefined
  requiredCertificateTypeIds?: readonly CertificateTypeId[] | undefined
  source?: WorkerSource | undefined
  /** Ignore these assignments when checking overlaps (e.g. the one being moved). */
  ignoreAssignmentIds?: readonly AssignmentId[] | undefined
}

/** Worker IDs with a confirmed or active assignment overlapping the period. */
export async function busyWorkerIds(ctx: DbCtxLike, range: { from: string; to?: string | undefined }, ignore: readonly string[] = []): Promise<Set<string>> {
  const db = readerOf(ctx)
  const busy = new Set<string>()
  for (const status of BLOCKING_ASSIGNMENT_STATUSES) {
    const rows = await db
      .query("staffing_assignments")
      .withIndex("by_status", (q) => (range.to ? q.eq("status", status).lte("startDate", range.to) : q.eq("status", status)))
      .collect()
    for (const a of rows) if ((!a.endDate || a.endDate >= range.from) && !ignore.includes(a._id)) busy.add(a.workerId)
  }
  return busy
}

/**
 * Active workers free for the whole period: no confirmed or active assignment
 * overlapping it (proposed ones don't block), with one of the trades (at
 * `minLevel` or above), and, when `requireValidCertsOn` is set, usable
 * mandatory and required certificates on that day. Sorted by last name.
 */
export async function listAvailableWorkers(ctx: DbCtxLike, query: AvailabilityQuery): Promise<AvailableWorker[]> {
  const db = readerOf(ctx)
  const catalog = await loadCatalog(ctx)
  const busy = await busyWorkerIds(ctx, query, query.ignoreAssignmentIds)
  const minRank = query.minLevel ? TRADE_LEVELS.indexOf(query.minLevel) : 0
  const wanted = new Set<string>(query.trades ?? [])
  const active = await db
    .query("staffing_workers")
    .withIndex("by_status", (q) => q.eq("status", "active"))
    .collect()
  const candidates = active.filter(
    (w) =>
      !busy.has(w._id) &&
      (!query.source || w.source === query.source) &&
      (minRank === 0 && wanted.size === 0 ? true : w.trades.some((t) => (wanted.size === 0 || wanted.has(t.tradeId)) && TRADE_LEVELS.indexOf(t.level) >= minRank)),
  )
  const certDay = query.requireValidCertsOn ?? query.from
  const summaries = await workerSummaries(ctx, candidates, { catalog, onDate: certDay, requiredTypeIds: query.requiredCertificateTypeIds ?? [] })
  return summaries
    .filter((s) => !query.requireValidCertsOn || isUsableCertificateStatus(s.requiredCertStatus))
    .map((s) => ({ ...s, matchingTrades: wanted.size === 0 ? s.trades : s.trades.filter((t) => wanted.has(t.id)) }))
    .sort((a, b) => a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName))
}

// ---------------------------------------------------------------- projects

/** A project's assignments with worker summaries. With `onDate`: only those covering that day. Cancelled ones never. */
export async function projectTeam(ctx: DbCtxLike, projectId: ProjectId, onDate?: string): Promise<TeamMember[]> {
  const db = readerOf(ctx)
  const rows = (
    await db
      .query("staffing_assignments")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect()
  ).filter((a) => a.status !== "cancelled" && (!onDate || rangeCovers(a, onDate)))
  const catalog = await loadCatalog(ctx)
  const views = await assignmentViews(ctx, rows, catalog)
  const workerIds = [...new Set(rows.map((r) => r.workerId))]
  const workers = (await Promise.all(workerIds.map((id) => db.get("staffing_workers", id)))).filter((w): w is WorkerDoc => Boolean(w))
  const summaries = new Map((await workerSummaries(ctx, workers, { catalog, ...(onDate ? { onDate } : {}) })).map((s) => [s.id as string, s]))
  return views
    .filter((v) => summaries.has(v.workerId))
    .map((v) => {
      const { requiredCertStatus: _ignored, ...worker } = summaries.get(v.workerId)!
      return { ...v, worker }
    })
    .sort((a, b) => a.tradeName.localeCompare(b.tradeName) || a.worker.lastName.localeCompare(b.worker.lastName) || a.startDate.localeCompare(b.startDate))
}

/** Hourly sell rate (cents) for a trade on a project: the project's rate, else the client's default, else null. */
export async function projectSellRate(ctx: DbCtxLike, projectId: ProjectId, tradeId: TradeId): Promise<number | null> {
  const db = readerOf(ctx)
  const p = await db.get("staffing_projects", projectId)
  if (!p) return null
  const c = await db.get("staffing_clients", p.clientId)
  return sellRateFor(tradeId, p.rates, c?.defaultRates ?? [])
}

// ---------------------------------------------------------------- certificates

/**
 * Certificates expiring in `[from, to]` (inclusive; `from` defaults to today),
 * soonest first, with the worker's name. `includeExpired` also returns those
 * already expired before `from`. Only active workers unless `includeInactive`.
 */
export async function listExpiringCertificates(
  ctx: DbCtxLike,
  query: { to: string; from?: string; includeExpired?: boolean; includeInactive?: boolean; limit?: number },
): Promise<ExpiringCertificate[]> {
  const db = readerOf(ctx)
  const from = query.from ?? todayIso()
  const rows = await db
    .query("staffing_workerCertificates")
    .withIndex("by_expires", (q) => (query.includeExpired ? q.gt("expiresAt", "").lte("expiresAt", query.to) : q.gte("expiresAt", from).lte("expiresAt", query.to)))
    .take(query.limit ?? 1000)
  const catalog = await loadCatalog(ctx)
  // A renewed certificate supersedes the expiring one: skip those with a later one of the same type.
  const out: ExpiringCertificate[] = []
  const workers = new Map<string, WorkerDoc | null>()
  for (const c of rows) {
    if (!workers.has(c.workerId)) workers.set(c.workerId, await db.get("staffing_workers", c.workerId))
    const w = workers.get(c.workerId)
    if (!w || (!query.includeInactive && w.status !== "active")) continue
    const latest = latestCertificateByType(await workerCertificates(ctx, w._id)).get(c.certificateTypeId)
    if (latest && latest._id !== c._id) continue
    out.push({ ...certificateView(c, catalog, from), workerId: w._id, workerName: fullName(w), workerStatus: w.status })
  }
  return out.sort((a, b) => (a.expiresAt ?? "").localeCompare(b.expiresAt ?? "") || CERTIFICATE_STATUS_RANK[b.status] - CERTIFICATE_STATUS_RANK[a.status])
}
