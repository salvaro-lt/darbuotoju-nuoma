// DIG-111: dispute cases. One case = one worker × one period with the disputed
// hours and their value in EUR (project sell rate of the worker's trade), the
// three sources' numbers when it was opened, a status and a timeline.
// Opened in one click from a three-source / reconciliation mismatch, from a
// worker's "nesutinku", or by hand when the client re-checks an approved period.
import { mutationGeneric, queryGeneric } from "convex/server"
import { v } from "convex/values"
import { recordAudit, type Actor, type ConvexSystem, type SystemContext } from "@digimuza/system-core/convex"
import { projectSellRate } from "../operations"
import { addDays, rangeCovers } from "../pure"
import { actorArgs, actorId, checkRange, cleanDate, cleanText, fail, opts, type DbCtxLike, type ProjectId, type WorkerDoc } from "../shared"
import { StaffingTimesheetsPermissions as P } from "./manifest"
import { tsReader } from "./operations"
import { compareSources, disputeAmountCents, disputeTotals, isDisagreement, isOpenDispute, roundHours, type DisputeKind, type DisputeStatus, type DisputeTotals } from "./pure"
import { clientDays, projectWorkers, RECORDABLE, tsWriter } from "./reads"
import { disputeKindValidator, disputeStatusValidator } from "./tables"

export interface DisputeLine {
  date: string
  worker: number | null
  ours: number | null
  client: number | null
  flag?: string
}

export interface DisputeListItem {
  id: string
  workerId: string
  workerName: string
  projectId: string
  projectCode: string
  clientName: string
  periodFrom: string
  periodTo: string
  kind: DisputeKind
  status: DisputeStatus
  hours: number
  amountCents: number
  currency: string
  title: string
  createdAt: number
  updatedAt: number
  /** Days since it was opened (for "pakibę nuo"). */
  ageDays: number
}

export interface DisputeDetail extends DisputeListItem {
  rateCents: number
  sources: { worker: number | null; ours: number | null; client: number | null }
  lines: DisputeLine[]
  sheetId: string | null
  projectName: string
  timeline: { at: number; by: string; byName: string | null; kind: "created" | "status" | "note"; status: DisputeStatus | null; note: string | null }[]
  resolvedAt: number | null
}

/**
 * The three sources of one worker on one project within `[from, to]`: totals
 * and the disagreeing (or flagged) days. `claimed − client` is what the
 * client does not pay for.
 */
export async function periodSources(ctx: DbCtxLike, workerId: WorkerDoc["_id"], projectId: ProjectId, from: string, to: string) {
  const db = tsReader(ctx)
  const ours = (
    await db
      .query("staffing_timesheets_entries")
      .withIndex("by_worker_date", (q) => q.eq("workerId", workerId).gte("date", from).lte("date", to))
      .collect()
  ).filter((e) => e.projectId === projectId)
  const mine = (
    await db
      .query("staffing_timesheets_workerEntries")
      .withIndex("by_worker_date", (q) => q.eq("workerId", workerId).gte("date", from).lte("date", to))
      .collect()
  ).filter((e) => e.projectId === projectId)
  const { client, covered } = await clientDays(ctx, projectId, from, to)
  const coveredSet = new Set(covered)
  const lines: DisputeLine[] = []
  const totals = { worker: null as number | null, ours: null as number | null, client: null as number | null }
  const add = (k: keyof typeof totals, h: number | null) => {
    if (h !== null) totals[k] = roundHours((totals[k] ?? 0) + h)
  }
  let claimedOnClientDays = 0
  let clientOnClientDays = 0
  for (let date = from; date <= to; date = addDays(date, 1)) {
    const o = ours.filter((e) => e.date === date).reduce<number | null>((s, e) => (s ?? 0) + e.regularHours + e.overtimeHours, null)
    const m = mine.find((e) => e.date === date)
    const w = m && (m.regularHours + m.overtimeHours > 0 || !m.disagree) ? m.regularHours + m.overtimeHours : null
    const c = client.filter((r) => r.workerId === workerId && r.date === date).reduce<number | null>((s, r) => (s ?? 0) + r.hours, null) ?? (coveredSet.has(date) ? 0 : null)
    add("worker", w)
    add("ours", o)
    add("client", c)
    const cmp = compareSources({ worker: w, ours: o, client: c })
    if (c !== null && cmp.claimed !== null) {
      claimedOnClientDays += cmp.claimed
      clientOnClientDays += c
    }
    if (isDisagreement(cmp.kind) || m?.disagree) lines.push({ date, worker: w, ours: o, client: c, ...(m?.disagree ? { flag: m.disagree.comment } : {}) })
  }
  return { sources: totals, lines, disputedHours: roundHours(claimedOnClientDays - clientOnClientDays) }
}

async function actorName(sys: SystemContext, actor: Actor): Promise<string | undefined> {
  if (actor.kind !== "user") return undefined
  const u = (await sys.store.get("users", actor.userId)) as { displayName?: string; email?: string } | null
  return u?.displayName || u?.email || undefined
}

export function defineTimesheetsDisputes(system: ConvexSystem) {
  async function listItem(ctx: DbCtxLike, d: Awaited<ReturnType<typeof getDispute>>): Promise<DisputeListItem | null> {
    if (!d) return null
    const db = tsReader(ctx)
    const w = await db.get("staffing_workers", d.workerId)
    const p = await db.get("staffing_projects", d.projectId)
    const c = p ? await db.get("staffing_clients", p.clientId) : null
    return {
      id: d._id,
      workerId: d.workerId,
      workerName: w ? `${w.lastName} ${w.firstName}` : "?",
      projectId: d.projectId,
      projectCode: p?.code ?? "?",
      clientName: c?.name ?? "?",
      periodFrom: d.periodFrom,
      periodTo: d.periodTo,
      kind: d.kind,
      status: d.status,
      hours: d.hours,
      amountCents: d.amountCents,
      currency: d.currency,
      title: d.title,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
      ageDays: Math.max(0, Math.floor((Date.now() - Date.parse(`${d.periodFrom}T00:00:00Z`)) / 86_400_000)),
    }
  }
  const getDispute = (ctx: DbCtxLike, id: string) => tsReader(ctx).get("staffing_timesheets_disputes", id as never)

  return {
    /** Every worker ever on a project (not cancelled), for the "new dispute" picker. */
    listProjectWorkers: queryGeneric({
      args: { ...actorArgs, projectId: v.id("staffing_projects") },
      handler: async (ctx, a): Promise<{ id: string; name: string }[]> => {
        await system.requirePermission(ctx, P.read, opts(a))
        return (await projectWorkers(ctx, a.projectId)).map((w) => ({ id: w._id, name: `${w.lastName} ${w.firstName}` })).sort((x, y) => x.name.localeCompare(y.name))
      },
    }),

    /** Dispute cases (newest first) and the totals: "Pakibę" = open + waiting for the client. */
    listDisputes: queryGeneric({
      args: { ...actorArgs, status: v.optional(v.union(v.literal("open"), v.literal("closed"), v.literal("all"))), projectId: v.optional(v.id("staffing_projects")) },
      handler: async (ctx, a): Promise<{ totals: DisputeTotals; items: DisputeListItem[] }> => {
        await system.requirePermission(ctx, P.read, opts(a))
        const db = tsReader(ctx)
        const all = a.projectId
          ? await db
              .query("staffing_timesheets_disputes")
              .withIndex("by_project", (q) => q.eq("projectId", a.projectId!))
              .collect()
          : await db.query("staffing_timesheets_disputes").withIndex("by_status").collect()
        const totals = disputeTotals(all)
        const want = a.status ?? "open"
        const picked = all.filter((d) => want === "all" || (want === "open") === isOpenDispute(d.status)).sort((x, y) => y.createdAt - x.createdAt)
        const items: DisputeListItem[] = []
        for (const d of picked.slice(0, 200)) {
          const item = await listItem(ctx, d)
          if (item) items.push(item)
        }
        return { totals, items }
      },
    }),

    getDispute: queryGeneric({
      args: { ...actorArgs, disputeId: v.id("staffing_timesheets_disputes") },
      handler: async (ctx, a): Promise<DisputeDetail | null> => {
        await system.requirePermission(ctx, P.read, opts(a))
        const d = await getDispute(ctx, a.disputeId)
        const item = await listItem(ctx, d)
        if (!d || !item) return null
        const p = await tsReader(ctx).get("staffing_projects", d.projectId)
        return {
          ...item,
          rateCents: d.rateCents,
          sources: d.sources,
          lines: d.lines,
          sheetId: d.sheetId ?? null,
          projectName: p?.name ?? "?",
          timeline: d.timeline.map((e) => ({ at: e.at, by: e.by, byName: e.byName ?? null, kind: e.kind, status: e.status ?? null, note: e.note ?? null })),
          resolvedAt: d.resolvedAt ?? null,
        }
      },
    }),

    /**
     * Opens a case for a worker × period. Without `hours` the disputed hours
     * are what we claim minus what the client's sheets say (worker's own
     * hours first, else ours); `client_recheck` cases take `hours` by hand.
     * An open case of the same worker, project and period is returned instead
     * of a duplicate (`existing: true`).
     */
    createDispute: mutationGeneric({
      args: {
        ...actorArgs,
        workerId: v.id("staffing_workers"),
        projectId: v.id("staffing_projects"),
        periodFrom: v.string(),
        periodTo: v.string(),
        kind: disputeKindValidator,
        hours: v.optional(v.number()),
        title: v.optional(v.string()),
        note: v.optional(v.string()),
        sheetId: v.optional(v.id("staffing_timesheets_clientSheets")),
      },
      handler: async (ctx, a) => {
        const { sys, actor } = await system.requirePermission(ctx, P.clientManage, opts(a))
        const op = sys.operationId
        const from = cleanDate(a.periodFrom, "periodFrom", op)!
        const to = cleanDate(a.periodTo, "periodTo", op)!
        checkRange(from, to, op, "periodTo")
        if (to > addDays(from, 186)) fail("VALIDATION", "period_too_long", op, ["periodTo"])
        const note = cleanText(a.note, 1000, "note", op, false)
        const db = tsWriter(ctx)
        const worker = await db.get("staffing_workers", a.workerId)
        if (!worker) fail("NOT_FOUND", "worker_not_found", op)
        const project = await db.get("staffing_projects", a.projectId)
        if (!project) fail("NOT_FOUND", "project_not_found", op)
        const assignment = (
          await db
            .query("staffing_assignments")
            .withIndex("by_worker", (q) => q.eq("workerId", worker._id))
            .collect()
        )
          .filter((x) => x.projectId === project._id && RECORDABLE.has(x.status))
          .sort((x, y) => Number(rangeCovers(y, to)) - Number(rangeCovers(x, to)))[0]
        if (!assignment) fail("CONFLICT", "no_assignment", op)
        const dup = (
          await db
            .query("staffing_timesheets_disputes")
            .withIndex("by_worker", (q) => q.eq("workerId", worker._id))
            .collect()
        ).find((d) => d.projectId === project._id && isOpenDispute(d.status) && d.periodFrom === from && d.periodTo === to && d.kind === a.kind)
        if (dup) return { id: dup._id, existing: true, operationId: op }
        const src = await periodSources(ctx, worker._id, project._id, from, to)
        const hours = a.hours === undefined ? src.disputedHours : roundHours(a.hours)
        if (!Number.isFinite(hours) || hours <= 0 || hours > 2000) fail("VALIDATION", a.hours === undefined ? "nothing_disputed" : "invalid_hours", op, ["hours"])
        const rateCents = (await projectSellRate(ctx, project._id, assignment.tradeId)) ?? 0
        const title = cleanText(a.title, 200, "title", op, false) ?? (a.kind === "client_recheck" ? "Kliento pakartotinis patikrinimas" : a.kind === "worker_flag" ? "Darbuotojas nesutinka su kliento tabeliu" : "Kliento tabelis nesutampa")
        const now = Date.now()
        const by = actorId(actor)
        const byName = await actorName(sys, actor)
        const id = await db.insert("staffing_timesheets_disputes", {
          workerId: worker._id,
          projectId: project._id,
          periodFrom: from,
          periodTo: to,
          kind: a.kind,
          status: "open",
          hours,
          rateCents,
          amountCents: disputeAmountCents(hours, rateCents),
          currency: project.currency,
          title,
          sources: src.sources,
          lines: src.lines.slice(0, 200),
          ...(a.sheetId ? { sheetId: a.sheetId } : {}),
          timeline: [{ at: now, by, ...(byName ? { byName } : {}), kind: "created", status: "open", ...(note ? { note } : {}) }],
          createdAt: now,
          createdBy: by,
          updatedAt: now,
        })
        await recordAudit(sys, actor, { action: "staffing-timesheets.dispute.create", targetType: "staffing_timesheets_disputes", targetId: id, changes: { workerId: worker._id, projectId: project._id, from, to, hours, kind: a.kind } })
        return { id, existing: false, operationId: op }
      },
    }),

    setDisputeStatus: mutationGeneric({
      args: { ...actorArgs, disputeId: v.id("staffing_timesheets_disputes"), status: disputeStatusValidator, note: v.optional(v.string()) },
      handler: async (ctx, a) => {
        const { sys, actor } = await system.requirePermission(ctx, P.clientManage, opts(a))
        const op = sys.operationId
        const note = cleanText(a.note, 1000, "note", op, false)
        const db = tsWriter(ctx)
        const d = await db.get("staffing_timesheets_disputes", a.disputeId)
        if (!d) fail("NOT_FOUND", "dispute_not_found", op)
        if (d.status === a.status && !note) return { operationId: op }
        const now = Date.now()
        const byName = await actorName(sys, actor)
        await db.patch("staffing_timesheets_disputes", d._id, {
          status: a.status,
          updatedAt: now,
          resolvedAt: isOpenDispute(a.status) ? undefined : now,
          timeline: [...d.timeline, { at: now, by: actorId(actor), ...(byName ? { byName } : {}), kind: "status", status: a.status, ...(note ? { note } : {}) }],
        })
        await recordAudit(sys, actor, { action: "staffing-timesheets.dispute.status", targetType: "staffing_timesheets_disputes", targetId: d._id, changes: { from: d.status, to: a.status } })
        return { operationId: op }
      },
    }),

    addDisputeNote: mutationGeneric({
      args: { ...actorArgs, disputeId: v.id("staffing_timesheets_disputes"), note: v.string() },
      handler: async (ctx, a) => {
        const { sys, actor } = await system.requirePermission(ctx, P.clientManage, opts(a))
        const op = sys.operationId
        const note = cleanText(a.note, 1000, "note", op)!
        const db = tsWriter(ctx)
        const d = await db.get("staffing_timesheets_disputes", a.disputeId)
        if (!d) fail("NOT_FOUND", "dispute_not_found", op)
        const now = Date.now()
        const byName = await actorName(sys, actor)
        await db.patch("staffing_timesheets_disputes", d._id, { updatedAt: now, timeline: [...d.timeline, { at: now, by: actorId(actor), ...(byName ? { byName } : {}), kind: "note", note }] })
        await recordAudit(sys, actor, { action: "staffing-timesheets.dispute.note", targetType: "staffing_timesheets_disputes", targetId: d._id })
        return { operationId: op }
      },
    }),
  }
}
