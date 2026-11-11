// The timesheets area's guarded Convex functions (module `staffing-timesheets`).
// Each one: guard (permission + module enabled) → checks → write → audit, and
// returns `operationId`. Re-export them from the app's `convex/timesheets.ts`.
import { internalActionGeneric, internalMutationGeneric, internalQueryGeneric, makeFunctionReference, mutationGeneric, queryGeneric, type GenericDatabaseWriter } from "convex/server"
import { v } from "convex/values"
import { isModuleEnabled, recordAudit, type ConvexSystem } from "@digimuza/system-core/convex"
import { addDays, fullName, isBlockingAssignment, rangeCovers, todayIso } from "../pure"
import { actorArgs, actorId, checkRange, cleanDate, cleanText, EMAIL, fail, opts, type DbCtxLike, type ProjectDoc, type WorkerDoc } from "../shared"
import { readTimesheetWithAi } from "./ai"
import { STAFFING_TIMESHEETS_MODULE_ID, StaffingTimesheetsPermissions as P } from "./manifest"
import { approvedHours, approvedWeeks, tsReader, type ApprovedHoursRow, type TimesheetsDataModel } from "./operations"
import {
  hoursProblem,
  isWeekend,
  reconcile,
  roundHours,
  rowsRange,
  type RawClientRow,
  splitHours,
  timesheetDue,
  weekDays,
  weekStartOf,
  type ClientSheetSource,
  type ClientSheetStatus,
  type DueState,
  type Reconciliation,
  type ReminderStatus,
  type ResolutionAction,
  type TimesheetCadence,
} from "./pure"
import { defineTimesheetsSeed } from "./seed"
import { defineTimesheetsSources } from "./sources"
import { clientRowValidator, clientSheetSourceValidator, rawClientRowValidator, resolutionActionValidator, timesheetCadenceValidator } from "./tables"

/** Raw client lines kept per sheet (13-minute scan rows add up fast; a document stays well under 1 MB). */
const MAX_RAW_ROWS = 6000

export interface TimesheetsOptions {
  /** The app's Convex file that re-exports these functions (for scheduled calls). Default `timesheets`. */
  functionsModule?: string
}

const tsWriter = (ctx: DbCtxLike) => ctx.db as GenericDatabaseWriter<TimesheetsDataModel>

/** Assignments whose hours are recorded (not proposed / cancelled). */
const RECORDABLE = new Set(["confirmed", "active", "ended"])

const DEFAULT_SETTINGS = { cadence: "weekly" as TimesheetCadence, graceDays: 2 }

export interface ProjectTimesheetState {
  id: ProjectDoc["_id"]
  code: string
  name: string
  clientName: string
  status: ProjectDoc["status"]
  startDate: string
  endDate: string | null
  cadence: TimesheetCadence
  graceDays: number
  contactEmail: string | null
  contactName: string | null
  due: DueState
  lastSheet: { id: string; periodFrom: string; periodTo: string; receivedAt: number } | null
  lastReminder: { createdAt: number; status: ReminderStatus; period: string } | null
  /** Hours entered this week so far (not yet approved). */
  weekHours: number
  /** Last week approved? */
  lastWeekApproved: boolean
}

export interface GridRow {
  assignmentId: string
  workerId: string
  workerName: string
  subcontractor: string | null
  tradeId: string
  tradeLt: string
  tradeEn: string
  startDate: string
  endDate: string | null
  entries: Record<string, { regular: number; overtime: number; night: boolean; weekend: boolean; note: string | null }>
}

export interface WeekGrid {
  project: { id: string; code: string; name: string; clientName: string }
  weekStart: string
  days: string[]
  today: string
  approved: { approvedAt: number; approvedBy: string } | null
  rows: GridRow[]
}

export interface ClientSheetView {
  id: string
  projectId: string
  periodFrom: string
  periodTo: string
  source: ClientSheetSource
  status: ClientSheetStatus
  fileName: string | null
  hasFile: boolean
  rowCount: number
  totalHours: number
  error: string | null
  receivedAt: number
  mismatches: number
  resolved: number
  /** Lines as the client wrote them (more than `rowCount` for scan-per-part exports). */
  rawRowCount: number
  /** `pending`: came in by email, nobody checked it yet. */
  review: "pending" | "confirmed" | null
  email: { from: string; subject: string; receivedAt: number } | null
}

export interface ReconciliationView {
  sheet: ClientSheetView & { rows: { name: string; date: string; hours: number }[]; rawRows: RawClientRow[] }
  project: { id: string; code: string; name: string; clientName: string }
  workers: { id: string; name: string }[]
  reconciliation: Reconciliation
  resolutions: Record<string, { action: ResolutionAction; note: string | null; resolvedAt: number }>
  lockedWeeks: string[]
}

export interface SubcontractorTimesheet {
  subcontractor: { id: string; name: string; code: string }
  from: string
  to: string
  rows: { workerId: string; workerName: string; projectCode: string; projectName: string; trade: string; date: string; regular: number; overtime: number; weekend: boolean; night: boolean }[]
  workers: { workerId: string; workerName: string; regular: number; overtime: number; days: number }[]
  total: { regular: number; overtime: number }
}

export function defineTimesheets(system: ConvexSystem, options: TimesheetsOptions = {}) {
  const mod = options.functionsModule ?? "timesheets"
  const ref = (name: string) => makeFunctionReference<"action" | "mutation" | "query">(`${mod}:${name}`) as never

  // ---------------------------------------------------------------- helpers

  async function settingsOf(ctx: DbCtxLike, projectId: ProjectDoc["_id"]) {
    const s = await tsReader(ctx)
      .query("staffing_timesheets_settings")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .first()
    return s ?? null
  }

  async function projectHead(ctx: DbCtxLike, p: ProjectDoc) {
    const client = await tsReader(ctx).get("staffing_clients", p.clientId)
    return { id: p._id, code: p.code, name: p.name, clientName: client?.name ?? "?" }
  }

  async function isWeekApproved(ctx: DbCtxLike, projectId: ProjectDoc["_id"], date: string) {
    return Boolean(
      await tsReader(ctx)
        .query("staffing_timesheets_weeks")
        .withIndex("by_project_week", (q) => q.eq("projectId", projectId).eq("weekStart", weekStartOf(date)))
        .first(),
    )
  }

  async function projectState(ctx: DbCtxLike, p: ProjectDoc, today: string): Promise<ProjectTimesheetState> {
    const db = tsReader(ctx)
    const client = await db.get("staffing_clients", p.clientId)
    const s = await settingsOf(ctx, p._id)
    const cadence = s?.cadence ?? DEFAULT_SETTINGS.cadence
    const graceDays = s?.graceDays ?? DEFAULT_SETTINGS.graceDays
    const last = await db
      .query("staffing_timesheets_clientSheets")
      .withIndex("by_project", (q) => q.eq("projectId", p._id))
      .order("desc")
      .first()
    const reminder = await db
      .query("staffing_timesheets_reminders")
      .withIndex("by_project", (q) => q.eq("projectId", p._id))
      .order("desc")
      .first()
    const monday = weekStartOf(today)
    const weekEntries = await db
      .query("staffing_timesheets_entries")
      .withIndex("by_project_date", (q) => q.eq("projectId", p._id).gte("date", monday).lte("date", addDays(monday, 6)))
      .collect()
    const lastWeek = await db
      .query("staffing_timesheets_weeks")
      .withIndex("by_project_week", (q) => q.eq("projectId", p._id).eq("weekStart", addDays(monday, -7)))
      .first()
    const contact = client?.contacts.find((c) => c.email)
    return {
      id: p._id,
      code: p.code,
      name: p.name,
      clientName: client?.name ?? "?",
      status: p.status,
      startDate: p.startDate,
      endDate: p.endDate ?? null,
      cadence,
      graceDays,
      contactEmail: s?.contactEmail ?? contact?.email ?? null,
      contactName: s?.contactName ?? contact?.name ?? null,
      due: timesheetDue({ cadence, graceDays, projectStart: p.startDate, lastReceivedTo: last?.periodTo ?? null, today: p.endDate && p.endDate < today ? addDays(p.endDate, 1) : today }),
      lastSheet: last ? { id: last._id, periodFrom: last.periodFrom, periodTo: last.periodTo, receivedAt: last.receivedAt } : null,
      lastReminder: reminder ? { createdAt: reminder.createdAt, status: reminder.status, period: reminder.period } : null,
      weekHours: roundHours(weekEntries.reduce((s2, e) => s2 + e.regularHours + e.overtimeHours, 0)),
      lastWeekApproved: Boolean(lastWeek),
    }
  }

  async function activeProjects(ctx: DbCtxLike) {
    return tsReader(ctx)
      .query("staffing_projects")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .collect()
  }

  async function sheetView(ctx: DbCtxLike, s: { _id: string } & Record<string, unknown>): Promise<ClientSheetView> {
    const sheet = s as unknown as TimesheetsDataModel["staffing_timesheets_clientSheets"]["document"]
    const rec = await reconcileSheet(ctx, sheet)
    const resolutions = await tsReader(ctx)
      .query("staffing_timesheets_resolutions")
      .withIndex("by_sheet", (q) => q.eq("sheetId", sheet._id))
      .collect()
    const open = new Set(rec.reconciliation.lines.filter((l) => l.kind !== "ok").map((l) => l.key))
    return {
      id: sheet._id,
      projectId: sheet.projectId,
      periodFrom: sheet.periodFrom,
      periodTo: sheet.periodTo,
      source: sheet.source,
      status: sheet.status,
      fileName: sheet.fileName ?? null,
      hasFile: Boolean(sheet.fileStorageId),
      rowCount: sheet.rows.length,
      totalHours: roundHours(sheet.rows.reduce((t, r) => t + r.hours, 0)),
      error: sheet.error ?? null,
      receivedAt: sheet.receivedAt,
      mismatches: open.size,
      resolved: resolutions.filter((r) => open.has(r.key)).length,
      rawRowCount: sheet.rawRows?.length ?? 0,
      review: sheet.review ?? null,
      email: sheet.email ?? null,
    }
  }

  /** Project workers (all recordable assignments) and the reconciliation of a sheet. */
  async function reconcileSheet(ctx: DbCtxLike, sheet: TimesheetsDataModel["staffing_timesheets_clientSheets"]["document"]) {
    const db = tsReader(ctx)
    const assignments = (
      await db
        .query("staffing_assignments")
        .withIndex("by_project", (q) => q.eq("projectId", sheet.projectId))
        .collect()
    ).filter((a) => a.status !== "cancelled")
    const workers: WorkerDoc[] = []
    for (const id of new Set(assignments.map((a) => a.workerId))) {
      const w = await db.get("staffing_workers", id)
      if (w) workers.push(w)
    }
    const entries = await db
      .query("staffing_timesheets_entries")
      .withIndex("by_project_date", (q) => q.eq("projectId", sheet.projectId).gte("date", sheet.periodFrom).lte("date", sheet.periodTo))
      .collect()
    const reconciliation = reconcile({
      from: sheet.periodFrom,
      to: sheet.periodTo,
      workers: workers.map((w) => ({ id: w._id, firstName: w.firstName, lastName: w.lastName })),
      ours: entries.map((e) => ({ workerId: e.workerId, date: e.date, hours: e.regularHours + e.overtimeHours })),
      theirs: sheet.rows,
      nameMap: Object.fromEntries(sheet.nameMap.map((m) => [m.name, m.workerId])),
    })
    return { reconciliation, workers }
  }

  /** Writes our hours for a worker's day on a project (0 deletes). Refuses locked weeks. */
  async function setOwnHours(ctx: DbCtxLike, a: { projectId: ProjectDoc["_id"]; workerId: string; date: string; regular: number; overtime: number; night?: boolean; note?: string | undefined; by: string }, op: string) {
    const db = tsWriter(ctx)
    if (await isWeekApproved(ctx, a.projectId, a.date)) fail("CONFLICT", "week_locked", op, ["date"])
    const assignment = (
      await db
        .query("staffing_assignments")
        .withIndex("by_worker", (q) => q.eq("workerId", a.workerId as never))
        .collect()
    ).find((x) => x.projectId === a.projectId && RECORDABLE.has(x.status) && rangeCovers(x, a.date))
    if (!assignment) fail("CONFLICT", "no_assignment", op, ["date"])
    const existing = await db
      .query("staffing_timesheets_entries")
      .withIndex("by_assignment_date", (q) => q.eq("assignmentId", assignment._id).eq("date", a.date))
      .first()
    if (a.regular + a.overtime === 0 && !a.note) {
      if (existing) await db.delete("staffing_timesheets_entries", existing._id)
      return existing?._id ?? null
    }
    const fields = {
      regularHours: a.regular,
      overtimeHours: a.overtime,
      weekend: isWeekend(a.date),
      night: a.night ?? existing?.night ?? false,
      ...(a.note !== undefined ? (a.note ? { note: a.note } : {}) : existing?.note ? { note: existing.note } : {}),
      updatedBy: a.by,
      updatedAt: Date.now(),
    }
    if (existing) {
      await db.replace("staffing_timesheets_entries", existing._id, { assignmentId: existing.assignmentId, projectId: existing.projectId, workerId: existing.workerId, tradeId: existing.tradeId, date: existing.date, ...fields })
      return existing._id
    }
    return db.insert("staffing_timesheets_entries", { assignmentId: assignment._id, projectId: a.projectId, workerId: assignment.workerId, tradeId: assignment.tradeId, date: a.date, ...fields })
  }

  async function queueReminder(ctx: DbCtxLike & { scheduler: { runAfter: (ms: number, fn: never, args: never) => Promise<unknown> } }, p: ProjectDoc, trigger: "manual" | "cron", today: string) {
    const state = await projectState(ctx, p, today)
    const period = state.due.missingFrom && state.due.expectedTo ? `${state.due.missingFrom} – ${state.due.expectedTo}` : `${weekStartOf(addDays(today, -7))} – ${addDays(weekStartOf(today), -1)}`
    const id = await tsWriter(ctx).insert("staffing_timesheets_reminders", {
      projectId: p._id,
      period,
      ...(state.contactEmail ? { to: state.contactEmail } : {}),
      trigger,
      status: state.contactEmail ? "queued" : "no_contact",
      createdAt: Date.now(),
    })
    if (state.contactEmail) await ctx.scheduler.runAfter(0, ref("_sendReminder"), { reminderId: id } as never)
    return { id, status: state.contactEmail ? ("queued" as const) : ("no_contact" as const) }
  }

  const MAX_ROWS = 3000

  function cleanRows(rows: { name: string; date: string; hours: number }[], op: string) {
    if (rows.length > MAX_ROWS) fail("VALIDATION", "too_many_rows", op, ["rows"])
    return rows.map((r) => {
      const name = cleanText(r.name, 120, "rows", op)!
      if (!cleanDate(r.date, "rows", op)) fail("VALIDATION", "invalid_rows", op, ["rows"])
      if (!(r.hours > 0 && r.hours <= 24)) fail("VALIDATION", "invalid_hours", op, ["rows"])
      return { name, date: r.date, hours: roundHours(r.hours) }
    })
  }

  return {
    ...defineTimesheetsSeed(),
    ...defineTimesheetsSources(system, { ref }),

    // ---------------------------------------------------------------- reads

    /** Active projects with this week's hours, the client timesheet state (late?) and the last reminder. */
    overview: queryGeneric({
      args: { ...actorArgs },
      handler: async (ctx, a): Promise<ProjectTimesheetState[]> => {
        await system.requirePermission(ctx, P.read, opts(a))
        const today = todayIso()
        const projects = await activeProjects(ctx)
        const out = await Promise.all(projects.map((p) => projectState(ctx, p, today)))
        return out.sort((x, y) => Number(y.due.late) - Number(x.due.late) || x.code.localeCompare(y.code))
      },
    }),

    /** The coordinator's grid: workers (recordable assignments overlapping the week) × days. */
    weekGrid: queryGeneric({
      args: { ...actorArgs, projectId: v.id("staffing_projects"), weekStart: v.string() },
      handler: async (ctx, a): Promise<WeekGrid | null> => {
        const { sys } = await system.requirePermission(ctx, P.read, opts(a))
        const monday = weekStartOf(cleanDate(a.weekStart, "weekStart", sys.operationId)!)
        const sunday = addDays(monday, 6)
        const db = tsReader(ctx)
        const p = await db.get("staffing_projects", a.projectId)
        if (!p) return null
        const assignments = (
          await db
            .query("staffing_assignments")
            .withIndex("by_project", (q) => q.eq("projectId", p._id).lte("startDate", sunday))
            .collect()
        ).filter((x) => RECORDABLE.has(x.status) && (!x.endDate || x.endDate >= monday))
        const entries = await db
          .query("staffing_timesheets_entries")
          .withIndex("by_project_date", (q) => q.eq("projectId", p._id).gte("date", monday).lte("date", sunday))
          .collect()
        const week = await db
          .query("staffing_timesheets_weeks")
          .withIndex("by_project_week", (q) => q.eq("projectId", p._id).eq("weekStart", monday))
          .first()
        const subName = new Map<string, string>()
        const rows: GridRow[] = []
        for (const x of assignments) {
          const w = await db.get("staffing_workers", x.workerId)
          const t = await db.get("staffing_trades", x.tradeId)
          if (!w) continue
          let subcontractor: string | null = null
          if (w.subcontractorClientId) {
            if (!subName.has(w.subcontractorClientId)) subName.set(w.subcontractorClientId, (await db.get("staffing_clients", w.subcontractorClientId))?.name ?? "?")
            subcontractor = subName.get(w.subcontractorClientId)!
          }
          const mine = entries.filter((e) => e.assignmentId === x._id)
          rows.push({
            assignmentId: x._id,
            workerId: w._id,
            workerName: `${w.lastName} ${w.firstName}`,
            subcontractor,
            tradeId: x.tradeId,
            tradeLt: t?.nameLt ?? "?",
            tradeEn: t?.nameEn ?? "?",
            startDate: x.startDate,
            endDate: x.endDate ?? null,
            entries: Object.fromEntries(mine.map((e) => [e.date, { regular: e.regularHours, overtime: e.overtimeHours, night: e.night, weekend: e.weekend, note: e.note ?? null }])),
          })
        }
        rows.sort((x, y) => x.workerName.localeCompare(y.workerName))
        return { project: await projectHead(ctx, p), weekStart: monday, days: weekDays(monday), today: todayIso(), approved: week ? { approvedAt: week.approvedAt, approvedBy: week.approvedBy } : null, rows }
      },
    }),

    /** Approved hours of a project in `[from, to]` (see `approvedHours`). */
    listApprovedHours: queryGeneric({
      args: { ...actorArgs, projectId: v.id("staffing_projects"), from: v.string(), to: v.string() },
      handler: async (ctx, a): Promise<ApprovedHoursRow[]> => {
        const { sys } = await system.requirePermission(ctx, P.read, opts(a))
        const from = cleanDate(a.from, "from", sys.operationId)!
        const to = cleanDate(a.to, "to", sys.operationId)!
        checkRange(from, to, sys.operationId, "to")
        return approvedHours(ctx, { projectId: a.projectId, from, to })
      },
    }),

    listClientSheets: queryGeneric({
      args: { ...actorArgs, projectId: v.id("staffing_projects") },
      handler: async (ctx, a): Promise<ClientSheetView[]> => {
        await system.requirePermission(ctx, P.read, opts(a))
        const rows = await tsReader(ctx)
          .query("staffing_timesheets_clientSheets")
          .withIndex("by_project", (q) => q.eq("projectId", a.projectId))
          .order("desc")
          .take(50)
        return Promise.all(rows.map((s) => sheetView(ctx, s)))
      },
    }),

    getReconciliation: queryGeneric({
      args: { ...actorArgs, sheetId: v.id("staffing_timesheets_clientSheets") },
      handler: async (ctx, a): Promise<ReconciliationView | null> => {
        await system.requirePermission(ctx, P.read, opts(a))
        const db = tsReader(ctx)
        const sheet = await db.get("staffing_timesheets_clientSheets", a.sheetId)
        if (!sheet) return null
        const p = await db.get("staffing_projects", sheet.projectId)
        if (!p) return null
        const { reconciliation, workers } = await reconcileSheet(ctx, sheet)
        const resolutions = await db
          .query("staffing_timesheets_resolutions")
          .withIndex("by_sheet", (q) => q.eq("sheetId", sheet._id))
          .collect()
        const locked = await approvedWeeks(ctx, sheet.projectId, sheet.periodFrom, sheet.periodTo)
        return {
          sheet: { ...(await sheetView(ctx, sheet)), rows: sheet.rows, rawRows: sheet.rawRows ?? [] },
          project: await projectHead(ctx, p),
          workers: workers.map((w) => ({ id: w._id, name: `${w.lastName} ${w.firstName}` })).sort((x, y) => x.name.localeCompare(y.name)),
          reconciliation,
          resolutions: Object.fromEntries(resolutions.map((r) => [r.key, { action: r.action, note: r.note ?? null, resolvedAt: r.resolvedAt }])),
          lockedWeeks: [...locked],
        }
      },
    }),

    getClientSheetFileUrl: queryGeneric({
      args: { ...actorArgs, sheetId: v.id("staffing_timesheets_clientSheets") },
      handler: async (ctx, a): Promise<string | null> => {
        await system.requirePermission(ctx, P.read, opts(a))
        const s = await tsReader(ctx).get("staffing_timesheets_clientSheets", a.sheetId)
        return s?.fileStorageId ? ctx.storage.getUrl(s.fileStorageId) : null
      },
    }),

    listSubcontractors: queryGeneric({
      args: { ...actorArgs },
      handler: async (ctx, a): Promise<{ id: string; name: string; code: string }[]> => {
        await system.requirePermission(ctx, P.export, opts(a))
        const all = await tsReader(ctx).query("staffing_clients").withIndex("by_name").collect()
        return all.filter((c) => c.kind !== "client").map((c) => ({ id: c._id, name: c.name, code: c.code }))
      },
    }),

    /** Approved hours of a subcontractor's workers on every project in `[from, to]`. */
    subcontractorTimesheet: queryGeneric({
      args: { ...actorArgs, subcontractorId: v.id("staffing_clients"), from: v.string(), to: v.string() },
      handler: async (ctx, a): Promise<SubcontractorTimesheet | null> => {
        const { sys } = await system.requirePermission(ctx, P.export, opts(a))
        const op = sys.operationId
        const from = cleanDate(a.from, "from", op)!
        const to = cleanDate(a.to, "to", op)!
        checkRange(from, to, op, "to")
        const db = tsReader(ctx)
        const sub = await db.get("staffing_clients", a.subcontractorId)
        if (!sub) return null
        const workers = await db
          .query("staffing_workers")
          .withIndex("by_subcontractor", (q) => q.eq("subcontractorClientId", sub._id))
          .collect()
        const rows: SubcontractorTimesheet["rows"] = []
        const projects = new Map<string, ProjectDoc | null>()
        const trades = new Map<string, string>()
        const approved = new Map<string, Set<string>>()
        for (const w of workers) {
          const entries = await db
            .query("staffing_timesheets_entries")
            .withIndex("by_worker_date", (q) => q.eq("workerId", w._id).gte("date", from).lte("date", to))
            .collect()
          for (const e of entries) {
            if (!approved.has(e.projectId)) approved.set(e.projectId, await approvedWeeks(ctx, e.projectId, from, to))
            if (!approved.get(e.projectId)!.has(weekStartOf(e.date))) continue
            if (!projects.has(e.projectId)) projects.set(e.projectId, await db.get("staffing_projects", e.projectId))
            if (!trades.has(e.tradeId)) trades.set(e.tradeId, (await db.get("staffing_trades", e.tradeId))?.nameLt ?? "?")
            const p = projects.get(e.projectId)
            rows.push({ workerId: w._id, workerName: `${w.lastName} ${w.firstName}`, projectCode: p?.code ?? "?", projectName: p?.name ?? "?", trade: trades.get(e.tradeId)!, date: e.date, regular: e.regularHours, overtime: e.overtimeHours, weekend: e.weekend, night: e.night })
          }
        }
        rows.sort((x, y) => x.workerName.localeCompare(y.workerName) || x.date.localeCompare(y.date))
        const per = new Map<string, SubcontractorTimesheet["workers"][number]>()
        for (const r of rows) {
          const s = per.get(r.workerId) ?? { workerId: r.workerId, workerName: r.workerName, regular: 0, overtime: 0, days: 0 }
          s.regular = roundHours(s.regular + r.regular)
          s.overtime = roundHours(s.overtime + r.overtime)
          s.days++
          per.set(r.workerId, s)
        }
        const list = [...per.values()]
        return {
          subcontractor: { id: sub._id, name: sub.name, code: sub.code },
          from,
          to,
          rows,
          workers: list,
          total: { regular: roundHours(list.reduce((t, w) => t + w.regular, 0)), overtime: roundHours(list.reduce((t, w) => t + w.overtime, 0)) },
        }
      },
    }),

    // ---------------------------------------------------------------- own hours

    /** Saves one cell of the grid. 0 + 0 hours and no note deletes the entry. */
    saveEntry: mutationGeneric({
      args: { ...actorArgs, assignmentId: v.id("staffing_assignments"), date: v.string(), regularHours: v.number(), overtimeHours: v.number(), night: v.optional(v.boolean()), note: v.optional(v.string()) },
      handler: async (ctx, a) => {
        const { sys, actor } = await system.requirePermission(ctx, P.write, opts(a))
        const op = sys.operationId
        const date = cleanDate(a.date, "date", op)!
        if (date > todayIso()) fail("VALIDATION", "future_date", op, ["date"])
        const problem = hoursProblem(a.regularHours, a.overtimeHours)
        if (problem) fail("VALIDATION", problem, op, ["regularHours", "overtimeHours"])
        const assignment = await tsReader(ctx).get("staffing_assignments", a.assignmentId)
        if (!assignment) fail("NOT_FOUND", "assignment_not_found", op)
        if (!RECORDABLE.has(assignment.status) || !rangeCovers(assignment, date)) fail("CONFLICT", "no_assignment", op, ["date"])
        const note = a.note === undefined ? undefined : (cleanText(a.note, 500, "note", op, false) ?? "")
        const id = await setOwnHours(ctx, { projectId: assignment.projectId, workerId: assignment.workerId, date, regular: a.regularHours, overtime: a.overtimeHours, ...(a.night !== undefined ? { night: a.night } : {}), note, by: actorId(actor) }, op)
        await recordAudit(sys, actor, { action: "staffing-timesheets.entry.save", targetType: "staffing_assignments", targetId: assignment._id, changes: { date, regular: a.regularHours, overtime: a.overtimeHours } })
        return { id, operationId: op }
      },
    }),

    /** Fills empty weekday cells (Mon–Fri, up to today) of the week with `hours` regular hours. */
    fillWeek: mutationGeneric({
      args: { ...actorArgs, projectId: v.id("staffing_projects"), weekStart: v.string(), hours: v.optional(v.number()) },
      handler: async (ctx, a) => {
        const { sys, actor } = await system.requirePermission(ctx, P.write, opts(a))
        const op = sys.operationId
        const monday = weekStartOf(cleanDate(a.weekStart, "weekStart", op)!)
        const hours = a.hours ?? 8
        const problem = hoursProblem(hours, 0)
        if (problem) fail("VALIDATION", problem, op, ["hours"])
        if (await isWeekApproved(ctx, a.projectId, monday)) fail("CONFLICT", "week_locked", op)
        const db = tsWriter(ctx)
        const today = todayIso()
        const assignments = (
          await db
            .query("staffing_assignments")
            .withIndex("by_project", (q) => q.eq("projectId", a.projectId).lte("startDate", addDays(monday, 4)))
            .collect()
        ).filter((x) => RECORDABLE.has(x.status))
        let filled = 0
        for (const x of assignments)
          for (const day of weekDays(monday).slice(0, 5)) {
            if (day > today || !rangeCovers(x, day)) continue
            const has = await db
              .query("staffing_timesheets_entries")
              .withIndex("by_assignment_date", (q) => q.eq("assignmentId", x._id).eq("date", day))
              .first()
            if (has) continue
            await db.insert("staffing_timesheets_entries", { assignmentId: x._id, projectId: x.projectId, workerId: x.workerId, tradeId: x.tradeId, date: day, regularHours: hours, overtimeHours: 0, weekend: false, night: false, updatedBy: actorId(actor), updatedAt: Date.now() })
            filled++
          }
        await recordAudit(sys, actor, { action: "staffing-timesheets.week.fill", targetType: "staffing_projects", targetId: a.projectId, changes: { weekStart: monday, filled } })
        return { filled, operationId: op }
      },
    }),

    /** "Patvirtinti savaitę": locks the week's entries for invoicing. Only finished days can be approved: the week must have started. */
    approveWeek: mutationGeneric({
      args: { ...actorArgs, projectId: v.id("staffing_projects"), weekStart: v.string() },
      handler: async (ctx, a) => {
        const { sys, actor } = await system.requirePermission(ctx, P.approve, opts(a))
        const op = sys.operationId
        const monday = weekStartOf(cleanDate(a.weekStart, "weekStart", op)!)
        if (monday > todayIso()) fail("VALIDATION", "future_week", op, ["weekStart"])
        const db = tsWriter(ctx)
        if (!(await db.get("staffing_projects", a.projectId))) fail("NOT_FOUND", "project_not_found", op)
        if (await isWeekApproved(ctx, a.projectId, monday)) fail("CONFLICT", "already_approved", op)
        const id = await db.insert("staffing_timesheets_weeks", { projectId: a.projectId, weekStart: monday, approvedBy: actorId(actor), approvedAt: Date.now() })
        await recordAudit(sys, actor, { action: "staffing-timesheets.week.approve", targetType: "staffing_projects", targetId: a.projectId, changes: { weekStart: monday } })
        return { id, operationId: op }
      },
    }),

    reopenWeek: mutationGeneric({
      args: { ...actorArgs, projectId: v.id("staffing_projects"), weekStart: v.string() },
      handler: async (ctx, a) => {
        const { sys, actor } = await system.requirePermission(ctx, P.approve, opts(a))
        const op = sys.operationId
        const monday = weekStartOf(cleanDate(a.weekStart, "weekStart", op)!)
        const db = tsWriter(ctx)
        const w = await db
          .query("staffing_timesheets_weeks")
          .withIndex("by_project_week", (q) => q.eq("projectId", a.projectId).eq("weekStart", monday))
          .first()
        if (!w) fail("NOT_FOUND", "week_not_approved", op)
        await db.delete("staffing_timesheets_weeks", w._id)
        await recordAudit(sys, actor, { action: "staffing-timesheets.week.reopen", targetType: "staffing_projects", targetId: a.projectId, changes: { weekStart: monday } })
        return { operationId: op }
      },
    }),

    // ---------------------------------------------------------------- client timesheets

    generateClientSheetUploadUrl: mutationGeneric({
      args: { ...actorArgs },
      handler: async (ctx, a): Promise<string> => {
        await system.requirePermission(ctx, P.clientManage, opts(a))
        return ctx.storage.generateUploadUrl()
      },
    }),

    /**
     * Files a client timesheet. CSV / XLSX arrive already parsed (`rows`, read in
     * the browser); PDF and photos go to the AI reader (`pageImageIds` for
     * scanned PDF pages, `text` for a PDF text layer); `manual` starts empty.
     */
    importClientSheet: mutationGeneric({
      args: {
        ...actorArgs,
        projectId: v.id("staffing_projects"),
        periodFrom: v.string(),
        periodTo: v.string(),
        source: clientSheetSourceValidator,
        fileStorageId: v.optional(v.id("_storage")),
        fileName: v.optional(v.string()),
        rows: v.optional(v.array(clientRowValidator)),
        pageImageIds: v.optional(v.array(v.id("_storage"))),
        text: v.optional(v.string()),
      },
      handler: async (ctx, a) => {
        const { sys, actor } = await system.requirePermission(ctx, P.clientManage, opts(a))
        const op = sys.operationId
        const periodFrom = cleanDate(a.periodFrom, "periodFrom", op)!
        const periodTo = cleanDate(a.periodTo, "periodTo", op)!
        checkRange(periodFrom, periodTo, op, "periodTo")
        const db = tsWriter(ctx)
        if (!(await db.get("staffing_projects", a.projectId))) fail("NOT_FOUND", "project_not_found", op)
        const viaAi = a.source === "pdf" || a.source === "image"
        if (viaAi && !a.fileStorageId) fail("VALIDATION", "missing_file", op, ["fileStorageId"])
        const rows = viaAi ? [] : cleanRows(a.rows ?? [], op)
        const fileName = cleanText(a.fileName, 200, "fileName", op, false)
        const id = await db.insert("staffing_timesheets_clientSheets", {
          projectId: a.projectId,
          periodFrom,
          periodTo,
          source: a.source,
          status: viaAi ? "parsing" : "ready",
          ...(a.fileStorageId ? { fileStorageId: a.fileStorageId } : {}),
          ...(fileName ? { fileName } : {}),
          ...(a.pageImageIds?.length ? { pageImageIds: a.pageImageIds.slice(0, 5) } : {}),
          ...(a.text?.trim() ? { text: a.text.slice(0, 50_000) } : {}),
          rows,
          nameMap: [],
          receivedAt: Date.now(),
          createdBy: actorId(actor),
        })
        if (viaAi) await ctx.scheduler.runAfter(0, ref("_parseWithAi"), { sheetId: id } as never)
        await recordAudit(sys, actor, { action: "staffing-timesheets.clientSheet.import", targetType: "staffing_timesheets_clientSheets", targetId: id, changes: { source: a.source, rows: rows.length, periodFrom, periodTo } })
        return { id, operationId: op }
      },
    }),

    retryAiParse: mutationGeneric({
      args: { ...actorArgs, sheetId: v.id("staffing_timesheets_clientSheets") },
      handler: async (ctx, a) => {
        const { sys } = await system.requirePermission(ctx, P.clientManage, opts(a))
        const db = tsWriter(ctx)
        const s = await db.get("staffing_timesheets_clientSheets", a.sheetId)
        if (!s) fail("NOT_FOUND", "sheet_not_found", sys.operationId)
        if (!s.fileStorageId) fail("VALIDATION", "missing_file", sys.operationId)
        await db.patch("staffing_timesheets_clientSheets", s._id, { status: "parsing", error: undefined })
        await ctx.scheduler.runAfter(0, ref("_parseWithAi"), { sheetId: s._id } as never)
        return { operationId: sys.operationId }
      },
    }),

    /** Manual entry of client rows (when AI is not configured or missed some). */
    addClientRows: mutationGeneric({
      args: { ...actorArgs, sheetId: v.id("staffing_timesheets_clientSheets"), rows: v.array(clientRowValidator) },
      handler: async (ctx, a) => {
        const { sys, actor } = await system.requirePermission(ctx, P.clientManage, opts(a))
        const op = sys.operationId
        const db = tsWriter(ctx)
        const s = await db.get("staffing_timesheets_clientSheets", a.sheetId)
        if (!s) fail("NOT_FOUND", "sheet_not_found", op)
        const rows = cleanRows([...s.rows, ...a.rows], op)
        await db.patch("staffing_timesheets_clientSheets", s._id, { rows, ...(s.status !== "parsing" ? { status: "ready" as const } : {}) })
        await recordAudit(sys, actor, { action: "staffing-timesheets.clientSheet.rows", targetType: "staffing_timesheets_clientSheets", targetId: s._id, changes: { added: a.rows.length } })
        return { operationId: op }
      },
    }),

    removeClientRow: mutationGeneric({
      args: { ...actorArgs, sheetId: v.id("staffing_timesheets_clientSheets"), index: v.number() },
      handler: async (ctx, a) => {
        const { sys, actor } = await system.requirePermission(ctx, P.clientManage, opts(a))
        const db = tsWriter(ctx)
        const s = await db.get("staffing_timesheets_clientSheets", a.sheetId)
        if (!s) fail("NOT_FOUND", "sheet_not_found", sys.operationId)
        if (!s.rows[a.index]) fail("VALIDATION", "invalid_index", sys.operationId)
        await db.patch("staffing_timesheets_clientSheets", s._id, { rows: s.rows.filter((_, i) => i !== a.index) })
        await recordAudit(sys, actor, { action: "staffing-timesheets.clientSheet.rows", targetType: "staffing_timesheets_clientSheets", targetId: s._id, changes: { removed: 1 } })
        return { operationId: sys.operationId }
      },
    }),

    /** Links a client's spelling of a name to a worker (`workerId` omitted: back to fuzzy matching). */
    mapClientName: mutationGeneric({
      args: { ...actorArgs, sheetId: v.id("staffing_timesheets_clientSheets"), name: v.string(), workerId: v.optional(v.id("staffing_workers")) },
      handler: async (ctx, a) => {
        const { sys, actor } = await system.requirePermission(ctx, P.clientManage, opts(a))
        const db = tsWriter(ctx)
        const s = await db.get("staffing_timesheets_clientSheets", a.sheetId)
        if (!s) fail("NOT_FOUND", "sheet_not_found", sys.operationId)
        const nameMap = [...s.nameMap.filter((m) => m.name !== a.name), ...(a.workerId ? [{ name: a.name, workerId: a.workerId }] : [])]
        await db.patch("staffing_timesheets_clientSheets", s._id, { nameMap })
        await recordAudit(sys, actor, { action: "staffing-timesheets.clientSheet.mapName", targetType: "staffing_timesheets_clientSheets", targetId: s._id, changes: { name: a.name, workerId: a.workerId ?? null } })
        return { operationId: sys.operationId }
      },
    }),

    /**
     * Resolves a reconciliation line: `accept_client` sets our hours to the
     * client's (split into 8 regular + overtime; client missing → our entry
     * removed), `keep_ours` / `note` only record the decision.
     */
    resolveLine: mutationGeneric({
      args: { ...actorArgs, sheetId: v.id("staffing_timesheets_clientSheets"), key: v.string(), action: resolutionActionValidator, note: v.optional(v.string()) },
      handler: async (ctx, a) => {
        const { sys, actor } = await system.requirePermission(ctx, P.clientManage, opts(a))
        const op = sys.operationId
        const db = tsWriter(ctx)
        const s = await db.get("staffing_timesheets_clientSheets", a.sheetId)
        if (!s) fail("NOT_FOUND", "sheet_not_found", op)
        const { reconciliation } = await reconcileSheet(ctx, s)
        const line = reconciliation.lines.find((l) => l.key === a.key)
        if (!line) fail("NOT_FOUND", "line_not_found", op)
        const note = cleanText(a.note, 500, "note", op, a.action === "note")
        if (a.action === "accept_client") {
          if (!line.workerId) fail("VALIDATION", "unknown_worker", op)
          if (!(await tsWriter(ctx).get("staffing_workers", line.workerId as never))) fail("NOT_FOUND", "worker_not_found", op)
          const { regular, overtime } = splitHours(line.theirs ?? 0)
          await setOwnHours(ctx, { projectId: s.projectId, workerId: line.workerId, date: line.date, regular, overtime, by: actorId(actor) }, op)
        }
        const existing = await db
          .query("staffing_timesheets_resolutions")
          .withIndex("by_sheet", (q) => q.eq("sheetId", s._id).eq("key", a.key))
          .first()
        if (existing) await db.delete("staffing_timesheets_resolutions", existing._id)
        await db.insert("staffing_timesheets_resolutions", { sheetId: s._id, key: a.key, action: a.action, ...(note ? { note } : {}), resolvedBy: actorId(actor), resolvedAt: Date.now() })
        await recordAudit(sys, actor, { action: "staffing-timesheets.line.resolve", targetType: "staffing_timesheets_clientSheets", targetId: s._id, changes: { key: a.key, action: a.action, ours: line.ours, theirs: line.theirs } })
        return { operationId: op }
      },
    }),

    deleteClientSheet: mutationGeneric({
      args: { ...actorArgs, sheetId: v.id("staffing_timesheets_clientSheets") },
      handler: async (ctx, a) => {
        const { sys, actor } = await system.requirePermission(ctx, P.clientManage, opts(a))
        const db = tsWriter(ctx)
        const s = await db.get("staffing_timesheets_clientSheets", a.sheetId)
        if (!s) fail("NOT_FOUND", "sheet_not_found", sys.operationId)
        for (const r of await db
          .query("staffing_timesheets_resolutions")
          .withIndex("by_sheet", (q) => q.eq("sheetId", s._id))
          .collect())
          await db.delete("staffing_timesheets_resolutions", r._id)
        for (const id of [s.fileStorageId, ...(s.pageImageIds ?? [])]) if (id) await ctx.storage.delete(id)
        await db.delete("staffing_timesheets_clientSheets", s._id)
        await recordAudit(sys, actor, { action: "staffing-timesheets.clientSheet.delete", targetType: "staffing_timesheets_clientSheets", targetId: s._id })
        return { operationId: sys.operationId }
      },
    }),

    // ---------------------------------------------------------------- cadence and reminders

    saveSettings: mutationGeneric({
      args: { ...actorArgs, projectId: v.id("staffing_projects"), cadence: timesheetCadenceValidator, graceDays: v.number(), contactEmail: v.optional(v.string()), contactName: v.optional(v.string()) },
      handler: async (ctx, a) => {
        const { sys, actor } = await system.requirePermission(ctx, P.clientManage, opts(a))
        const op = sys.operationId
        if (!Number.isInteger(a.graceDays) || a.graceDays < 0 || a.graceDays > 30) fail("VALIDATION", "invalid_graceDays", op, ["graceDays"])
        const contactEmail = cleanText(a.contactEmail, 200, "contactEmail", op, false)
        if (contactEmail && !EMAIL.test(contactEmail)) fail("VALIDATION", "invalid_contactEmail", op, ["contactEmail"])
        const contactName = cleanText(a.contactName, 120, "contactName", op, false)
        const db = tsWriter(ctx)
        if (!(await db.get("staffing_projects", a.projectId))) fail("NOT_FOUND", "project_not_found", op)
        const existing = await settingsOf(ctx, a.projectId)
        const doc = { projectId: a.projectId, cadence: a.cadence, graceDays: a.graceDays, ...(contactEmail ? { contactEmail } : {}), ...(contactName ? { contactName } : {}), updatedAt: Date.now() }
        if (existing) await db.replace("staffing_timesheets_settings", existing._id, doc)
        else await db.insert("staffing_timesheets_settings", doc)
        await recordAudit(sys, actor, { action: "staffing-timesheets.settings.save", targetType: "staffing_projects", targetId: a.projectId, changes: { cadence: a.cadence, graceDays: a.graceDays } })
        return { operationId: op }
      },
    }),

    /** Sends the late timesheet reminder now (n8n `dr-nuoma-tabelio-priminimas`). */
    sendReminder: mutationGeneric({
      args: { ...actorArgs, projectId: v.id("staffing_projects") },
      handler: async (ctx, a) => {
        const { sys, actor } = await system.requirePermission(ctx, P.clientManage, opts(a))
        const p = await tsReader(ctx).get("staffing_projects", a.projectId)
        if (!p) fail("NOT_FOUND", "project_not_found", sys.operationId)
        const r = await queueReminder(ctx as never, p, "manual", todayIso())
        await recordAudit(sys, actor, { action: "staffing-timesheets.reminder.send", targetType: "staffing_projects", targetId: p._id, changes: { status: r.status } })
        return { status: r.status, operationId: sys.operationId }
      },
    }),

    // ---------------------------------------------------------------- internal

    /** Daily cron: one reminder per late project (at most one a day per project). */
    _dailyReminders: internalMutationGeneric({
      args: {},
      handler: async (ctx): Promise<{ queued: number }> => {
        const { sys } = await system.context(ctx)
        if (!isModuleEnabled(sys, await sys.store.get("modules", STAFFING_TIMESHEETS_MODULE_ID))) return { queued: 0 }
        const today = todayIso()
        let queued = 0
        for (const p of await activeProjects(ctx)) {
          const state = await projectState(ctx, p, today)
          if (!state.due.late) continue
          if (state.lastReminder && Date.now() - state.lastReminder.createdAt < 20 * 3_600_000) continue
          await queueReminder(ctx as never, p, "cron", today)
          queued++
        }
        return { queued }
      },
    }),

    _reminderPayload: internalQueryGeneric({
      args: { reminderId: v.id("staffing_timesheets_reminders") },
      handler: async (ctx, a) => {
        const db = tsReader(ctx)
        const r = await db.get("staffing_timesheets_reminders", a.reminderId)
        if (!r || !r.to) return null
        const p = await db.get("staffing_projects", r.projectId)
        if (!p) return null
        const client = await db.get("staffing_clients", p.clientId)
        const s = await settingsOf(ctx, p._id)
        const today = todayIso()
        const team = (
          await db
            .query("staffing_assignments")
            .withIndex("by_project", (q) => q.eq("projectId", p._id))
            .collect()
        ).filter((x) => isBlockingAssignment(x) && rangeCovers(x, addDays(today, -1)))
        return {
          to: r.to,
          language: client?.country === "LT" ? "lt" : "en",
          projectName: `${p.name} (${p.code})`,
          period: r.period,
          contactName: s?.contactName ?? client?.contacts.find((c) => c.email === r.to)?.name ?? client?.contacts[0]?.name,
          workerCount: new Set(team.map((x) => x.workerId)).size,
        }
      },
    }),

    _sendReminder: internalActionGeneric({
      args: { reminderId: v.id("staffing_timesheets_reminders") },
      handler: async (ctx, a): Promise<void> => {
        const payload = (await ctx.runQuery(ref("_reminderPayload"), { reminderId: a.reminderId } as never)) as Record<string, unknown> | null
        if (!payload) return
        const url = process.env.N8N_URL
        const secret = process.env.N8N_WEBHOOK_SECRET
        let status: ReminderStatus = "sent"
        let error: string | undefined
        if (!url || !secret) status = "not_configured"
        else {
          const redirectTo = process.env.APP_ENV !== "production" ? process.env.SUPER_USER_EMAILS?.split(",")[0]?.trim() : undefined
          try {
            const res = await fetch(`${url.replace(/\/+$/, "")}/webhook/dr-nuoma-tabelio-priminimas`, {
              method: "POST",
              headers: { "content-type": "application/json", "x-webhook-secret": secret },
              body: JSON.stringify({ ...payload, ...(redirectTo ? { redirectTo } : {}) }),
            })
            if (!res.ok) {
              status = "failed"
              error = `http_${res.status}`
            }
          } catch {
            status = "failed"
            error = "network"
          }
        }
        await ctx.runMutation(ref("_reminderResult"), { reminderId: a.reminderId, status, ...(error ? { error } : {}) } as never)
      },
    }),

    _reminderResult: internalMutationGeneric({
      args: { reminderId: v.id("staffing_timesheets_reminders"), status: v.union(v.literal("sent"), v.literal("not_configured"), v.literal("failed")), error: v.optional(v.string()) },
      handler: async (ctx, a): Promise<void> => {
        await tsWriter(ctx).patch("staffing_timesheets_reminders", a.reminderId, { status: a.status, ...(a.error ? { error: a.error } : {}) })
      },
    }),

    _aiContext: internalQueryGeneric({
      args: { sheetId: v.id("staffing_timesheets_clientSheets") },
      handler: async (ctx, a) => {
        const db = tsReader(ctx)
        const s = await db.get("staffing_timesheets_clientSheets", a.sheetId)
        if (!s) return null
        const assignments = await db
          .query("staffing_assignments")
          .withIndex("by_project", (q) => q.eq("projectId", s.projectId))
          .collect()
        const names: string[] = []
        for (const id of new Set(assignments.filter((x) => x.status !== "cancelled").map((x) => x.workerId))) {
          const w = await db.get("staffing_workers", id)
          if (w) names.push(fullName(w))
        }
        return { fileStorageId: s.fileStorageId ?? null, fileName: s.fileName ?? null, pageImageIds: s.pageImageIds ?? [], text: s.text ?? null, periodFrom: s.periodFrom, periodTo: s.periodTo, workerNames: names }
      },
    }),

    _parseWithAi: internalActionGeneric({
      args: { sheetId: v.id("staffing_timesheets_clientSheets") },
      handler: async (ctx, a): Promise<void> => {
        const c = (await ctx.runQuery(ref("_aiContext"), { sheetId: a.sheetId } as never)) as { fileStorageId: string | null; fileName: string | null; pageImageIds: string[]; text: string | null; periodFrom: string; periodTo: string; workerNames: string[] } | null
        if (!c) return
        const images: string[] = []
        let pdf: { name: string; dataUrl: string } | undefined
        const ids = c.pageImageIds.length ? c.pageImageIds : c.text ? [] : c.fileStorageId ? [c.fileStorageId] : []
        for (const id of ids) {
          const blob = await ctx.storage.get(id as never)
          if (!blob || blob.size > 8 * 1024 * 1024) continue
          // A PDF without rendered pages (email intake): the model reads the file itself.
          if (blob.type === "application/pdf" && !c.pageImageIds.length) {
            pdf = { name: c.fileName ?? "timesheet.pdf", dataUrl: `data:application/pdf;base64,${toBase64(new Uint8Array(await blob.arrayBuffer()))}` }
            continue
          }
          if (!(blob.type || "image/").startsWith("image/")) continue
          images.push(`data:${blob.type || "image/jpeg"};base64,${toBase64(new Uint8Array(await blob.arrayBuffer()))}`)
        }
        if (!images.length && !c.text && !pdf) {
          await ctx.runMutation(ref("_applyAiRows"), { sheetId: a.sheetId, status: "failed", error: "nothing_to_read" } as never)
          return
        }
        const res = await readTimesheetWithAi({ images, text: c.text ?? undefined, pdf, periodFrom: c.periodFrom, periodTo: c.periodTo, workerNames: c.workerNames })
        if (res.ok) await ctx.runMutation(ref("_applyAiRows"), { sheetId: a.sheetId, status: "ready", rows: res.rows, rawRows: res.raw.slice(0, MAX_RAW_ROWS) } as never)
        else await ctx.runMutation(ref("_applyAiRows"), { sheetId: a.sheetId, status: res.code === "AI_NOT_CONFIGURED" ? "ai_not_configured" : "failed", error: res.message } as never)
      },
    }),

    _applyAiRows: internalMutationGeneric({
      args: {
        sheetId: v.id("staffing_timesheets_clientSheets"),
        status: v.union(v.literal("ready"), v.literal("ai_not_configured"), v.literal("failed")),
        rows: v.optional(v.array(clientRowValidator)),
        rawRows: v.optional(v.array(rawClientRowValidator)),
        error: v.optional(v.string()),
      },
      handler: async (ctx, a): Promise<void> => {
        const db = tsWriter(ctx)
        const s = await db.get("staffing_timesheets_clientSheets", a.sheetId)
        if (!s) return
        const rows = [...s.rows, ...(a.rows ?? [])]
        // The period follows what the client actually wrote (email intake only guesses it).
        const range = s.email ? rowsRange(rows) : null
        await db.patch("staffing_timesheets_clientSheets", s._id, {
          status: a.status,
          rows,
          error: a.error,
          ...(a.rawRows?.length ? { rawRows: [...(s.rawRows ?? []), ...a.rawRows].slice(0, MAX_RAW_ROWS) } : {}),
          ...(range ? { periodFrom: range.from < s.periodFrom ? range.from : s.periodFrom, periodTo: range.to > s.periodTo ? range.to : s.periodTo } : {}),
        })
      },
    }),
  }
}

function toBase64(bytes: Uint8Array): string {
  let s = ""
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

export type TimesheetsFunctions = ReturnType<typeof defineTimesheets>
