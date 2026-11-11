// Guarded Convex functions of the "teams" area. Each one: guard (permission +
// module enabled) → object checks → write → audit, and returns `operationId`.
// Re-export them from the app's `convex/teams.ts`.
import { internalActionGeneric, internalMutationGeneric, makeFunctionReference, mutationGeneric, queryGeneric } from "convex/server"
import { v } from "convex/values"
import { recordAudit, type ConvexSystem } from "@digimuza/system-core/convex"
import { StaffingPermissions } from "../manifest"
import { isBlockingAssignment, OPEN_PROJECT_STATUSES, rangesOverlap, type TradeLevel } from "../pure"
import { actorArgs, actorId, checkRange, cleanCountry, cleanDate, cleanText, fail, LANGUAGE, opts, readerOf, writerOf, type DataModelOf, type ProjectId, type WorkerId } from "../shared"
import type { staffingTables } from "../tables"
import { describeGap, type DraftInput, type DraftStatus, type RankedCandidate, type RequestStatus, type TeamGap, type TeamPick } from "./matching"
import { describeRuleWarning, type RuleWarning, type TeamRules } from "../planning/rules"
import { StaffingTeamsPermissions as P } from "./manifest"
import { buildProposal } from "./operations"
import { defineTeamsSeed } from "./seed"
import { requestLineValidator, teamPickValidator, type teamsTables } from "./tables"

type DM = DataModelOf<typeof staffingTables & typeof teamsTables>
const rd = (ctx: { db: unknown }) => readerOf<DM>(ctx)
const wr = (ctx: { db: unknown }) => writerOf<DM>(ctx)
type RequestDoc = DM["staffing_teams_requests"]["document"]
type RequestId = RequestDoc["_id"]

export interface TeamsOptions {
  /** The app file that re-exports these functions (for scheduled calls). Default `teams`. */
  functionsModule?: string
}

export interface RequestLineView {
  tradeId: string
  tradeName: string
  tradeNameEn: string
  count: number
  minLevel: TradeLevel | null
  drivers: number
  certificateTypeIds: string[]
  certificateNames: string[]
}
export interface RequestView {
  id: RequestId
  clientId: string
  clientName: string
  projectId: string | null
  projectCode: string | null
  projectLabel: string
  country: string
  site: string
  startDate: string
  endDate: string | null
  lines: RequestLineView[]
  languages: string[]
  notes: string
  crmRecordId: string | null
  status: RequestStatus
  needed: number
  /** People in the shown team (planner's picks, else as many as the engine found when listed). */
  picked: number | null
  draft: { status: DraftStatus; at: number; to: string | null; error: string | null } | null
  createdAt: number
}
export interface ProposalView {
  lines: { ranked: RankedCandidate[] }[]
  selection: TeamPick[]
  edited: boolean
  gaps: TeamGap[]
  gapText: { lt: string[]; en: string[] }
  workerNames: Record<string, string>
  certificateNames: Record<string, string>
  /** For the local answer-to-client template (`clientDraftText`). */
  draftInput: DraftInput
  /** The client's team composition rules (planning area) and what the shown team breaks. */
  rules: TeamRules & { stored: boolean }
  ruleWarnings: RuleWarning[]
  ruleText: { lt: string[]; en: string[] }
  /** Swaps the engine made to keep the rules (empty once the planner edits the team). */
  ruleSwaps: { lineIndex: number; out: string; in: string; reason: "drivers" | "english" | "language" }[]
}

const MAX_LINES = 12
const MAX_COUNT = 60

export function defineTeams(system: ConvexSystem, options: TeamsOptions = {}) {
  const mod = options.functionsModule ?? "teams"
  const ref = (name: string) => makeFunctionReference<"mutation" | "action">(`${mod}:${name}`)

  async function requestView(ctx: { db: unknown }, r: RequestDoc, picked: number | null): Promise<RequestView> {
    const db = rd(ctx)
    const [client, project] = await Promise.all([db.get("staffing_clients", r.clientId), r.projectId ? db.get("staffing_projects", r.projectId) : null])
    const lines: RequestLineView[] = []
    for (const l of r.lines) {
      const trade = await db.get("staffing_trades", l.tradeId)
      const certs = await Promise.all(l.certificateTypeIds.map((id) => db.get("staffing_certificateTypes", id)))
      lines.push({
        tradeId: l.tradeId,
        tradeName: trade?.nameLt ?? "?",
        tradeNameEn: trade?.nameEn ?? "?",
        count: l.count,
        minLevel: l.minLevel ?? null,
        drivers: l.drivers,
        certificateTypeIds: l.certificateTypeIds,
        certificateNames: certs.map((c) => c?.name ?? "?"),
      })
    }
    return {
      id: r._id,
      clientId: r.clientId,
      clientName: client?.name ?? "?",
      projectId: r.projectId ?? null,
      projectCode: project?.code ?? null,
      projectLabel: project ? `${project.code} ${project.name}` : (r.projectName ?? lines.map((l) => `${l.count} × ${l.tradeName}`).join(", ")),
      country: r.country,
      site: r.site,
      startDate: r.startDate,
      endDate: r.endDate ?? null,
      lines,
      languages: r.languages,
      notes: r.notes,
      crmRecordId: r.crmRecordId ?? null,
      status: r.status,
      needed: r.lines.reduce((s, l) => s + l.count, 0),
      picked,
      draft: r.draft ? { status: r.draft.status, at: r.draft.at, to: r.draft.to ?? null, error: r.draft.error ?? null } : null,
      createdAt: r._creationTime,
    }
  }

  async function proposalView(ctx: { db: unknown }, r: RequestDoc, view: RequestView): Promise<ProposalView> {
    const p = await buildProposal(ctx, r)
    const certificateNames = Object.fromEntries(p.catalog.certificateTypeList.map((c) => [c._id, c.name]))
    const tradeOf = (locale: "lt" | "en") => (id: string) => {
      const t = p.catalog.trades.get(id)
      return t ? (locale === "lt" ? t.nameLt : t.nameEn) : "?"
    }
    const certOf = (locale: "lt" | "en") => (id: string) => {
      const c = p.catalog.certificateTypes.get(id)
      return c ? (locale === "lt" ? c.name : (c.nameEn ?? c.name)) : "?"
    }
    const gapText = {
      lt: p.gaps.map((g) => describeGap(g, { trade: tradeOf("lt"), certificate: certOf("lt") }, "lt")),
      en: p.gaps.map((g) => describeGap(g, { trade: tradeOf("en"), certificate: certOf("en") }, "en")),
    }
    const client = await rd(ctx).get("staffing_clients", r.clientId)
    const draftInput: DraftInput = {
      clientName: view.clientName,
      contactName: client?.contacts[0]?.name ?? null,
      projectLabel: view.projectLabel,
      site: `${r.site}, ${r.country}`,
      startDate: r.startDate,
      endDate: r.endDate ?? null,
      lines: r.lines.map((line, i) => ({
        trade: tradeOf("en")(line.tradeId),
        count: line.count,
        members: p.selection
          .filter((s) => s.lineIndex === i)
          .map((s) => {
            const rc = p.ranked[i]?.find((x) => x.workerId === s.workerId)
            const lacking = new Set(rc?.warnings.filter((w) => w.code === "cert_missing" || w.code === "cert_expired").map((w) => w.certificateTypeId) ?? [])
            return {
              name: p.workerNames[s.workerId] ?? "?",
              level: rc?.level ?? "",
              isDriver: s.isDriver,
              certificates: line.certificateTypeIds.filter((id) => !lacking.has(id)).map(certOf("en")),
            }
          }),
      })),
      openPositions: p.gaps.filter((g) => g.kind === "people").map((g) => describeGap(g, { trade: tradeOf("en"), certificate: certOf("en") }, "en")),
    }
    return {
      lines: p.ranked.map((ranked) => ({ ranked })),
      selection: p.selection,
      edited: p.edited,
      gaps: p.gaps,
      gapText,
      workerNames: p.workerNames,
      certificateNames,
      draftInput,
      rules: p.rules,
      ruleWarnings: p.ruleWarnings,
      ruleText: { lt: p.ruleWarnings.map((w) => describeRuleWarning(w, "lt")), en: p.ruleWarnings.map((w) => describeRuleWarning(w, "en")) },
      ruleSwaps: p.ruleSwaps,
    }
  }

  async function loadRequest(ctx: { db: unknown }, id: RequestId, op: string): Promise<RequestDoc> {
    const r = await rd(ctx).get("staffing_teams_requests", id)
    if (!r) fail("NOT_FOUND", "request_not_found", op)
    return r
  }

  const requestFields = {
    clientId: v.id("staffing_clients"),
    projectId: v.optional(v.id("staffing_projects")),
    projectName: v.optional(v.string()),
    country: v.string(),
    site: v.string(),
    startDate: v.string(),
    endDate: v.optional(v.string()),
    lines: v.array(requestLineValidator),
    languages: v.optional(v.array(v.string())),
    notes: v.optional(v.string()),
    crmRecordId: v.optional(v.string()),
  }

  return {
    /** Requests, newest start first; `status` filters. */
    listRequests: queryGeneric({
      args: { ...actorArgs, status: v.optional(v.union(v.literal("open"), v.literal("proposed"), v.literal("confirmed"), v.literal("cancelled"))) },
      handler: async (ctx, a): Promise<RequestView[]> => {
        await system.requirePermission(ctx, P.requestRead, opts(a))
        const db = rd(ctx)
        const rows = a.status
          ? await db
              .query("staffing_teams_requests")
              .withIndex("by_status", (q) => q.eq("status", a.status!))
              .order("desc")
              .take(500)
          : (await db.query("staffing_teams_requests").take(500)).sort((x, y) => y.startDate.localeCompare(x.startDate))
        return Promise.all(rows.map((r) => requestView(ctx, r, r.selection ? r.selection.length : r.status === "confirmed" || r.status === "proposed" ? r.assignmentIds.length : null)))
      },
    }),

    /** One request with the ranked candidates, the shown team, its gaps and the draft template input. */
    getRequest: queryGeneric({
      args: { ...actorArgs, requestId: v.id("staffing_teams_requests") },
      handler: async (ctx, a): Promise<{ request: RequestView; proposal: ProposalView } | null> => {
        await system.requirePermission(ctx, P.requestRead, opts(a))
        const r = await rd(ctx).get("staffing_teams_requests", a.requestId)
        if (!r) return null
        const view = await requestView(ctx, r, null)
        const proposal = await proposalView(ctx, r, view)
        view.picked = proposal.selection.length
        return { request: view, proposal }
      },
    }),

    createRequest: mutationGeneric({
      args: { ...actorArgs, ...requestFields },
      handler: async (ctx, a) => {
        const { sys, actor } = await system.requirePermission(ctx, P.requestWrite, opts(a))
        const op = sys.operationId
        const db = wr(ctx)
        if (!(await db.get("staffing_clients", a.clientId))) fail("VALIDATION", "invalid_clientId", op, ["clientId"])
        if (a.projectId) {
          const p = await db.get("staffing_projects", a.projectId)
          if (!p || p.clientId !== a.clientId) fail("VALIDATION", "invalid_projectId", op, ["projectId"])
        }
        const startDate = cleanDate(a.startDate, "startDate", op)
        if (!startDate) fail("VALIDATION", "missing_startDate", op, ["startDate"])
        const endDate = cleanDate(a.endDate, "endDate", op)
        checkRange(startDate, endDate, op)
        if (!a.lines.length || a.lines.length > MAX_LINES) fail("VALIDATION", "invalid_lines", op, ["lines"])
        for (const l of a.lines) {
          if (!Number.isInteger(l.count) || l.count < 1 || l.count > MAX_COUNT) fail("VALIDATION", "invalid_count", op, ["lines"])
          if (!Number.isInteger(l.drivers) || l.drivers < 0 || l.drivers > l.count) fail("VALIDATION", "invalid_drivers", op, ["lines"])
          if (!(await db.get("staffing_trades", l.tradeId))) fail("VALIDATION", "invalid_trade", op, ["lines"])
          for (const c of l.certificateTypeIds) if (!(await db.get("staffing_certificateTypes", c))) fail("VALIDATION", "invalid_certificateType", op, ["lines"])
        }
        const languages = [...new Set((a.languages ?? []).map((l) => l.trim().toLowerCase()).filter(Boolean))]
        if (languages.some((l) => !LANGUAGE.test(l))) fail("VALIDATION", "invalid_languages", op, ["languages"])
        const projectName = a.projectId ? undefined : cleanText(a.projectName, 120, "projectName", op, false)
        const crmRecordId = cleanText(a.crmRecordId, 64, "crmRecordId", op, false)
        const id = await db.insert("staffing_teams_requests", {
          clientId: a.clientId,
          ...(a.projectId ? { projectId: a.projectId } : {}),
          ...(projectName ? { projectName } : {}),
          country: cleanCountry(a.country, "country", op),
          site: cleanText(a.site, 120, "site", op)!,
          startDate,
          ...(endDate ? { endDate } : {}),
          lines: a.lines.map((l) => ({ ...l, certificateTypeIds: [...new Set(l.certificateTypeIds)] })),
          languages,
          notes: cleanText(a.notes, 5000, "notes", op, false) ?? "",
          ...(crmRecordId ? { crmRecordId } : {}),
          status: "open",
          assignmentIds: [],
          createdBy: actorId(actor),
          updatedAt: Date.now(),
        })
        await recordAudit(sys, actor, { action: "staffing-teams.request.create", targetType: "staffing_teams_requests", targetId: id, changes: { clientId: a.clientId, lines: a.lines.length } })
        return { id, operationId: op }
      },
    }),

    /** Stores the planner's team (swap, remove, add, driver flags). `null` goes back to the engine's proposal. */
    saveSelection: mutationGeneric({
      args: { ...actorArgs, requestId: v.id("staffing_teams_requests"), selection: v.union(v.array(teamPickValidator), v.null()) },
      handler: async (ctx, a) => {
        const { sys, actor } = await system.requirePermission(ctx, P.requestWrite, opts(a))
        const op = sys.operationId
        const r = await loadRequest(ctx, a.requestId, op)
        if (r.status === "confirmed" || r.status === "cancelled") fail("CONFLICT", `request_${r.status}`, op)
        if (a.selection) {
          const seen = new Set<string>()
          for (const p of a.selection) {
            const line = r.lines[p.lineIndex]
            if (!line || !Number.isInteger(p.lineIndex)) fail("VALIDATION", "invalid_lineIndex", op, ["selection"])
            if (seen.has(p.workerId)) fail("VALIDATION", "duplicate_worker", op, ["selection"])
            seen.add(p.workerId)
            const w = await rd(ctx).get("staffing_workers", p.workerId)
            if (!w) fail("VALIDATION", "invalid_worker", op, ["selection"])
            if (!w.trades.some((t) => t.tradeId === line.tradeId)) fail("VALIDATION", "worker_lacks_trade", op, ["selection"])
          }
        }
        await wr(ctx).patch("staffing_teams_requests", r._id, { selection: a.selection ?? undefined, updatedAt: Date.now() })
        await recordAudit(sys, actor, { action: "staffing-teams.request.select", targetType: "staffing_teams_requests", targetId: r._id, changes: { picks: a.selection?.length ?? null } })
        return { operationId: op }
      },
    }),

    cancelRequest: mutationGeneric({
      args: { ...actorArgs, requestId: v.id("staffing_teams_requests") },
      handler: async (ctx, a) => {
        const { sys, actor } = await system.requirePermission(ctx, P.requestWrite, opts(a))
        const op = sys.operationId
        const r = await loadRequest(ctx, a.requestId, op)
        if (r.status === "confirmed") fail("CONFLICT", "request_confirmed", op)
        const db = wr(ctx)
        // Proposed assignments of this request are released.
        for (const id of r.assignmentIds) {
          const x = await db.get("staffing_assignments", id)
          if (x && x.status === "proposed") await db.patch("staffing_assignments", id, { status: "cancelled", updatedAt: Date.now() })
        }
        await db.patch("staffing_teams_requests", r._id, { status: "cancelled", updatedAt: Date.now() })
        await recordAudit(sys, actor, { action: "staffing-teams.request.cancel", targetType: "staffing_teams_requests", targetId: r._id })
        return { operationId: op }
      },
    }),

    /**
     * Turns the shown team into assignments on the request's project (a new
     * `draft` project when the request has none): `proposed` reserves without
     * blocking, `confirmed` blocks the workers. Base rules apply: active
     * worker with the trade, open project, and a confirmed assignment never
     * overlaps another one of the same worker (CONFLICT `worker_busy`, `fields`
     * = the busy worker IDs). Needs `staffing:assignment:create` too.
     */
    confirmTeam: mutationGeneric({
      args: { ...actorArgs, requestId: v.id("staffing_teams_requests"), status: v.union(v.literal("proposed"), v.literal("confirmed")) },
      handler: async (ctx, a) => {
        const { sys, actor } = await system.requirePermission(ctx, P.teamConfirm, opts(a))
        await system.requirePermission(ctx, StaffingPermissions.assignmentCreate, opts(a))
        const op = sys.operationId
        const db = wr(ctx)
        const r = await loadRequest(ctx, a.requestId, op)
        if (r.status === "confirmed" || r.status === "cancelled") fail("CONFLICT", `request_${r.status}`, op)
        const selection = (await buildProposal(ctx, r)).selection as (TeamPick & { workerId: WorkerId })[]
        if (!selection.length) fail("VALIDATION", "empty_team", op, ["selection"])

        // Checks first, writes after.
        let project = r.projectId ? await db.get("staffing_projects", r.projectId) : null
        if (r.projectId && !project) fail("NOT_FOUND", "project_not_found", op)
        if (project && !OPEN_PROJECT_STATUSES.includes(project.status)) fail("CONFLICT", "project_closed", op, ["projectId"])
        const own = new Set<string>(r.assignmentIds)
        const previous = (await Promise.all(r.assignmentIds.map((id) => db.get("staffing_assignments", id)))).filter((x) => x !== null)
        const busy: string[] = []
        for (const p of selection) {
          const w = await db.get("staffing_workers", p.workerId)
          const line = r.lines[p.lineIndex]
          if (!w || !line) fail("VALIDATION", "invalid_worker", op, ["selection"])
          if (w.status !== "active") fail("VALIDATION", "worker_inactive", op, [w._id])
          if (!w.trades.some((t) => t.tradeId === line.tradeId)) fail("VALIDATION", "worker_lacks_trade", op, [w._id])
          if (isBlockingAssignment({ status: a.status })) {
            const rows = await db
              .query("staffing_assignments")
              .withIndex("by_worker", (q) => q.eq("workerId", w._id))
              .collect()
            if (rows.some((o) => !own.has(o._id) && isBlockingAssignment(o) && rangesOverlap(o, { startDate: r.startDate, endDate: r.endDate }))) busy.push(w._id)
          }
        }
        if (busy.length) fail("CONFLICT", "worker_busy", op, busy)

        const now = Date.now()
        if (!project) {
          const client = await db.get("staffing_clients", r.clientId)
          if (!client) fail("NOT_FOUND", "client_not_found", op)
          let n = 1
          let code = ""
          do code = `${client.code}-${r.startDate.slice(0, 4)}-T${String(n++).padStart(2, "0")}`
          while (
            await db
              .query("staffing_projects")
              .withIndex("by_code", (q) => q.eq("code", code))
              .first()
          )
          const projectId: ProjectId = await db.insert("staffing_projects", {
            clientId: r.clientId,
            name: r.projectName ?? `${r.site}: ${r.lines.length} ${r.lines.length === 1 ? "line" : "lines"}`,
            code,
            country: r.country,
            city: r.site,
            startDate: r.startDate,
            ...(r.endDate ? { endDate: r.endDate } : {}),
            status: "draft",
            rates: [],
            currency: "EUR",
            notes: r.notes,
            updatedAt: now,
          })
          await recordAudit(sys, actor, { action: "staffing.project.create", targetType: "staffing_projects", targetId: projectId, changes: { code, from: "staffing-teams" } })
          project = (await db.get("staffing_projects", projectId))!
        }

        const ids: DM["staffing_assignments"]["document"]["_id"][] = []
        const kept = new Set<string>()
        for (const p of selection) {
          const line = r.lines[p.lineIndex]!
          const prior = previous.find((x) => x.workerId === p.workerId && x.tradeId === line.tradeId && x.status !== "cancelled" && !kept.has(x._id))
          if (prior) {
            kept.add(prior._id)
            await db.patch("staffing_assignments", prior._id, { status: a.status, isDriver: p.isDriver, startDate: r.startDate, endDate: r.endDate, updatedAt: now })
            ids.push(prior._id)
          } else {
            ids.push(
              await db.insert("staffing_assignments", {
                projectId: project._id,
                workerId: p.workerId,
                tradeId: line.tradeId,
                startDate: r.startDate,
                ...(r.endDate ? { endDate: r.endDate } : {}),
                status: a.status,
                isDriver: p.isDriver,
                notes: "",
                createdBy: actorId(actor),
                updatedAt: now,
              }),
            )
          }
        }
        for (const x of previous) if (!kept.has(x._id) && x.status === "proposed") await db.patch("staffing_assignments", x._id, { status: "cancelled", updatedAt: now })
        await db.patch("staffing_teams_requests", r._id, { status: a.status, projectId: project._id, assignmentIds: ids, selection: [...selection], updatedAt: now })
        await recordAudit(sys, actor, { action: "staffing-teams.team.confirm", targetType: "staffing_teams_requests", targetId: r._id, changes: { status: a.status, projectId: project._id, workers: ids.length } })
        return { projectId: project._id, assignments: ids.length, operationId: op }
      },
    }),

    /**
     * Asks n8n (`dr-nuoma-komandos-pasiulymas`) to write the answer-to-client
     * draft with AI and mail it to the project manager (the current user, else
     * the first super user), never to the client. Without `N8N_URL` the draft
     * status becomes `not_configured`; the UI's local template still works.
     */
    requestClientDraft: mutationGeneric({
      args: { ...actorArgs, requestId: v.id("staffing_teams_requests") },
      handler: async (ctx, a) => {
        const { sys, actor } = await system.requirePermission(ctx, P.draftSend, opts(a))
        const op = sys.operationId
        const r = await loadRequest(ctx, a.requestId, op)
        if (r.status === "cancelled") fail("CONFLICT", "request_cancelled", op)
        const view = await requestView(ctx, r, null)
        const p = await proposalView(ctx, r, view)
        const identity = await ctx.auth.getUserIdentity()
        const firstSuper = (process.env.SUPER_USER_EMAILS ?? "").split(/[,\s]+/).find(Boolean)
        const to = (typeof identity?.email === "string" && identity.email) || firstSuper
        if (!to) fail("VALIDATION", "no_recipient", op)
        const payload = {
          to,
          ...(process.env.APP_ENV !== "production" && firstSuper ? { redirectTo: firstSuper } : {}),
          language: "lt",
          clientName: view.clientName,
          request: {
            project: view.projectLabel,
            site: `${r.site}, ${r.country}`,
            startDate: r.startDate,
            endDate: r.endDate ?? null,
            lines: view.lines.map((l) => ({ trade: l.tradeNameEn, count: l.count, drivers: l.drivers, certificates: l.certificateNames })),
            notes: r.notes,
          },
          team: p.draftInput.lines.flatMap((l) => l.members.map((m) => ({ name: m.name, trade: l.trade, isDriver: m.isDriver, certificates: m.certificates }))),
          missing: p.gapText.lt,
        }
        await wr(ctx).patch("staffing_teams_requests", r._id, { draft: { status: "pending", at: Date.now(), to }, updatedAt: Date.now() })
        await ctx.scheduler.runAfter(0, ref("_sendClientDraft") as never, { requestId: r._id, payload } as never)
        await recordAudit(sys, actor, { action: "staffing-teams.draft.request", targetType: "staffing_teams_requests", targetId: r._id, changes: { team: payload.team.length } })
        return { operationId: op }
      },
    }),

    /** Posts the draft request to n8n; records the outcome on the request. */
    _sendClientDraft: internalActionGeneric({
      args: { requestId: v.id("staffing_teams_requests"), payload: v.any() },
      handler: async (ctx, a) => {
        const url = process.env.N8N_URL
        const secret = process.env.N8N_WEBHOOK_SECRET
        let status: DraftStatus = "sent"
        let error: string | undefined
        if (!url || !secret) status = "not_configured"
        else {
          try {
            const res = await fetch(`${url.replace(/\/+$/, "")}/webhook/dr-nuoma-komandos-pasiulymas`, {
              method: "POST",
              headers: { "Content-Type": "application/json", "X-Webhook-Secret": secret },
              body: JSON.stringify(a.payload),
            })
            if (!res.ok) {
              status = "failed"
              error = `HTTP ${res.status}`
            }
          } catch (e) {
            status = "failed"
            error = e instanceof Error ? e.message.slice(0, 200) : "fetch failed"
          }
        }
        await ctx.runMutation(ref("_recordDraftResult") as never, { requestId: a.requestId, status, ...(error ? { error } : {}) } as never)
        return { status }
      },
    }),

    _recordDraftResult: internalMutationGeneric({
      args: { requestId: v.id("staffing_teams_requests"), status: v.union(v.literal("sent"), v.literal("not_configured"), v.literal("failed")), error: v.optional(v.string()) },
      handler: async (ctx, a) => {
        const db = wr(ctx)
        const r = await db.get("staffing_teams_requests", a.requestId)
        if (!r) return
        await db.patch("staffing_teams_requests", r._id, { draft: { status: a.status, at: Date.now(), ...(r.draft?.to ? { to: r.draft.to } : {}), ...(a.error ? { error: a.error } : {}) } })
      },
    }),

    ...defineTeamsSeed(),
  }
}

export type TeamsFunctions = ReturnType<typeof defineTeams>

