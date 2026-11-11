// Shared read operations of the "teams" area (no permission checks: the
// calling function guards first). They feed the pure matching engine with
// data from the staffing base and the planning area (client rules,
// per-client feedback on workers, subcontractor capacity).
import { listAvailableWorkers, loadCatalog, workerAssignments, workerCertificates, type Catalog } from "../operations"
import { capacityOffers, clientFeedback, clientRulesFor, type FeedbackNote } from "../planning/operations"
import { applyTeamRules, evaluateTeamRules, type RuleCandidate, type RuleMember, type RuleWarning, type TeamRules } from "../planning/rules"
import { fullName, latestCertificateByType, todayIso } from "../pure"
import { readerOf, type AssignmentId, type ClientId, type DbCtxLike, type ProjectDoc, type TradeId, type WorkerDoc, type WorkerId } from "../shared"
import { canDriveOn, proposeTeam, rankForLine, teamGaps, type Candidate, type MatchContext, type RankedCandidate, type TeamGap, type TeamLine, type TeamPick } from "./matching"

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
  /** The engine's own proposal (after the client's team rules). */
  proposed: TeamPick[]
  /** The team shown: the planner's selection, else `proposed`. */
  selection: TeamPick[]
  edited: boolean
  gaps: TeamGap[]
  /** Names of every worker referenced (picks may name workers no longer free). */
  workerNames: Record<string, string>
  catalog: Catalog
  context: MatchContext
  /** The client's team composition rules (defaults when none stored). */
  rules: TeamRules & { stored: boolean }
  /** Rules the shown team breaks, and housing hints. */
  ruleWarnings: RuleWarning[]
  /** Swaps the engine made to keep the rules. */
  ruleSwaps: { lineIndex: number; out: string; in: string; reason: "drivers" | "english" | "language" }[]
}

function candidateOf(w: WorkerDoc, certs: Map<string, { expiresAt?: string | undefined }>, previous: number, lastClientWork: string | null, feedback: FeedbackNote | undefined): Candidate {
  return {
    id: w._id,
    name: fullName(w),
    source: w.source,
    languages: w.languages,
    nationality: w.nationality,
    trades: w.trades,
    driverLicenseCategories: w.driverLicenseCategories,
    driverLicenseExpiresAt: w.driverLicenseExpiresAt ?? null,
    clothingSizes: w.clothingSizes,
    certificates: Object.fromEntries([...certs].map(([typeId, c]) => [typeId, c.expiresAt ?? null])),
    previousClientAssignments: previous,
    lastClientWork,
    clientFeedback: feedback ? { verdict: feedback.verdict, comment: feedback.comment } : null,
  }
}

/**
 * Workers free for the request's whole period (no blocking assignment, not
 * resting or unavailable) with one of its trades, as matching candidates
 * (latest certificate per type, earlier work for the same client and the
 * planner's verdict for that client).
 */
export async function loadTeamCandidates(ctx: DbCtxLike, r: TeamRequestLike): Promise<Candidate[]> {
  const db = readerOf(ctx)
  const trades = [...new Set(r.lines.map((l) => l.tradeId as TradeId))]
  if (!trades.length) return []
  const available = await listAvailableWorkers(ctx, { from: r.startDate, to: r.endDate, trades, ignoreAssignmentIds: r.assignmentIds ?? [] })
  const feedback = await clientFeedback(ctx, r.clientId)
  const projects = new Map<string, ProjectDoc | null>()
  const today = todayIso()
  const out: Candidate[] = []
  for (const a of available) {
    const w = await db.get("staffing_workers", a.id)
    if (!w) continue
    const certs = latestCertificateByType(await workerCertificates(ctx, w._id))
    let previous = 0
    let last: string | null = null
    for (const x of await workerAssignments(ctx, w._id)) {
      if (x.status === "cancelled" || x.status === "proposed" || (r.assignmentIds ?? []).includes(x._id)) continue
      if (!projects.has(x.projectId)) projects.set(x.projectId, await db.get("staffing_projects", x.projectId))
      if (projects.get(x.projectId)?.clientId !== r.clientId) continue
      previous++
      const day = x.endDate && x.endDate < today ? x.endDate : x.startDate <= today ? today : null
      if (day && (!last || day > last)) last = day
    }
    out.push(candidateOf(w, certs, previous, last, feedback.get(w._id)))
  }
  return out
}

const ruleCandidate = (r: RankedCandidate, startDate: string, c: Candidate | undefined): RuleCandidate => ({
  workerId: r.workerId,
  name: r.name,
  nationality: r.nationality ?? "",
  languages: r.languages,
  canDrive: c ? canDriveOn(c, startDate) : r.canDrive,
  eligible: r.eligible,
  score: r.score,
})

/** Ranking, proposal (kept to the client's rules), the shown team, its gaps and rule warnings for a request. */
export async function buildProposal(ctx: DbCtxLike, r: TeamRequestLike): Promise<Proposal> {
  const db = readerOf(ctx)
  const catalog = await loadCatalog(ctx)
  const context: MatchContext = {
    startDate: r.startDate,
    endDate: r.endDate ?? null,
    mandatoryTypeIds: catalog.certificateTypeList.filter((t) => t.mandatory).map((t) => t._id),
    languages: r.languages,
  }
  const rules = await clientRulesFor(ctx, r.clientId)
  const candidates = await loadTeamCandidates(ctx, r)
  const byId = new Map(candidates.map((c) => [c.id, c]))
  const ranked = r.lines.map((line) => rankForLine(line, candidates, context))
  const ruleRanked = ranked.map((line) => line.map((x) => ruleCandidate(x, r.startDate, byId.get(x.workerId))))
  const applied = applyTeamRules(proposeTeam(r.lines, ranked), ruleRanked, rules)
  const proposed = applied.picks
  const selection = r.selection ? [...r.selection] : proposed
  const workerNames: Record<string, string> = Object.fromEntries(candidates.map((c) => [c.id, c.name]))
  const members: RuleMember[] = []
  for (const p of selection) {
    const c = byId.get(p.workerId)
    if (c) {
      members.push({ workerId: c.id, name: c.name, nationality: c.nationality ?? "", languages: c.languages, canDrive: canDriveOn(c, r.startDate) })
      continue
    }
    const w = await db.get("staffing_workers", p.workerId as WorkerId)
    workerNames[p.workerId] = w ? fullName(w) : "?"
    if (w) members.push({ workerId: w._id, name: fullName(w), nationality: w.nationality, languages: w.languages, canDrive: canDriveOn({ driverLicenseCategories: w.driverLicenseCategories, driverLicenseExpiresAt: w.driverLicenseExpiresAt ?? null }, r.startDate) })
  }
  const gaps = teamGaps(r.lines, selection, ranked, workerNames)
  // "Ko trūksta": where the missing people could come from (declared subcontractor capacity).
  for (const g of [...gaps]) {
    if (g.kind !== "people") continue
    const offers = await capacityOffers(ctx, g.tradeId, r.startDate)
    if (offers.length) gaps.splice(gaps.indexOf(g) + 1, 0, { kind: "subcontractor_capacity", lineIndex: g.lineIndex, tradeId: g.tradeId, missing: g.missing, offers: offers.map((o) => ({ name: o.name, count: o.count })) })
  }
  return {
    ranked,
    proposed,
    selection,
    edited: Boolean(r.selection),
    gaps,
    workerNames,
    catalog,
    context,
    rules,
    ruleWarnings: evaluateTeamRules(members, rules),
    ruleSwaps: r.selection ? [] : applied.swaps,
  }
}
