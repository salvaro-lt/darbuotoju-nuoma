// Shared reads of the timesheets area. Like the base's operations they take
// any ctx with `db` and do NOT check permissions: guard first.
import type { GenericDatabaseReader } from "convex/server"
import type { GenericId } from "convex/values"
import type { staffingTables } from "../tables"
import type { DataModelOf, DbCtxLike, ProjectId, TradeId, WorkerId } from "../shared"
import { weekStartOf } from "./pure"
import type { timesheetsTables } from "./tables"

export type TimesheetsDataModel = DataModelOf<typeof staffingTables & typeof timesheetsTables>
export const tsReader = (ctx: DbCtxLike) => ctx.db as GenericDatabaseReader<TimesheetsDataModel>

export type EntryId = GenericId<"staffing_timesheets_entries">
export type ClientSheetId = GenericId<"staffing_timesheets_clientSheets">

/** One approved day of one worker (the invoicing contract). */
export interface ApprovedHoursRow {
  workerId: WorkerId
  assignmentId: GenericId<"staffing_assignments">
  tradeId: TradeId
  /** Trade code (e.g. `WELD-MAG`). */
  trade: string
  date: string
  regular: number
  overtime: number
  weekend: boolean
  night: boolean
}

/** Monday dates of the approved weeks of a project between `from` and `to`. */
export async function approvedWeeks(ctx: DbCtxLike, projectId: ProjectId, from: string, to: string): Promise<Set<string>> {
  const rows = await tsReader(ctx)
    .query("staffing_timesheets_weeks")
    .withIndex("by_project_week", (q) => q.eq("projectId", projectId).gte("weekStart", weekStartOf(from)).lte("weekStart", to))
    .collect()
  return new Set(rows.map((w) => w.weekStart))
}

/**
 * Approved hours of a project within `[from, to]` (inclusive ISO days): only
 * entries of approved weeks count. Sorted by date. Use it for invoicing.
 */
export async function approvedHours(ctx: DbCtxLike, args: { projectId: ProjectId; from: string; to: string }): Promise<ApprovedHoursRow[]> {
  const db = tsReader(ctx)
  const weeks = await approvedWeeks(ctx, args.projectId, args.from, args.to)
  if (weeks.size === 0) return []
  const entries = await db
    .query("staffing_timesheets_entries")
    .withIndex("by_project_date", (q) => q.eq("projectId", args.projectId).gte("date", args.from).lte("date", args.to))
    .collect()
  const tradeCode = new Map<string, string>()
  const out: ApprovedHoursRow[] = []
  for (const e of entries) {
    if (!weeks.has(weekStartOf(e.date))) continue
    if (!tradeCode.has(e.tradeId)) tradeCode.set(e.tradeId, (await db.get("staffing_trades", e.tradeId))?.code ?? "?")
    out.push({ workerId: e.workerId, assignmentId: e.assignmentId, tradeId: e.tradeId, trade: tradeCode.get(e.tradeId)!, date: e.date, regular: e.regularHours, overtime: e.overtimeHours, weekend: e.weekend, night: e.night })
  }
  return out
}
