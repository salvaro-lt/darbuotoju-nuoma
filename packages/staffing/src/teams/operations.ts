// Shared read operations of the "teams" area (no permission checks: the
// calling function guards first). They feed the pure matching engine with
// data from the staffing base.
import { listAvailableWorkers, loadCatalog, workerAssignments, workerCertificates, type Catalog } from "../operations"
import { fullName, latestCertificateByType } from "../pure"
import { readerOf, type AssignmentId, type ClientId, type DbCtxLike, type ProjectDoc, type TradeId, type WorkerDoc, type WorkerId } from "../shared"
import { proposeTeam, rankForLine, teamGaps, type Candidate, type MatchContext, type RankedCandidate, type TeamGap, type TeamLine, type TeamPick } from "./matching"

export interface TeamRequestLike {
  clientId: ClientId
  startDate: string
  endDate?: string | undefined
  lines: readonly TeamLine[]
  languages: readonly string[]
  /** Planner's picks; missing: the engine's proposal. */
  selection?: readonly TeamPick[] | undefined
  /** Assignments of this request: they don't make their own workers busy. */
  assignmentIds?: readonly AssignmentId[] | undefined
}

export interface Proposal {
  /** Ranked candidates per request line (same order as `lines`). */
  ranked: RankedCandidate[][]
  /** The engine's own proposal. */
  proposed: TeamPick[]
  /** The team shown: the planner's selection, else `proposed`. */
  selection: TeamPick[]
  edited: boolean
  gaps: TeamGap[]
  /** Names of every worker referenced (picks may name workers no longer free). */
  workerNames: Record<string, string>
  catalog: Catalog
  context: MatchContext
}

function candidateOf(w: WorkerDoc, certs: Map<string, { expiresAt?: string | undefined }>, previous: number): Candidate {
  return {
    id: w._id,
    name: fullName(w),
    source: w.source,
    languages: w.languages,
    trades: w.trades,
    driverLicenseCategories: w.driverLicenseCategories,
    driverLicenseExpiresAt: w.driverLicenseExpiresAt ?? null,
    clothingSizes: w.clothingSizes,
    certificates: Object.fromEntries([...certs].map(([typeId, c]) => [typeId, c.expiresAt ?? null])),
    previousClientAssignments: previous,
  }
}

/**
 * Workers free for the request's whole period with one of its trades, as
 * matching candidates (latest certificate per type, earlier assignments for
 * the same client).
 */
export async function loadTeamCandidates(ctx: DbCtxLike, r: TeamRequestLike): Promise<Candidate[]> {
  const db = readerOf(ctx)
  const trades = [...new Set(r.lines.map((l) => l.tradeId as TradeId))]
  if (!trades.length) return []
  const available = await listAvailableWorkers(ctx, { from: r.startDate, to: r.endDate, trades, ignoreAssignmentIds: r.assignmentIds ?? [] })
  const projects = new Map<string, ProjectDoc | null>()
  const out: Candidate[] = []
  for (const a of available) {
    const w = await db.get("staffing_workers", a.id)
    if (!w) continue
    const certs = latestCertificateByType(await workerCertificates(ctx, w._id))
    let previous = 0
    for (const x of await workerAssignments(ctx, w._id)) {
      if (x.status === "cancelled" || (r.assignmentIds ?? []).includes(x._id)) continue
      if (!projects.has(x.projectId)) projects.set(x.projectId, await db.get("staffing_projects", x.projectId))
      if (projects.get(x.projectId)?.clientId === r.clientId) previous++
    }
    out.push(candidateOf(w, certs, previous))
  }
  return out
}

/** Ranking, proposal, the shown team and its gaps for a request. */
export async function buildProposal(ctx: DbCtxLike, r: TeamRequestLike): Promise<Proposal> {
  const db = readerOf(ctx)
  const catalog = await loadCatalog(ctx)
  const context: MatchContext = {
    startDate: r.startDate,
    endDate: r.endDate ?? null,
    mandatoryTypeIds: catalog.certificateTypeList.filter((t) => t.mandatory).map((t) => t._id),
    languages: r.languages,
  }
  const candidates = await loadTeamCandidates(ctx, r)
  const ranked = r.lines.map((line) => rankForLine(line, candidates, context))
  const proposed = proposeTeam(r.lines, ranked)
  const selection = r.selection ? [...r.selection] : proposed
  const workerNames: Record<string, string> = Object.fromEntries(candidates.map((c) => [c.id, c.name]))
  for (const p of selection)
    if (!workerNames[p.workerId]) {
      const w = await db.get("staffing_workers", p.workerId as WorkerId)
      workerNames[p.workerId] = w ? fullName(w) : "?"
    }
  return { ranked, proposed, selection, edited: Boolean(r.selection), gaps: teamGaps(r.lines, selection, ranked, workerNames), workerNames, catalog, context }
}
