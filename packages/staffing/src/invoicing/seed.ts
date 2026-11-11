// Demo data of the invoicing area, on top of `staffing:_seedDemo` and
// `timesheets:_seedDemo` (run them first, in this order):
//   npx convex run invoicing:_seedDemo            (skips when invoices exist)
//   npx convex run invoicing:_seedDemo '{"reset":true}'
//
// Where the hours come from: every billable hour is a timesheets hour. The
// timesheets seed covers the last 4 weeks (3 approved); this seed backfills
// the earlier history of each active project into the timesheets tables
// (entries, approved weeks and matching client timesheets, marked
// `seed-invoicing` so a reset removes exactly them) and adds two manual
// corrections. Invoices are then drafted from `billableHours` (approved weeks +
// corrections), like the "new draft" button does.
//
// The story: one client period that ended 2–3 months ago (the busiest, about
// €40,000) was never invoiced: the chain broke after the timesheet. Plus
// worker wage rates, project costs (one healthy and one poor project), known
// suppliers and purchase invoices in every state. Refuses when APP_ENV is
// production or unset.
import { internalMutationGeneric, type GenericDatabaseWriter } from "convex/server"
import { v } from "convex/values"
import { addDays, daysBetween, rangeCovers, todayIso } from "../pure"
import type { ProjectDoc, WorkerDoc } from "../shared"
import { weekday, weekStartOf } from "../timesheets/pure"
import { allocateInvoiceNumber, billableHours, buildDraft, hoursValueCents, invWriter, rateTermsResolver, type InvoicingDataModel } from "./operations"
import { billingPeriodsBetween, defaultWageCents, dueDateFor, REMINDER_STAGE_DAYS, type CostCategory, type Period, type ReminderStage } from "./pure"
import type { InvoicingTableName } from "./tables"

const TABLES: InvoicingTableName[] = [
  "staffing_invoicing_reminders",
  "staffing_invoicing_payments",
  "staffing_invoicing_invoices",
  "staffing_invoicing_counters",
  "staffing_invoicing_costs",
  "staffing_invoicing_hours",
  "staffing_invoicing_terms",
  "staffing_invoicing_purchases",
  "staffing_invoicing_suppliers",
  "staffing_invoicing_purchaseInboxes",
  "staffing_invoicing_wageRates",
  "staffing_invoicing_chainRuns",
]
/** Marks the timesheets rows this seed writes (history before the timesheets seed's 4 weeks). */
const BY = "seed-invoicing"
const MAX_WEEKS = 18
/** The forgotten period is topped up with overtime (a busy month) to about this value. */
const FORGOTTEN_TARGET_CENTS = 40_000_00
type SeedState = "draft" | "approved" | "sent" | "partially_paid" | "overdue" | "paid"
type Db = GenericDatabaseWriter<InvoicingDataModel>

/** Non-wage cost profile per project, as shares of the weekly value of hours, plus one-offs. Wages come from the workers' hourly cost. */
interface CostProfile {
  accommodationPct: number
  travelPct: number
  transportPerTrip: number
  ppePerWorker: number
  /** Own workers' hourly cost relative to the trade default (posted-worker rules differ per country). */
  wageFactorPct: number
}
const HEALTHY: CostProfile = { accommodationPct: 7, travelPct: 4, transportPerTrip: 180_00, ppePerWorker: 95_00, wageFactorPct: 100 }
const POOR: CostProfile = { accommodationPct: 17, travelPct: 7, transportPerTrip: 240_00, ppePerWorker: 110_00, wageFactorPct: 112 }
/** Subcontracted workers cost more per hour (the subcontractor's margin). */
const SUBCONTRACTOR_WAGE_PCT = 135

const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7)

/** History hours, in the same style as the timesheets seed: the long-running site has short Fridays and no Saturdays; others work some Saturdays and some overtime. */
function historyHours(style: "steel" | "yard", w: WorkerDoc, date: string): { regular: number; overtime: number } | null {
  const d = weekday(date) // Monday 0 … Sunday 6
  const h = hash(w.lastName)
  if (d === 6) return null
  if (style === "steel") {
    if (d === 5) return null
    if ((h + Number(date.slice(8))) % 19 === 0) return null // a sick day
    return { regular: d === 4 ? 6 : 8, overtime: 0 }
  }
  if (d === 5) return (h + Number(date.slice(8))) % 3 === 0 ? { regular: 6, overtime: 0 } : null
  return { regular: 8, overtime: (h + Number(date.slice(8))) % 4 === 0 ? 2 : 0 }
}

async function wipe(db: Db) {
  for (const t of TABLES) for (const row of await db.query(t).collect()) await db.delete(t, row._id as never)
  for (const e of await db.query("staffing_timesheets_entries").collect()) if (e.updatedBy === BY) await db.delete("staffing_timesheets_entries", e._id)
  for (const w of await db.query("staffing_timesheets_weeks").collect()) if (w.approvedBy === BY) await db.delete("staffing_timesheets_weeks", w._id)
  for (const s of await db.query("staffing_timesheets_clientSheets").collect()) if (s.createdBy === BY) await db.delete("staffing_timesheets_clientSheets", s._id)
}

export function defineInvoicingSeed(prefix: string) {
  return {
    /** Dev only: timesheet history, invoices, the forgotten period, wage rates, costs and purchase invoices (needs `staffing:_seedDemo` and `timesheets:_seedDemo` first). */
    _seedDemo: internalMutationGeneric({
      args: { reset: v.optional(v.boolean()) },
      handler: async (ctx, a) => {
        const env = process.env.APP_ENV
        if (!env || env === "production") throw new Error(`invoicing:_seedDemo refuses to run with APP_ENV=${env ?? "(unset)"}`)
        const db = invWriter(ctx)
        if (a.reset) await wipe(db)
        else if (await db.query("staffing_invoicing_invoices").first()) return { seeded: false }
        const today = todayIso()
        const yesterday = addDays(today, -1)
        const thisMonday = weekStartOf(today)
        const now = Date.now()
        const projects = (await db.query("staffing_projects").collect()).filter((p) => p.status === "active").sort((x, y) => x.startDate.localeCompare(y.startDate))
        if (!projects.length) throw new Error("No active projects: run `npx convex run staffing:_seedDemo` first")
        const poor = projects.length > 1 ? projects[0]! : null
        const profileOf = (p: ProjectDoc) => (p === poor ? POOR : HEALTHY)

        // ---- surcharges: the longest-running client pays a lower overtime surcharge (agreed 120 %).
        await db.insert("staffing_invoicing_terms", { clientId: projects[0]!.clientId, overtimePct: 120, weekendPct: 150, updatedAt: now })

        // ---- 1. timesheet history before what the timesheets seed wrote (or everything, without it).
        const workerDoc = new Map<string, WorkerDoc>()
        const history: { project: ProjectDoc; from: string; to: string; withTimesheets: boolean }[] = []
        let entries = 0
        for (const p of projects) {
          const first = await db
            .query("staffing_timesheets_entries")
            .withIndex("by_project_date", (i) => i.eq("projectId", p._id))
            .first()
          const from = [p.startDate, addDays(today, -7 * MAX_WEEKS)].sort().at(-1)!
          const to = first ? addDays(first.date, -1) : yesterday
          history.push({ project: p, from, to, withTimesheets: !!first })
          if (to < from) continue
          const style = p === poor ? "steel" : "yard"
          const team = (
            await db
              .query("staffing_assignments")
              .withIndex("by_project", (i) => i.eq("projectId", p._id))
              .collect()
          ).filter((x) => x.status === "active" || x.status === "ended" || x.status === "confirmed")
          for (const as of team) {
            const w = await db.get("staffing_workers", as.workerId)
            if (!w) continue
            workerDoc.set(w._id, w)
            for (let d = from; d <= to; d = addDays(d, 1)) {
              if (!rangeCovers(as, d)) continue
              const h = historyHours(style, w, d)
              if (!h) continue
              await db.insert("staffing_timesheets_entries", { assignmentId: as._id, projectId: p._id, workerId: w._id, tradeId: as.tradeId, date: d, regularHours: h.regular, overtimeHours: h.overtime, weekend: weekday(d) >= 5, night: false, updatedBy: BY, updatedAt: now })
              entries++
            }
          }
        }

        // ---- 2. the forgotten period: the most valuable client period that ended 2–4 months ago (else
        // 30+ days); a busy month, so its weekdays get overtime until it is worth about €40,000.
        const clientIds = [...new Set(projects.map((p) => p.clientId))]
        const candidates: { clientId: string; period: Period; valueCents: number; ago: number }[] = []
        for (const clientId of clientIds) {
          const client = (await db.get("staffing_clients", clientId))!
          const own = projects.filter((p) => p.clientId === clientId)
          const termsFor = await rateTermsResolver(ctx, client, own)
          const start = own.map((p) => p.startDate).sort()[0]!
          for (const pr of billingPeriodsBetween(client.invoicingPeriod, start, today)) {
            const ago = daysBetween(pr.to, today)
            if (ago < 30 || ago > 120 || pr.from < start) continue
            let value = 0
            for (const p of own)
              for (const e of await db
                .query("staffing_timesheets_entries")
                .withIndex("by_project_date", (i) => i.eq("projectId", p._id).gte("date", pr.from).lte("date", pr.to))
                .collect())
                value += hoursValueCents({ regular: e.weekend ? 0 : e.regularHours, overtime: e.weekend ? 0 : e.overtimeHours, weekend: e.weekend ? e.regularHours + e.overtimeHours : 0 }, termsFor(p._id, e.tradeId))
            if (value > 0) candidates.push({ clientId, period: pr, valueCents: value, ago })
          }
        }
        const pick = (minAgo: number) =>
          candidates
            .filter((c) => c.ago >= minAgo)
            .sort((x, y) => y.valueCents - x.valueCents)
            .map(({ ago: _ago, ...c }) => c)[0] ?? null
        const forgotten: { clientId: string; period: Period; valueCents: number } | null = pick(55) ?? pick(30)
        if (forgotten &&forgotten.valueCents < FORGOTTEN_TARGET_CENTS) {
          const client = (await db.get("staffing_clients", forgotten.clientId as never))!
          const own = projects.filter((p) => p.clientId === forgotten!.clientId)
          const termsFor = await rateTermsResolver(ctx, client, own)
          const rows = []
          for (const p of own)
            rows.push(
              ...(
                await db
                  .query("staffing_timesheets_entries")
                  .withIndex("by_project_date", (i) => i.eq("projectId", p._id).gte("date", forgotten!.period.from).lte("date", forgotten!.period.to))
                  .collect()
              ).filter((e) => e.updatedBy === BY && !e.weekend && e.overtimeHours === 0),
            )
          rows.sort((x, y) => x.date.localeCompare(y.date) || x.workerId.localeCompare(y.workerId))
          for (const extra of [2, 1]) {
            for (const e of rows) {
              if (forgotten.valueCents >= FORGOTTEN_TARGET_CENTS) break
              const before = hoursValueCents({ regular: e.regularHours, overtime: e.overtimeHours, weekend: 0 }, termsFor(e.projectId, e.tradeId))
              const overtimeHours = e.overtimeHours + extra
              const after = hoursValueCents({ regular: e.regularHours, overtime: overtimeHours, weekend: 0 }, termsFor(e.projectId, e.tradeId))
              await db.patch("staffing_timesheets_entries", e._id, { overtimeHours })
              e.overtimeHours = overtimeHours
              forgotten.valueCents += after - before
            }
          }
        }

        // ---- 3. approve the history weeks and add the client's matching timesheets (one per billing period).
        let weeks = 0
        let sheets = 0
        for (const { project: p, from, to, withTimesheets } of history) {
          if (to < from) continue
          // Below the timesheets seed's weeks: every history week. Without it: all but last week and this week.
          const lastMonday = withTimesheets ? weekStartOf(to) : addDays(thisMonday, -14)
          for (let monday = weekStartOf(from); monday <= lastMonday; monday = addDays(monday, 7)) {
            const exists = await db
              .query("staffing_timesheets_weeks")
              .withIndex("by_project_week", (i) => i.eq("projectId", p._id).eq("weekStart", monday))
              .first()
            if (exists) continue
            await db.insert("staffing_timesheets_weeks", { projectId: p._id, weekStart: monday, approvedBy: BY, approvedAt: Date.parse(`${addDays(monday, 8)}T10:00:00Z`) })
            weeks++
          }
          const client = (await db.get("staffing_clients", p.clientId))!
          for (const pr of billingPeriodsBetween(client.invoicingPeriod, from, to)) {
            const sFrom = pr.from < from ? from : pr.from
            const sTo = pr.to > to ? to : pr.to
            const own = await db
              .query("staffing_timesheets_entries")
              .withIndex("by_project_date", (i) => i.eq("projectId", p._id).gte("date", sFrom).lte("date", sTo))
              .collect()
            if (!own.length) continue
            const rows = own.map((e) => {
              const w = workerDoc.get(e.workerId)
              return { name: w ? `${w.lastName} ${w.firstName}` : "?", date: e.date, hours: e.regularHours + e.overtimeHours }
            })
            await db.insert("staffing_timesheets_clientSheets", {
              projectId: p._id,
              periodFrom: sFrom,
              periodTo: sTo,
              source: "xlsx",
              status: "ready",
              fileName: `${p.code}_timesheet_${sFrom}_${sTo}.xlsx`,
              rows: rows.sort((x, y) => x.name.localeCompare(y.name) || x.date.localeCompare(y.date)),
              nameMap: [],
              receivedAt: Date.parse(`${addDays(sTo, 3)}T09:30:00Z`),
              createdBy: BY,
            })
            sheets++
          }
        }
        // Gaps: approved weeks before the client's latest timesheet that no timesheet covers get one (the
        // client did send it). Weeks after the latest stay open: that is the timesheets area's "late" story.
        for (const p of projects) {
          const all = await db
            .query("staffing_timesheets_clientSheets")
            .withIndex("by_project", (i) => i.eq("projectId", p._id))
            .collect()
          const latest = all.reduce<string | null>((m, s) => (!m || s.periodTo > m ? s.periodTo : m), null)
          if (!latest) continue
          for (const w of await db
            .query("staffing_timesheets_weeks")
            .withIndex("by_project_week", (i) => i.eq("projectId", p._id))
            .collect()) {
            const sunday = addDays(w.weekStart, 6)
            if (sunday > latest || all.some((s) => s.periodFrom <= w.weekStart && s.periodTo >= sunday)) continue
            const own = await db
              .query("staffing_timesheets_entries")
              .withIndex("by_project_date", (i) => i.eq("projectId", p._id).gte("date", w.weekStart).lte("date", sunday))
              .collect()
            if (!own.length) continue
            const rows = []
            for (const e of own) {
              const wd = workerDoc.get(e.workerId) ?? (await db.get("staffing_workers", e.workerId))
              rows.push({ name: wd ? `${wd.lastName} ${wd.firstName}` : "?", date: e.date, hours: e.regularHours + e.overtimeHours })
            }
            await db.insert("staffing_timesheets_clientSheets", { projectId: p._id, periodFrom: w.weekStart, periodTo: sunday, source: "xlsx", status: "ready", fileName: `${p.code}_timesheet_${w.weekStart}.xlsx`, rows: rows.sort((x, y) => x.name.localeCompare(y.name) || x.date.localeCompare(y.date)), nameMap: [], receivedAt: Date.parse(`${addDays(sunday, 2)}T09:30:00Z`), createdBy: BY })
            sheets++
          }
        }

        // ---- 4. manual corrections on top of the approved weeks (source "manual").
        let corrections = 0
        for (const p of projects) {
          const day = addDays(weekStartOf(addDays(today, -21)), 5) // a Saturday three weeks ago
          let as = null
          for (const x of await db
            .query("staffing_assignments")
            .withIndex("by_project", (i) => i.eq("projectId", p._id))
            .collect()) {
            if (x.status !== "active" || !rangeCovers(x, day)) continue
            const worked = await db
              .query("staffing_timesheets_entries")
              .withIndex("by_assignment_date", (i) => i.eq("assignmentId", x._id).eq("date", day))
              .first()
            if (!worked) {
              as = x
              break
            }
          }
          if (!as) continue
          await db.insert("staffing_invoicing_hours", { projectId: p._id, workerId: as.workerId, tradeId: as.tradeId, date: day, regular: 0, overtime: 0, weekend: 6, source: "manual", note: "Kliento patvirtintas šeštadienio darbas (avarinis remontas), tabelyje nebuvo", createdBy: "seed" })
          corrections++
        }

        // ---- 5. wage rates: own workers per trade default (× the project's factor), subcontracted workers dearer;
        // one worker per project stays on the trade default.
        let wageRates = 0
        for (const p of projects) {
          const team = await db
            .query("staffing_assignments")
            .withIndex("by_project", (i) => i.eq("projectId", p._id))
            .collect()
          for (const [i, as] of team.entries()) {
            if (as.status === "cancelled" || as.status === "proposed" || i === 1) continue
            if (await db.query("staffing_invoicing_wageRates").withIndex("by_worker", (q) => q.eq("workerId", as.workerId)).first()) continue
            const w = workerDoc.get(as.workerId) ?? (await db.get("staffing_workers", as.workerId))
            const trade = await db.get("staffing_trades", as.tradeId)
            const base = defaultWageCents(trade?.code)
            const pct = w?.source === "subcontractor" ? SUBCONTRACTOR_WAGE_PCT : profileOf(p).wageFactorPct
            const cents = Math.round((base * pct) / 100 / 10) * 10 + (hash(w?.lastName ?? "") % 5) * 10
            await db.insert("staffing_invoicing_wageRates", { workerId: as.workerId, hourlyCostCents: cents, updatedBy: "seed", updatedAt: now })
            wageRates++
          }
        }

        // ---- 6. invoices per client, period by period, from the billable hours. Newest: draft; then sent
        // (not due); then partially paid and overdue; older: paid. Short payment terms: approved, then paid.
        // The forgotten period gets none.
        let invoices = 0
        let reminders = 0
        for (const clientId of clientIds) {
          const client = (await db.get("staffing_clients", clientId))!
          const firstStart = projects.filter((p) => p.clientId === clientId).map((p) => p.startDate).sort()[0]!
          const periods = billingPeriodsBetween(client.invoicingPeriod, [firstStart, addDays(today, -7 * MAX_WEEKS)].sort().at(-1)!, today).filter((pr) => pr.to < today && !(forgotten && forgotten.clientId === clientId && forgotten.period.from === pr.from))
          const plan: SeedState[] = client.paymentTermsDays >= 40 ? ["draft", "sent", "partially_paid", "overdue"] : ["approved", "paid"]
          const withHours: { pr: Period; draft: Awaited<ReturnType<typeof buildDraft>> }[] = []
          for (const pr of periods) {
            const draft = await buildDraft(ctx, client, pr.from, pr.to)
            if (draft.lines.length) withHours.push({ pr, draft })
          }
          const newestFirst = [...withHours].reverse()
          const chronological = newestFirst.map((x, i) => ({ ...x, state: plan[i] ?? ("paid" as SeedState) })).reverse()
          for (const { pr, draft, state } of chronological) {
            const issueDate = addDays(pr.to, 2) > today ? today : addDays(pr.to, 2)
            const base = {
              clientId,
              periodFrom: pr.from,
              periodTo: pr.to,
              currency: client.currency,
              lines: draft.lines,
              projectIds: draft.projectIds,
              vatRatePct: draft.vatRatePct,
              subtotalCents: draft.subtotalCents,
              vatCents: draft.vatCents,
              totalCents: draft.totalCents,
              notes: "",
              createdBy: "seed",
              updatedAt: now,
            }
            invoices++
            if (state === "draft") {
              await db.insert("staffing_invoicing_invoices", { ...base, status: "draft", paidCents: 0 })
              continue
            }
            const number = await allocateInvoiceNumber(ctx, prefix, Number(issueDate.slice(0, 4)))
            const dueDate = dueDateFor(issueDate, client.paymentTermsDays)
            const issued = { ...base, number, issueDate, dueDate, approvedBy: "seed", approvedAt: Date.parse(`${issueDate}T09:00:00Z`) }
            const sentAt = Date.parse(`${issueDate}T11:00:00Z`)
            if (state === "approved") {
              await db.insert("staffing_invoicing_invoices", { ...issued, status: "approved", paidCents: 0 })
              continue
            }
            if (state === "paid") {
              const paidAt = [addDays(dueDate, -4), yesterday].sort()[0]!
              const id = await db.insert("staffing_invoicing_invoices", { ...issued, status: "paid", sentAt, paidCents: draft.totalCents, paidAt })
              await db.insert("staffing_invoicing_payments", { invoiceId: id, date: paidAt, amountCents: draft.totalCents, reference: `Banko pavedimas ${number}`, createdBy: "seed" })
              continue
            }
            const partial = state === "partially_paid" ? Math.round(draft.totalCents * 0.4) : 0
            const id = await db.insert("staffing_invoicing_invoices", { ...issued, status: partial ? "partially_paid" : "sent", sentAt, paidCents: partial })
            if (partial) await db.insert("staffing_invoicing_payments", { invoiceId: id, date: [addDays(dueDate, -2), yesterday].sort()[0]!, amountCents: partial, reference: `Dalinis apmokėjimas ${number}`, createdBy: "seed" })
            // Reminder history: a long-overdue invoice got both stages; a partially paid one stage 1 only,
            // so stage 2 is due now (the "send reminders" button / daily job sends it).
            const late = daysBetween(dueDate, today)
            const historyStages: ReminderStage[] = state === "overdue" ? [1, 2] : [1]
            for (const stage of historyStages) {
              if (late < REMINDER_STAGE_DAYS[stage]) continue
              const at = Date.parse(`${addDays(dueDate, REMINDER_STAGE_DAYS[stage])}T07:00:00Z`)
              await db.insert("staffing_invoicing_reminders", { invoiceId: id, stage, daysOverdue: REMINDER_STAGE_DAYS[stage], trigger: "cron", status: "sent", to: client.contacts.find((c) => c.email)?.email, createdBy: "seed", completedAt: at })
              reminders++
            }
          }
        }

        // ---- 7. project costs (non-wage; wages come from hours × hourly cost): weekly accommodation and per
        // diems as shares of the value of the hours; one-off transport and workwear per worker. The newest
        // project is the healthy one, the long-running one the poor one.
        let costs = 0
        const add = async (p: ProjectDoc, category: CostCategory, date: string, amountCents: number, note: string) => {
          if (amountCents <= 0) return
          await db.insert("staffing_invoicing_costs", { projectId: p._id, category, date, amountCents, note, createdBy: "seed" })
          costs++
        }
        for (const p of projects) {
          const profile = profileOf(p)
          const client = (await db.get("staffing_clients", p.clientId))!
          const termsFor = await rateTermsResolver(ctx, client, [p])
          const rows = await billableHours(ctx, { projectId: p._id, from: "0000-01-01", to: today })
          const weekly = new Map<string, number>()
          for (const h of rows) weekly.set(weekStartOf(h.date), (weekly.get(weekStartOf(h.date)) ?? 0) + hoursValueCents(h, termsFor(h.projectId, h.tradeId)))
          for (const [week, value] of [...weekly.entries()].sort()) {
            const friday = addDays(week, 4)
            await add(p, "accommodation", friday, Math.round((value * profile.accommodationPct) / 100), "Apgyvendinimas (savaitė)")
            await add(p, "travel", friday, Math.round((value * profile.travelPct) / 100), "Dienpinigiai")
          }
          const workers = new Set(rows.map((r) => r.workerId)).size
          await add(p, "transport", p.startDate, profile.transportPerTrip * workers, "Kelionė į objektą (mikroautobusas, keltas)")
          await add(p, "ppe", addDays(p.startDate, -2), profile.ppePerWorker * workers, "Darbo drabužiai ir AAP")
          if (profile === POOR) await add(p, "other", addDays(today, -20), 1450_00, "Kliento atmesto darbo perdarymas")
        }

        // ---- 8. known suppliers and purchase invoices in every state.
        const poorP = poor ?? projects[0]!
        const healthyP = projects.at(-1)!
        const supplier = (name: string, emails: string[], category: CostCategory, defaultProjectId?: ProjectDoc["_id"]) => db.insert("staffing_invoicing_suppliers", { name, emails, category, ...(defaultProjectId ? { defaultProjectId } : {}), active: true, updatedAt: now })
        const hotel = await supplier("Hotel Hafenblick GmbH (demo)", ["rechnung@hafenblick.example"], "accommodation", poorP._id)
        const cars = await supplier("UAB Autonuoma (demo)", ["saskaitos@autonuoma.example"], "transport")
        const fuel = await supplier("Degalų kortelės UAB (demo)", ["@degalai-demo.example"], "transport")
        const subcontractorClient = (await db.query("staffing_clients").collect()).find((c) => c.kind === "subcontractor")
        const sub = await supplier(subcontractorClient?.name ?? "UAB Pavyzdinis rangovas", ["buhalterija@rangovas.example"], "other", healthyP._id)
        const insurance = await supplier("Draudimas UADB (demo)", ["@draudimas-demo.example"], "other")
        let purchases = 0
        const purchase = async (p: {
          supplierId?: (typeof hotel) | undefined
          supplierName: string
          senderEmail: string
          number: string
          daysAgo: number
          netCents: number
          vatPct: number
          category: CostCategory
          projectId?: ProjectDoc["_id"] | undefined
          status: "review" | "pending" | "approved" | "rejected"
          subject: string
          forward?: "ready" | "sent"
          rejectReason?: string
          note?: string
        }) => {
          const vatCents = Math.round((p.netCents * p.vatPct) / 100)
          const issueDate = addDays(today, -p.daysAgo)
          purchases++
          await db.insert("staffing_invoicing_purchases", {
            ...(p.supplierId ? { supplierId: p.supplierId } : {}),
            supplierName: p.supplierName,
            senderEmail: p.senderEmail,
            number: p.number,
            issueDate,
            dueDate: addDays(issueDate, 14),
            netCents: p.netCents,
            vatCents,
            totalCents: p.netCents + vatCents,
            currency: "EUR",
            category: p.category,
            ...(p.projectId ? { projectId: p.projectId } : {}),
            status: p.status,
            source: "email",
            subject: p.subject,
            attachmentNames: [`${p.number.replace(/[^\w-]/g, "_")}.pdf`],
            ...(p.note ? { note: p.note } : {}),
            ...(p.status === "approved" || p.status === "rejected" ? { decidedBy: "seed", decidedAt: Date.parse(`${addDays(issueDate, 1)}T08:00:00Z`) } : {}),
            ...(p.rejectReason ? { rejectReason: p.rejectReason } : {}),
            forward: p.forward ?? "none",
            ...(p.forward === "sent" ? { forwardedTo: "importas@sitepro.example", forwardedAt: Date.parse(`${addDays(issueDate, 1)}T08:05:00Z`) } : {}),
            createdBy: "ingest",
            updatedAt: now,
          })
        }
        const hotelMail = "rechnung@hafenblick.example"
        await purchase({ supplierId: hotel, supplierName: "Hotel Hafenblick GmbH (demo)", senderEmail: hotelMail, number: "HB-2026-0912", daysAgo: 40, netCents: 3_480_00, vatPct: 0, category: "accommodation", projectId: poorP._id, status: "approved", forward: "sent", subject: "Rechnung HB-2026-0912 (Apartments, September)" })
        await purchase({ supplierId: hotel, supplierName: "Hotel Hafenblick GmbH (demo)", senderEmail: hotelMail, number: "HB-2026-1031", daysAgo: 10, netCents: 3_720_00, vatPct: 0, category: "accommodation", projectId: poorP._id, status: "approved", forward: "ready", subject: "Rechnung HB-2026-1031 (Apartments, Oktober)" })
        await purchase({ supplierId: hotel, supplierName: "Hotel Hafenblick GmbH (demo)", senderEmail: hotelMail, number: "HB-2026-1031", daysAgo: 9, netCents: 3_720_00, vatPct: 0, category: "accommodation", projectId: poorP._id, status: "rejected", rejectReason: "Dublikatas: ta pati sąskaita atsiųsta antrą kartą", subject: "Erinnerung: Rechnung HB-2026-1031" })
        await purchase({ supplierId: cars, supplierName: "UAB Autonuoma (demo)", senderEmail: "saskaitos@autonuoma.example", number: "AN-55821", daysAgo: 4, netCents: 1_850_00, vatPct: 21, category: "transport", projectId: healthyP._id, status: "pending", subject: "Sąskaita faktūra AN-55821 (mikroautobusas, spalis)" })
        await purchase({ supplierId: fuel, supplierName: "Degalų kortelės UAB (demo)", senderEmail: "e-saskaitos@degalai-demo.example", number: "DK-1029-447", daysAgo: 6, netCents: 642_18, vatPct: 21, category: "transport", status: "pending", subject: "Degalų kortelių sąskaita DK-1029-447", note: "Abu projektai: paskirstyti pagal automobilius" })
        await purchase({ supplierId: sub, supplierName: subcontractorClient?.name ?? "UAB Pavyzdinis rangovas", senderEmail: "buhalterija@rangovas.example", number: "PR-2026/118", daysAgo: 3, netCents: 4_200_00, vatPct: 21, category: "other", projectId: healthyP._id, status: "pending", subject: "Sąskaita PR-2026/118: papildomi pastolių darbai" })
        await purchase({ supplierId: insurance, supplierName: "Draudimas UADB (demo)", senderEmail: "info@draudimas-demo.example", number: "DR-77310", daysAgo: 25, netCents: 1_200_00, vatPct: 0, category: "other", status: "approved", forward: "sent", subject: "Darbuotojų nelaimingų atsitikimų draudimas, IV ketv." })
        await purchase({ supplierName: "Cheap Rooms Hamburg", senderEmail: "info@cheap-rooms.example", number: "CR-0042", daysAgo: 2, netCents: 980_00, vatPct: 0, category: "accommodation", status: "review", subject: "Invoice CR-0042 for your workers" })

        return { seeded: true, timesheetEntries: entries, approvedWeeks: weeks, clientSheets: sheets, corrections, wageRates, invoices, reminders, costs, purchases, forgotten: forgotten ? { clientId: forgotten.clientId, from: forgotten.period.from, to: forgotten.period.to, valueCents: forgotten.valueCents } : null }
      },
    }),
  }
}

