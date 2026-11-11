// Demo data of the timesheets area, on top of `staffing:_seedDemo`:
//   npx convex run timesheets:_seedDemo            (skips if entries exist)
//   npx convex run timesheets:_seedDemo '{"reset":true}'
// Own hours for the active projects for the last 4 weeks (3 approved), a
// matching client timesheet, one with 4 deliberate mismatches and a misspelt
// name (NDS, last week), and a late client timesheet (BST). Refuses in production.
import { internalMutationGeneric, type GenericDatabaseWriter } from "convex/server"
import { v } from "convex/values"
import { addDays, todayIso } from "../pure"
import type { WorkerDoc } from "../shared"
import type { TimesheetsDataModel } from "./operations"
import { isoWeek, isWeekend, weekday, weekStartOf, type ClientRowInput } from "./pure"
import { seedTimesheetsSources } from "./seed-sources"
import type { TimesheetsTableName } from "./tables"

const TABLES: TimesheetsTableName[] = ["staffing_timesheets_entries", "staffing_timesheets_weeks", "staffing_timesheets_settings", "staffing_timesheets_resolutions", "staffing_timesheets_disputes", "staffing_timesheets_intake", "staffing_timesheets_clientSheets", "staffing_timesheets_reminders", "staffing_timesheets_workerEntries", "staffing_timesheets_workerLinks", "staffing_timesheets_inboxLinks"]

const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7)

/** Our hours of a worker on a day: shipyard (NDS) works some Saturdays with overtime; the steel site (BST) has short Fridays. */
function hoursFor(project: string, w: WorkerDoc, date: string): { regular: number; overtime: number } | null {
  const d = weekday(date)
  const h = hash(w.lastName)
  if (d === 6) return null
  if (project === "NDS") {
    if (d === 5) return h % 2 === 0 && isoWeek(date) % 2 === 1 ? { regular: 6, overtime: 0 } : null
    return { regular: 8, overtime: (h + Number(date.slice(8))) % 4 === 0 ? 2 : 0 }
  }
  if (d === 5) return null
  if ((h + Number(date.slice(8))) % 19 === 0) return null // a sick day
  return { regular: d === 4 ? 6 : 8, overtime: 0 }
}

/** How the client writes a worker's name. */
export function clientName(w: WorkerDoc): string {
  if (w.lastName === "Zrazkovych") return "Zrazkovich Sergii"
  const style = hash(w.firstName) % 3
  if (style === 0) return `${w.lastName.toUpperCase()} ${w.firstName}`
  if (style === 1) return `${w.firstName[0]}. ${w.lastName}`
  return `${w.lastName}, ${w.firstName}`
}

export function defineTimesheetsSeed() {
  return {
    _seedDemo: internalMutationGeneric({
      args: { reset: v.optional(v.boolean()) },
      handler: async (ctx, a): Promise<{ seeded: boolean; entries: number; approvedWeeks: number; clientSheets: number; sources: Awaited<ReturnType<typeof seedTimesheetsSources>> }> => {
        const env = process.env.APP_ENV
        if (!env || env === "production") throw new Error(`timesheets:_seedDemo refuses to run with APP_ENV=${env ?? "(unset)"}`)
        const db = ctx.db as GenericDatabaseWriter<TimesheetsDataModel>
        if (a.reset) for (const t of TABLES) for (const row of await db.query(t).collect()) await db.delete(t, row._id as never)
        const byCode = async (code: string) =>
          db
            .query("staffing_projects")
            .withIndex("by_code", (q) => q.eq("code", code))
            .first()
        const nds = await byCode("NDS-2026-07")
        const bst = await byCode("BST-2026-03")
        if (!nds || !bst) throw new Error("Run `npx convex run staffing:_seedDemo` first (projects NDS-2026-07 and BST-2026-03 are missing).")

        const today = todayIso()
        const thisMonday = weekStartOf(today)
        const firstMonday = addDays(thisMonday, -28)
        const yesterday = addDays(today, -1)
        const now = Date.now()
        // Base data present: only the DIG-111 part (own idempotency) may still be missing.
        if (!a.reset && (await db.query("staffing_timesheets_entries").first())) {
          const sources = await seedTimesheetsSources(db, { nds, bst, today, thisMonday, clientName, now })
          return { seeded: sources.links > 0, entries: 0, approvedWeeks: 0, clientSheets: 0, sources }
        }
        let entries = 0
        let approvedWeeks = 0
        let clientSheets = 0
        const workersOf = new Map<string, WorkerDoc[]>()

        for (const [tag, p] of [
          ["NDS", nds],
          ["BST", bst],
        ] as const) {
          const assignments = (
            await db
              .query("staffing_assignments")
              .withIndex("by_project", (q) => q.eq("projectId", p._id))
              .collect()
          ).filter((x) => x.status === "active" || x.status === "ended" || x.status === "confirmed")
          const ws: WorkerDoc[] = []
          for (const x of assignments) {
            const w = await db.get("staffing_workers", x.workerId)
            if (!w) continue
            ws.push(w)
            for (let day = firstMonday < x.startDate ? x.startDate : firstMonday; day <= yesterday && (!x.endDate || day <= x.endDate); day = addDays(day, 1)) {
              const h = hoursFor(tag, w, day)
              if (!h) continue
              await db.insert("staffing_timesheets_entries", {
                assignmentId: x._id,
                projectId: p._id,
                workerId: w._id,
                tradeId: x.tradeId,
                date: day,
                regularHours: h.regular,
                overtimeHours: h.overtime,
                weekend: isWeekend(day),
                night: false,
                updatedBy: "seed",
                updatedAt: now,
              })
              entries++
            }
          }
          workersOf.set(tag, ws)
          // Weeks W-4 … W-2 approved; last week waits for the client's timesheet.
          for (let i = 4; i >= 2; i--) {
            await db.insert("staffing_timesheets_weeks", { projectId: p._id, weekStart: addDays(thisMonday, -7 * i), approvedBy: "seed", approvedAt: now - i * 86_400_000 * 7 + 3 * 86_400_000 })
            approvedWeeks++
          }
          const client = await db.get("staffing_clients", p.clientId)
          const contact = client?.contacts.find((c) => c.email)
          await db.insert("staffing_timesheets_settings", { projectId: p._id, cadence: "weekly", graceDays: 2, ...(contact?.email ? { contactEmail: contact.email } : {}), ...(contact?.name ? { contactName: contact.name } : {}), updatedAt: now })
        }

        /** Client rows for a week, from our hours, with optional edits. */
        const clientRows = async (tag: "NDS" | "BST", projectId: typeof nds._id, monday: string): Promise<ClientRowInput[]> => {
          const rows: ClientRowInput[] = []
          const own = await db
            .query("staffing_timesheets_entries")
            .withIndex("by_project_date", (q) => q.eq("projectId", projectId).gte("date", monday).lte("date", addDays(monday, 6)))
            .collect()
          const ws = new Map(workersOf.get(tag)!.map((w) => [w._id as string, w]))
          for (const e of own) rows.push({ name: clientName(ws.get(e.workerId)!), date: e.date, hours: e.regularHours + e.overtimeHours })
          return rows.sort((x, y) => x.name.localeCompare(y.name) || x.date.localeCompare(y.date))
        }
        const sheet = async (projectId: typeof nds._id, monday: string, source: "csv" | "xlsx", fileName: string, rows: ClientRowInput[], daysAfter: number) => {
          clientSheets++
          return db.insert("staffing_timesheets_clientSheets", {
            projectId,
            periodFrom: monday,
            periodTo: addDays(monday, 6),
            source,
            status: "ready",
            fileName,
            rows,
            nameMap: [],
            receivedAt: Date.parse(`${addDays(monday, 6 + daysAfter)}T09:30:00Z`),
            createdBy: "seed",
          })
        }

        // NDS: W-2 matches exactly; W-1 has four mismatches and a misspelt name.
        const w2 = addDays(thisMonday, -14)
        const w1 = addDays(thisMonday, -7)
        await sheet(nds._id, w2, "xlsx", `NDS_timeliste_uke${isoWeek(w2)}.xlsx`, await clientRows("NDS", nds._id, w2), 1)
        const nw = workersOf.get("NDS")!
        const find = (last: string) => nw.find((w) => w.lastName === last)
        let rows = await clientRows("NDS", nds._id, w1)
        const tweak = (w: WorkerDoc | undefined, date: string, f: (r: ClientRowInput | undefined) => ClientRowInput | null) => {
          if (!w) return
          const name = clientName(w)
          const i = rows.findIndex((r) => r.name === name && r.date === date)
          const next = f(rows[i])
          if (i >= 0) rows = next ? rows.map((r, j) => (j === i ? next : r)) : rows.filter((_, j) => j !== i)
          else if (next) rows.push(next)
        }
        tweak(find("Pavyzdys"), addDays(w1, 1), (r) => (r ? { ...r, hours: r.hours + 2 } : null)) // client counts 2 h more
        tweak(find("Testenko"), addDays(w1, 3), (r) => (r ? { ...r, hours: r.hours - 0.5 } : null)) // client counts 0.5 h less
        const saturday = addDays(w1, 5)
        const satWorker = nw.find((w) => !["Pavyzdys", "Testenko", "Próbny", "Paraugs"].includes(w.lastName) && !hoursFor("NDS", w, saturday))
        tweak(satWorker, saturday, () => ({ name: clientName(satWorker!), date: saturday, hours: 6 })) // a Saturday we don't have
        tweak(find("Próbny"), addDays(w1, 4), () => null) // the client missed a Friday
        await sheet(nds._id, w1, "csv", `NDS_timeliste_uke${isoWeek(w1)}.csv`, rows, 2)

        // BST: the client's last timesheet covers W-4 only → late.
        const w4 = addDays(thisMonday, -28)
        await sheet(bst._id, w4, "xlsx", `BST_Stundenzettel_KW${isoWeek(w4)}.xlsx`, await clientRows("BST", bst._id, w4), 3)

        const sources = await seedTimesheetsSources(db, { nds, bst, today, thisMonday, clientName, now })
        return { seeded: true, entries, approvedWeeks, clientSheets, sources }
      },
    }),
  }
}
