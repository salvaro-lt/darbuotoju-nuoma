// DIG-111: the worker as a third source of hours.
//
// - Personal links (`/h/<token>`, no login, like the signing page): the worker
//   enters own hours per day, sees ours and the client's once imported, and
//   marks a day "nesutinku". Public functions take only the token; an unknown,
//   revoked or malformed token reveals nothing (`not_found`), a disabled module
//   answers `unavailable`.
// - Coordinator: links per project (copy, email via n8n `dr-nuoma-pranesimas`,
//   printable QR list) and the three-source comparison (worker / ours / client).
// Disputes and the email intake live in ./disputes.ts and ./intake.ts.
import { internalActionGeneric, internalMutationGeneric, internalQueryGeneric, mutationGeneric, queryGeneric } from "convex/server"
import { v } from "convex/values"
import { isModuleEnabled, notifyIfInstalled, recordAudit, type ConvexSystem } from "@digimuza/system-core/convex"
import { addDays, fullName, rangeCovers, todayIso } from "../pure"
import { actorArgs, actorId, cleanDate, cleanText, fail, opts, type DbCtxLike, type ProjectId, type WorkerDoc } from "../shared"
import { defineTimesheetsDisputes } from "./disputes"
import { defineTimesheetsIntake } from "./intake"
import { STAFFING_TIMESHEETS_MODULE_ID, StaffingTimesheetsPermissions as P } from "./manifest"
import { tsReader, type TimesheetsDataModel } from "./operations"
import { compareSources, hoursProblem, roundHours, threeWay, weekDays, weekStartOf, WORKER_EDIT_DAYS, WORKER_TOKEN, type ReminderStatus, type SourceComparison, type ThreeWayResult } from "./pure"
import { clientDays, projectWorkers, RECORDABLE, tsWriter } from "./reads"

export interface SourcesDeps {
  /** Reference to a function re-exported from the app's timesheets file. */
  ref: (name: string) => never
}

type AssignmentDoc = TimesheetsDataModel["staffing_assignments"]["document"]

async function recordableAssignmentsOf(ctx: DbCtxLike, workerId: WorkerDoc["_id"]): Promise<AssignmentDoc[]> {
  return (
    await tsReader(ctx)
      .query("staffing_assignments")
      .withIndex("by_worker", (q) => q.eq("workerId", workerId))
      .collect()
  ).filter((a) => RECORDABLE.has(a.status))
}

/** The assignment to show first: covering today, else the next one, else the last one. */
function currentAssignment(assignments: AssignmentDoc[], today: string): AssignmentDoc | null {
  const now = assignments.find((a) => rangeCovers(a, today))
  if (now) return now
  const next = assignments.filter((a) => a.startDate > today).sort((a, b) => a.startDate.localeCompare(b.startDate))[0]
  if (next) return next
  return assignments.sort((a, b) => (b.endDate ?? "9999").localeCompare(a.endDate ?? "9999"))[0] ?? null
}

function newToken(): string {
  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")
}

// ---------------------------------------------------------------- views

export type WorkerPortal =
  | { state: "not_found" | "unavailable" }
  | {
      state: "ok"
      worker: { firstName: string; lastName: string }
      /** UI language suggestion (lt for Lithuanian speakers, else en). */
      locale: "lt" | "en"
      current: { projectCode: string; projectName: string; clientName: string; city: string; trade: string; startDate: string; endDate: string | null } | null
      weekStart: string
      today: string
      /** Earliest day the worker may still change. */
      editableFrom: string
      days: {
        date: string
        project: { code: string; name: string } | null
        editable: boolean
        mine: { regular: number; overtime: number; note: string | null; disagree: string | null } | null
        ours: number | null
        client: number | null
        clientCovered: boolean
        kind: SourceComparison["kind"]
        diff: number
      }[]
      totals: { mine: number; ours: number; client: number }
    }

export interface WorkerLinkRow {
  workerId: string
  workerName: string
  trade: string
  email: string | null
  phone: string
  startDate: string
  endDate: string | null
  link: { id: string; token: string; createdAt: number; lastSentAt: number | null; lastSentTo: string | null; lastSendStatus: ReminderStatus | null; lastActivityAt: number | null } | null
  /** Days with own hours entered in the last 7 days. */
  recentDays: number
  /** Open "nesutinku" marks. */
  flags: number
}

export interface ThreeWayView extends ThreeWayResult {
  project: { id: string; code: string; name: string; clientName: string }
  weekStart: string
  days: string[]
  /** Workers with an active personal link. */
  linked: string[]
}

export function defineTimesheetsSources(system: ConvexSystem, deps: SourcesDeps) {
  const { ref } = deps

  async function moduleOn(ctx: DbCtxLike): Promise<boolean> {
    const { sys } = await system.context(ctx as never)
    return isModuleEnabled(sys, await sys.store.get("modules", STAFFING_TIMESHEETS_MODULE_ID))
  }

  /** The guard of every public function: a well-formed, active token of an active worker, module on. */
  async function byWorkerToken(ctx: DbCtxLike, token: string) {
    if (!(await moduleOn(ctx))) return { state: "unavailable" as const }
    if (typeof token !== "string" || !WORKER_TOKEN.test(token)) return { state: "not_found" as const }
    const db = tsReader(ctx)
    const link = await db
      .query("staffing_timesheets_workerLinks")
      .withIndex("by_token", (q) => q.eq("token", token))
      .unique()
    if (!link || link.revokedAt) return { state: "not_found" as const }
    const worker = await db.get("staffing_workers", link.workerId)
    if (!worker || worker.status !== "active") return { state: "not_found" as const }
    return { state: "ok" as const, link, worker }
  }

  /** Throws NOT_FOUND / UNAVAILABLE for the public mutations (same answer for every bad token). */
  async function requireWorker(ctx: DbCtxLike, token: string) {
    const found = await byWorkerToken(ctx, token)
    if (found.state === "unavailable") fail("UNAVAILABLE", "module_disabled", "worker-link")
    if (found.state !== "ok") fail("NOT_FOUND", "link_not_found", "worker-link")
    return found
  }

  async function workerEntryOf(ctx: DbCtxLike, workerId: WorkerDoc["_id"], date: string) {
    return tsReader(ctx)
      .query("staffing_timesheets_workerEntries")
      .withIndex("by_worker_date", (q) => q.eq("workerId", workerId).eq("date", date))
      .first()
  }

  /** A day the worker may write: within the edit window, not in the future, covered by a recordable assignment. */
  async function writableDay(ctx: DbCtxLike, worker: WorkerDoc, date: string) {
    const op = "worker-link"
    const d = cleanDate(date, "date", op)!
    const today = todayIso()
    if (d > today) fail("VALIDATION", "future_date", op, ["date"])
    if (d < addDays(today, -WORKER_EDIT_DAYS)) fail("VALIDATION", "too_old", op, ["date"])
    const assignment = (await recordableAssignmentsOf(ctx, worker._id)).find((a) => rangeCovers(a, d))
    if (!assignment) fail("CONFLICT", "no_assignment", op, ["date"])
    return { date: d, assignment }
  }

  async function threeWayFor(ctx: DbCtxLike, projectId: ProjectId, monday: string): Promise<ThreeWayView | null> {
    const db = tsReader(ctx)
    const p = await db.get("staffing_projects", projectId)
    if (!p) return null
    const client = await db.get("staffing_clients", p.clientId)
    const days = weekDays(monday)
    const sunday = days[6]!
    const assignments = (
      await db
        .query("staffing_assignments")
        .withIndex("by_project", (q) => q.eq("projectId", p._id).lte("startDate", sunday))
        .collect()
    ).filter((x) => RECORDABLE.has(x.status) && (!x.endDate || x.endDate >= monday))
    const workers = await projectWorkers(ctx, p._id)
    const byId = new Map(workers.map((w) => [w._id as string, w]))
    const people = [...new Set(assignments.map((a) => a.workerId as string))].filter((id) => byId.has(id)).map((id) => ({ workerId: id, name: `${byId.get(id)!.lastName} ${byId.get(id)!.firstName}` }))
    const ours = await db
      .query("staffing_timesheets_entries")
      .withIndex("by_project_date", (q) => q.eq("projectId", p._id).gte("date", monday).lte("date", sunday))
      .collect()
    const mine = await db
      .query("staffing_timesheets_workerEntries")
      .withIndex("by_project_date", (q) => q.eq("projectId", p._id).gte("date", monday).lte("date", sunday))
      .collect()
    const { client: theirs, covered } = await clientDays(ctx, p._id, monday, sunday, workers)
    const result = threeWay({
      days,
      people,
      ours: ours.map((e) => ({ workerId: e.workerId, date: e.date, hours: e.regularHours + e.overtimeHours })),
      worker: mine.filter((e) => e.regularHours + e.overtimeHours > 0 || !e.disagree).map((e) => ({ workerId: e.workerId, date: e.date, hours: e.regularHours + e.overtimeHours })),
      client: theirs,
      clientCovered: covered,
      flags: mine.filter((e) => e.disagree).map((e) => ({ workerId: e.workerId, date: e.date, comment: e.disagree!.comment })),
    })
    const linked: string[] = []
    for (const person of people) {
      const l = await db
        .query("staffing_timesheets_workerLinks")
        .withIndex("by_worker", (q) => q.eq("workerId", person.workerId as never))
        .order("desc")
        .first()
      if (l && !l.revokedAt) linked.push(person.workerId)
    }
    return { ...result, project: { id: p._id, code: p.code, name: p.name, clientName: client?.name ?? "?" }, weekStart: monday, days, linked }
  }

  async function activeLink(ctx: DbCtxLike, workerId: WorkerDoc["_id"]) {
    const l = await tsReader(ctx)
      .query("staffing_timesheets_workerLinks")
      .withIndex("by_worker", (q) => q.eq("workerId", workerId))
      .order("desc")
      .first()
    return l && !l.revokedAt ? l : null
  }

  async function ensureLink(ctx: DbCtxLike, workerId: WorkerDoc["_id"], by: string) {
    const existing = await activeLink(ctx, workerId)
    if (existing) return { id: existing._id, token: existing.token, created: false }
    const token = newToken()
    const id = await tsWriter(ctx).insert("staffing_timesheets_workerLinks", { workerId, token, createdAt: Date.now(), createdBy: by })
    return { id, token, created: true }
  }

  return {
    ...defineTimesheetsDisputes(system),
    ...defineTimesheetsIntake(system, deps),

    // ---------------------------------------------------------------- public (token)

    /** The worker's week on the personal link. Unknown / revoked / malformed token → `not_found`. */
    workerPortal: queryGeneric({
      args: { token: v.string(), weekStart: v.optional(v.string()) },
      handler: async (ctx, a): Promise<WorkerPortal> => {
        const found = await byWorkerToken(ctx, a.token)
        if (found.state !== "ok") return { state: found.state }
        const { worker } = found
        const db = tsReader(ctx)
        const today = todayIso()
        const asked = a.weekStart && /^\d{4}-\d{2}-\d{2}$/.test(a.weekStart) ? a.weekStart : today
        const monday = weekStartOf(asked > today ? today : asked)
        const days = weekDays(monday)
        const sunday = days[6]!
        const assignments = await recordableAssignmentsOf(ctx, worker._id)
        const cur = currentAssignment([...assignments], today)
        const projects = new Map<string, TimesheetsDataModel["staffing_projects"]["document"] | null>()
        const projectOf = async (id: ProjectId) => {
          if (!projects.has(id)) projects.set(id, await db.get("staffing_projects", id))
          return projects.get(id) ?? null
        }
        let current: Extract<WorkerPortal, { state: "ok" }>["current"] = null
        if (cur) {
          const p = await projectOf(cur.projectId)
          const c = p ? await db.get("staffing_clients", p.clientId) : null
          const t = await db.get("staffing_trades", cur.tradeId)
          if (p) current = { projectCode: p.code, projectName: p.name, clientName: c?.name ?? "", city: p.city, trade: t?.nameLt ?? "", startDate: cur.startDate, endDate: cur.endDate ?? null }
        }
        const mine = await db
          .query("staffing_timesheets_workerEntries")
          .withIndex("by_worker_date", (q) => q.eq("workerId", worker._id).gte("date", monday).lte("date", sunday))
          .collect()
        const ours = await db
          .query("staffing_timesheets_entries")
          .withIndex("by_worker_date", (q) => q.eq("workerId", worker._id).gte("date", monday).lte("date", sunday))
          .collect()
        const clientBy = new Map<string, number>()
        const covered = new Set<string>()
        for (const pid of new Set(assignments.filter((x) => x.startDate <= sunday && (!x.endDate || x.endDate >= monday)).map((x) => x.projectId))) {
          const c = await clientDays(ctx, pid, monday, sunday)
          for (const d of c.covered) covered.add(d)
          for (const r of c.client) if (r.workerId === worker._id) clientBy.set(r.date, roundHours((clientBy.get(r.date) ?? 0) + r.hours))
        }
        const editableFrom = addDays(today, -WORKER_EDIT_DAYS)
        const out: Extract<WorkerPortal, { state: "ok" }>["days"] = []
        for (const date of days) {
          const x = assignments.find((as) => rangeCovers(as, date))
          const p = x ? await projectOf(x.projectId) : null
          const m = mine.find((e) => e.date === date)
          const oursH = ours.filter((e) => e.date === date).reduce<number | null>((s, e) => (s ?? 0) + e.regularHours + e.overtimeHours, null)
          const client = clientBy.get(date) ?? (covered.has(date) ? 0 : null)
          const mineH = m && m.regularHours + m.overtimeHours > 0 ? m.regularHours + m.overtimeHours : m?.disagree ? null : (m ? 0 : null)
          const cmp = compareSources({ worker: mineH, ours: oursH, client })
          out.push({
            date,
            project: p ? { code: p.code, name: p.name } : null,
            editable: Boolean(x) && date <= today && date >= editableFrom,
            mine: m ? { regular: m.regularHours, overtime: m.overtimeHours, note: m.note ?? null, disagree: m.disagree?.comment ?? null } : null,
            ours: oursH === null ? null : roundHours(oursH),
            client,
            clientCovered: covered.has(date),
            kind: cmp.kind,
            diff: cmp.diff,
          })
        }
        const lt = worker.nationality === "LT" || worker.languages.includes("lt")
        return {
          state: "ok",
          worker: { firstName: worker.firstName, lastName: worker.lastName },
          locale: lt ? "lt" : "en",
          current,
          weekStart: monday,
          today,
          editableFrom,
          days: out,
          totals: {
            mine: roundHours(out.reduce((s, d) => s + (d.mine ? d.mine.regular + d.mine.overtime : 0), 0)),
            ours: roundHours(out.reduce((s, d) => s + (d.ours ?? 0), 0)),
            client: roundHours(out.reduce((s, d) => s + (d.client ?? 0), 0)),
          },
        }
      },
    }),

    /** The worker saves own hours for a day (0 + 0 without a note or a "nesutinku" mark clears the day). */
    saveMyHours: mutationGeneric({
      args: { token: v.string(), date: v.string(), regularHours: v.number(), overtimeHours: v.number(), note: v.optional(v.string()) },
      handler: async (ctx, a) => {
        const { link, worker } = await requireWorker(ctx, a.token)
        const { date, assignment } = await writableDay(ctx, worker, a.date)
        const problem = hoursProblem(a.regularHours, a.overtimeHours)
        if (problem) fail("VALIDATION", problem, "worker-link", ["regularHours", "overtimeHours"])
        const note = cleanText(a.note, 300, "note", "worker-link", false)
        const db = tsWriter(ctx)
        const existing = await workerEntryOf(ctx, worker._id, date)
        const now = Date.now()
        if (a.regularHours + a.overtimeHours === 0 && !note && !existing?.disagree) {
          if (existing) await db.delete("staffing_timesheets_workerEntries", existing._id)
        } else if (existing) {
          await db.replace("staffing_timesheets_workerEntries", existing._id, {
            assignmentId: assignment._id,
            projectId: assignment.projectId,
            workerId: worker._id,
            date,
            regularHours: a.regularHours,
            overtimeHours: a.overtimeHours,
            ...(note ? { note } : {}),
            ...(existing.disagree ? { disagree: existing.disagree } : {}),
            updatedAt: now,
          })
        } else {
          await db.insert("staffing_timesheets_workerEntries", { assignmentId: assignment._id, projectId: assignment.projectId, workerId: worker._id, date, regularHours: a.regularHours, overtimeHours: a.overtimeHours, ...(note ? { note } : {}), updatedAt: now })
        }
        await db.patch("staffing_timesheets_workerLinks", link._id, { lastActivityAt: now })
        return { ok: true }
      },
    }),

    /** "Nesutinku": the worker disagrees with the client's (or our) hours for a day. Notifies the coordinators. */
    flagMyDay: mutationGeneric({
      args: { token: v.string(), date: v.string(), comment: v.string() },
      handler: async (ctx, a) => {
        const { link, worker } = await requireWorker(ctx, a.token)
        const { date, assignment } = await writableDay(ctx, worker, a.date)
        const comment = cleanText(a.comment, 500, "comment", "worker-link")!
        const db = tsWriter(ctx)
        const existing = await workerEntryOf(ctx, worker._id, date)
        const now = Date.now()
        if (existing) await db.patch("staffing_timesheets_workerEntries", existing._id, { disagree: { comment, at: now }, updatedAt: now })
        else await db.insert("staffing_timesheets_workerEntries", { assignmentId: assignment._id, projectId: assignment.projectId, workerId: worker._id, date, regularHours: 0, overtimeHours: 0, disagree: { comment, at: now }, updatedAt: now })
        await db.patch("staffing_timesheets_workerLinks", link._id, { lastActivityAt: now })
        const { sys } = await system.context(ctx)
        const p = await db.get("staffing_projects", assignment.projectId)
        await notifyIfInstalled(sys, {
          to: { permission: P.clientManage },
          type: "staffing-timesheets.worker_disagrees",
          params: { worker: fullName(worker), projectCode: p?.code ?? "", date, comment },
          href: `/app/timesheets/${assignment.projectId}?tab=sources&week=${weekStartOf(date)}`,
          actor: "system",
        })
        await recordAudit(sys, "system", { action: "staffing-timesheets.worker.disagree", targetType: "staffing_workers", targetId: worker._id, changes: { date, projectId: assignment.projectId } })
        return { ok: true }
      },
    }),

    clearMyFlag: mutationGeneric({
      args: { token: v.string(), date: v.string() },
      handler: async (ctx, a) => {
        const { worker } = await requireWorker(ctx, a.token)
        const { date } = await writableDay(ctx, worker, a.date)
        const existing = await workerEntryOf(ctx, worker._id, date)
        if (!existing?.disagree) return { ok: true }
        const db = tsWriter(ctx)
        if (existing.regularHours + existing.overtimeHours === 0 && !existing.note) await db.delete("staffing_timesheets_workerEntries", existing._id)
        else await db.patch("staffing_timesheets_workerEntries", existing._id, { disagree: undefined, updatedAt: Date.now() })
        return { ok: true }
      },
    }),

    // ---------------------------------------------------------------- coordinator

    /** Workers of a project (assignments overlapping the last 4 weeks onwards) with their personal link. */
    listWorkerLinks: queryGeneric({
      args: { ...actorArgs, projectId: v.id("staffing_projects") },
      handler: async (ctx, a): Promise<{ project: { id: string; code: string; name: string; clientName: string }; rows: WorkerLinkRow[] } | null> => {
        await system.requirePermission(ctx, P.write, opts(a))
        const db = tsReader(ctx)
        const p = await db.get("staffing_projects", a.projectId)
        if (!p) return null
        const client = await db.get("staffing_clients", p.clientId)
        const today = todayIso()
        const since = addDays(today, -28)
        const assignments = (
          await db
            .query("staffing_assignments")
            .withIndex("by_project", (q) => q.eq("projectId", p._id))
            .collect()
        ).filter((x) => RECORDABLE.has(x.status) && (!x.endDate || x.endDate >= since))
        const rows: WorkerLinkRow[] = []
        for (const x of assignments) {
          if (rows.some((r) => r.workerId === x.workerId)) continue
          const w = await db.get("staffing_workers", x.workerId)
          if (!w) continue
          const t = await db.get("staffing_trades", x.tradeId)
          const l = await activeLink(ctx, w._id)
          const recent = await db
            .query("staffing_timesheets_workerEntries")
            .withIndex("by_worker_date", (q) => q.eq("workerId", w._id).gte("date", addDays(today, -7)))
            .collect()
          rows.push({
            workerId: w._id,
            workerName: `${w.lastName} ${w.firstName}`,
            trade: t?.nameLt ?? "",
            email: w.email ?? null,
            phone: w.phone,
            startDate: x.startDate,
            endDate: x.endDate ?? null,
            link: l ? { id: l._id, token: l.token, createdAt: l.createdAt, lastSentAt: l.lastSentAt ?? null, lastSentTo: l.lastSentTo ?? null, lastSendStatus: l.lastSendStatus ?? null, lastActivityAt: l.lastActivityAt ?? null } : null,
            recentDays: recent.filter((e) => e.regularHours + e.overtimeHours > 0).length,
            flags: recent.filter((e) => e.disagree).length,
          })
        }
        rows.sort((x, y) => x.workerName.localeCompare(y.workerName))
        return { project: { id: p._id, code: p.code, name: p.name, clientName: client?.name ?? "?" }, rows }
      },
    }),

    /** Creates the missing personal links of a project's workers (or of one worker). Existing links stay. */
    createWorkerLinks: mutationGeneric({
      args: { ...actorArgs, projectId: v.id("staffing_projects"), workerId: v.optional(v.id("staffing_workers")) },
      handler: async (ctx, a) => {
        const { sys, actor } = await system.requirePermission(ctx, P.write, opts(a))
        const db = tsReader(ctx)
        if (!(await db.get("staffing_projects", a.projectId))) fail("NOT_FOUND", "project_not_found", sys.operationId)
        const assignments = (
          await db
            .query("staffing_assignments")
            .withIndex("by_project", (q) => q.eq("projectId", a.projectId))
            .collect()
        ).filter((x) => RECORDABLE.has(x.status) && (!a.workerId || x.workerId === a.workerId))
        if (a.workerId && !assignments.length) fail("CONFLICT", "no_assignment", sys.operationId)
        let created = 0
        for (const id of new Set(assignments.map((x) => x.workerId))) if ((await ensureLink(ctx, id, actorId(actor))).created) created++
        await recordAudit(sys, actor, { action: "staffing-timesheets.workerLink.create", targetType: "staffing_projects", targetId: a.projectId, changes: { created, workerId: a.workerId ?? null } })
        return { created, operationId: sys.operationId }
      },
    }),

    /** A new token for a worker (the old link stops working at once). */
    regenerateWorkerLink: mutationGeneric({
      args: { ...actorArgs, workerId: v.id("staffing_workers") },
      handler: async (ctx, a) => {
        const { sys, actor } = await system.requirePermission(ctx, P.write, opts(a))
        const db = tsWriter(ctx)
        if (!(await db.get("staffing_workers", a.workerId))) fail("NOT_FOUND", "worker_not_found", sys.operationId)
        const old = await activeLink(ctx, a.workerId)
        if (old) await db.patch("staffing_timesheets_workerLinks", old._id, { revokedAt: Date.now() })
        const l = await ensureLink(ctx, a.workerId, actorId(actor))
        await recordAudit(sys, actor, { action: "staffing-timesheets.workerLink.regenerate", targetType: "staffing_workers", targetId: a.workerId })
        return { token: l.token, operationId: sys.operationId }
      },
    }),

    /** Emails the worker the personal link (n8n `dr-nuoma-pranesimas`). Needs the worker's email. */
    sendWorkerLink: mutationGeneric({
      args: { ...actorArgs, workerId: v.id("staffing_workers") },
      handler: async (ctx, a) => {
        const { sys, actor } = await system.requirePermission(ctx, P.write, opts(a))
        const op = sys.operationId
        const db = tsWriter(ctx)
        const w = await db.get("staffing_workers", a.workerId)
        if (!w) fail("NOT_FOUND", "worker_not_found", op)
        if (!w.email) fail("VALIDATION", "worker_has_no_email", op, ["email"])
        const l = await ensureLink(ctx, w._id, actorId(actor))
        await db.patch("staffing_timesheets_workerLinks", l.id, { lastSentAt: Date.now(), lastSentTo: w.email, lastSendStatus: "queued" })
        await ctx.scheduler.runAfter(0, ref("_sendWorkerLink"), { linkId: l.id } as never)
        await recordAudit(sys, actor, { action: "staffing-timesheets.workerLink.send", targetType: "staffing_workers", targetId: w._id })
        return { status: "queued" as const, operationId: op }
      },
    }),

    /** Worker / ours / client per worker per day of a week, disagreements first. */
    threeWayWeek: queryGeneric({
      args: { ...actorArgs, projectId: v.id("staffing_projects"), weekStart: v.string() },
      handler: async (ctx, a): Promise<ThreeWayView | null> => {
        const { sys } = await system.requirePermission(ctx, P.read, opts(a))
        return threeWayFor(ctx, a.projectId, weekStartOf(cleanDate(a.weekStart, "weekStart", sys.operationId)!))
      },
    }),

    _workerLinkPayload: internalQueryGeneric({
      args: { linkId: v.id("staffing_timesheets_workerLinks") },
      handler: async (ctx, a) => {
        const db = tsReader(ctx)
        const l = await db.get("staffing_timesheets_workerLinks", a.linkId)
        if (!l || l.revokedAt) return null
        const w = await db.get("staffing_workers", l.workerId)
        if (!w?.email) return null
        const cur = currentAssignment(await recordableAssignmentsOf(ctx, w._id), todayIso())
        const p = cur ? await db.get("staffing_projects", cur.projectId) : null
        return { to: w.email, token: l.token, firstName: w.firstName, lt: w.nationality === "LT" || w.languages.includes("lt"), project: p ? `${p.name} (${p.code})` : null }
      },
    }),

    _sendWorkerLink: internalActionGeneric({
      args: { linkId: v.id("staffing_timesheets_workerLinks") },
      handler: async (ctx, a): Promise<void> => {
        const p = (await ctx.runQuery(ref("_workerLinkPayload"), { linkId: a.linkId } as never)) as { to: string; token: string; firstName: string; lt: boolean; project: string | null } | null
        if (!p) return
        const url = process.env.N8N_URL
        const secret = process.env.N8N_WEBHOOK_SECRET
        const site = (process.env.SITE_URL ?? "").replace(/\/+$/, "")
        const link = `${site}/h/${p.token}`
        let status: ReminderStatus = "sent"
        if (!url || !secret) status = "not_configured"
        else {
          const redirectTo = process.env.APP_ENV !== "production" ? process.env.SUPER_USER_EMAILS?.split(",")[0]?.trim() : undefined
          const body = p.lt
            ? { title: "Jūsų darbo valandų nuoroda", text: `Sveiki, ${p.firstName}! Šia nuoroda kasdien pasižymėkite dirbtas valandas${p.project ? ` (${p.project})` : ""}. Matysite, ką parašė klientas, ir galėsite pažymėti „Nesutinku“.`, lines: [link, "Nuoroda asmeninė, neperduokite jos kitiems."] }
            : { title: "Your working hours link", text: `Hello ${p.firstName}! Use this link to note your working hours every day${p.project ? ` (${p.project})` : ""}. You will see what the client wrote and can mark "I disagree".`, lines: [link, "The link is personal, do not share it."] }
          try {
            const res = await fetch(`${url.replace(/\/+$/, "")}/webhook/dr-nuoma-pranesimas`, {
              method: "POST",
              headers: { "content-type": "application/json", "x-webhook-secret": secret },
              body: JSON.stringify({ to: p.to, language: p.lt ? "lt" : "en", appUrl: link, ...body, ...(redirectTo ? { redirectTo } : {}) }),
            })
            if (!res.ok) status = "failed"
          } catch {
            status = "failed"
          }
        }
        await ctx.runMutation(ref("_workerLinkSent"), { linkId: a.linkId, status } as never)
      },
    }),

    _workerLinkSent: internalMutationGeneric({
      args: { linkId: v.id("staffing_timesheets_workerLinks"), status: v.union(v.literal("sent"), v.literal("not_configured"), v.literal("failed")) },
      handler: async (ctx, a): Promise<void> => {
        await tsWriter(ctx).patch("staffing_timesheets_workerLinks", a.linkId, { lastSendStatus: a.status })
      },
    }),
  }
}

export type ThreeWayFor = (ctx: DbCtxLike, projectId: ProjectId, monday: string) => Promise<ThreeWayView | null>
