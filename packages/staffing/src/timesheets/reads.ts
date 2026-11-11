// Shared reads of the three sources (DIG-111). Like operations.ts they take any
// ctx with `db` and do NOT check permissions: guard first.
import type { GenericDatabaseWriter } from "convex/server"
import { addDays } from "../pure"
import type { DbCtxLike, ProjectId, WorkerDoc } from "../shared"
import { tsReader, type TimesheetsDataModel } from "./operations"
import { matchWorker, roundHours, type OwnDay } from "./pure"

export const tsWriter = (ctx: DbCtxLike) => ctx.db as GenericDatabaseWriter<TimesheetsDataModel>

/** Assignments whose hours are recorded (not proposed / cancelled). */
export const RECORDABLE = new Set(["confirmed", "active", "ended"])

/** Workers named on a project (any non-cancelled assignment), for client-name matching. */
export async function projectWorkers(ctx: DbCtxLike, projectId: ProjectId): Promise<WorkerDoc[]> {
  const db = tsReader(ctx)
  const assignments = await db
    .query("staffing_assignments")
    .withIndex("by_project", (q) => q.eq("projectId", projectId))
    .collect()
  const out: WorkerDoc[] = []
  for (const id of new Set(assignments.filter((a) => a.status !== "cancelled").map((a) => a.workerId))) {
    const w = await db.get("staffing_workers", id)
    if (w) out.push(w)
  }
  return out
}

/**
 * Client hours per worker per day within `[from, to]` from the project's
 * client sheets (with rows). A later-received sheet replaces an earlier one's
 * days. `covered`: days some sheet speaks about (a worker missing there = 0).
 */
export async function clientDays(ctx: DbCtxLike, projectId: ProjectId, from: string, to: string, workers?: WorkerDoc[]): Promise<{ client: OwnDay[]; covered: string[] }> {
  const db = tsReader(ctx)
  const sheets = (
    await db
      .query("staffing_timesheets_clientSheets")
      .withIndex("by_project", (q) => q.eq("projectId", projectId).gte("periodTo", from))
      .collect()
  )
    .filter((s) => s.periodFrom <= to && s.rows.length > 0)
    .sort((a, b) => a.receivedAt - b.receivedAt)
  if (!sheets.length) return { client: [], covered: [] }
  const people = (workers ?? (await projectWorkers(ctx, projectId))).map((w) => ({ id: w._id as string, firstName: w.firstName, lastName: w.lastName }))
  const byDay = new Map<string, Map<string, number>>()
  for (const s of sheets) {
    const manual = new Map(s.nameMap.map((m) => [m.name, m.workerId as string]))
    const ids = new Map<string, string | null>()
    const days = new Map<string, Map<string, number>>()
    for (const r of s.rows) {
      if (r.date < from || r.date > to) continue
      if (!ids.has(r.name)) ids.set(r.name, manual.get(r.name) ?? matchWorker(r.name, people)?.worker.id ?? null)
      const id = ids.get(r.name)
      if (!id) continue
      const day = days.get(r.date) ?? new Map<string, number>()
      day.set(id, roundHours((day.get(id) ?? 0) + r.hours))
      days.set(r.date, day)
    }
    const start = s.periodFrom > from ? s.periodFrom : from
    const end = s.periodTo < to ? s.periodTo : to
    for (let d = start; d <= end; d = addDays(d, 1)) byDay.set(d, days.get(d) ?? new Map())
  }
  const client: OwnDay[] = []
  for (const [date, m] of byDay) for (const [workerId, hours] of m) client.push({ workerId, date, hours })
  return { client, covered: [...byDay.keys()].sort() }
}
