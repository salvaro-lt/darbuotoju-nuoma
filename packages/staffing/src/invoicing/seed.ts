// Demo data of the invoicing area, on top of `staffing:_seedDemo`:
//   npx convex run invoicing:_seedDemo            (skips when invoices exist)
//   npx convex run invoicing:_seedDemo '{"reset":true}'
// Billable hours from each active project's start (up to 18 weeks), invoices
// per client period in every state (two overdue with reminder history), and
// project costs so that one project earns a healthy margin and one barely
// breaks even. Refuses when APP_ENV is production or unset.
import { internalMutationGeneric } from "convex/server"
import { v } from "convex/values"
import { addDays, rangeCovers, todayIso } from "../pure"
import type { ProjectDoc } from "../shared"
import { allocateInvoiceNumber, billableHours, buildDraft, hoursValueCents, invWriter, rateTermsResolver } from "./operations"
import { billingPeriodOf, dueDateFor, isWeekend, REMINDER_STAGE_DAYS, weekStart, type CostCategory, type ReminderStage } from "./pure"
import type { InvoicingTableName } from "./tables"

const TABLES: InvoicingTableName[] = ["staffing_invoicing_reminders", "staffing_invoicing_payments", "staffing_invoicing_invoices", "staffing_invoicing_counters", "staffing_invoicing_costs", "staffing_invoicing_hours", "staffing_invoicing_terms"]
const MAX_WEEKS = 18
type SeedState = "draft" | "approved" | "sent" | "partially_paid" | "overdue" | "paid"

/** Cost profile per project, as shares of the weekly value of hours (wages, accommodation, per diems) plus one-offs. */
interface CostProfile {
  wagesPct: number
  accommodationPct: number
  travelPct: number
  transportPerTrip: number
  ppePerWorker: number
}
const HEALTHY: CostProfile = { wagesPct: 56, accommodationPct: 7, travelPct: 4, transportPerTrip: 180_00, ppePerWorker: 95_00 }
const POOR: CostProfile = { wagesPct: 67, accommodationPct: 17, travelPct: 7, transportPerTrip: 240_00, ppePerWorker: 110_00 }

export function defineInvoicingSeed(prefix: string) {
  return {
    /** Dev only: demo hours, invoices, payments, reminders and costs (needs `staffing:_seedDemo` first). */
    _seedDemo: internalMutationGeneric({
      args: { reset: v.optional(v.boolean()) },
      handler: async (ctx, a) => {
        const env = process.env.APP_ENV
        if (!env || env === "production") throw new Error(`invoicing:_seedDemo refuses to run with APP_ENV=${env ?? "(unset)"}`)
        const db = invWriter(ctx)
        if (a.reset) {
          for (const t of TABLES) for (const row of await db.query(t).collect()) await db.delete(t, row._id as never)
        } else if (await db.query("staffing_invoicing_invoices").first()) {
          return { seeded: false }
        }
        const today = todayIso()
        const yesterday = addDays(today, -1)
        const projects = (await db.query("staffing_projects").collect()).filter((p) => p.status === "active").sort((x, y) => x.startDate.localeCompare(y.startDate))
        if (!projects.length) throw new Error("No active projects: run `npx convex run staffing:_seedDemo` first")

        // ---- surcharges: the longest-running client pays a lower overtime surcharge (agreed 120 %).
        await db.insert("staffing_invoicing_terms", { clientId: projects[0]!.clientId, overtimePct: 120, weekendPct: 150, updatedAt: Date.now() })

        // ---- billable hours from the assignments (source "timesheets": what the timesheets area will provide).
        let hours = 0
        for (const [pi, p] of projects.entries()) {
          const from = [p.startDate, addDays(today, -7 * MAX_WEEKS)].sort().at(-1)!
          const team = await db
            .query("staffing_assignments")
            .withIndex("by_project", (i) => i.eq("projectId", p._id))
            .collect()
          for (const [ai, as] of team.entries()) {
            if (as.status === "cancelled" || as.status === "proposed") continue
            for (let d = from, n = 0; d <= yesterday; d = addDays(d, 1), n++) {
              if (!rangeCovers(as, d) || d < from) continue
              const dow = new Date(`${d}T00:00:00Z`).getUTCDay()
              let regular = 0
              let overtime = 0
              let weekend = 0
              if (isWeekend(d)) {
                // Shipyard teams often work Saturdays; nobody works Sundays.
                if (dow === 6 && (pi + ai + n) % 3 === 0) weekend = 6
              } else {
                regular = 8
                if ((dow === 2 || dow === 4) && (ai + pi) % 2 === 0) overtime = 2
                if ((ai * 7 + n) % 23 === 0) regular = 0 // a sick day now and then
              }
              if (!regular && !overtime && !weekend) continue
              await db.insert("staffing_invoicing_hours", { projectId: p._id, workerId: as.workerId, tradeId: as.tradeId, date: d, regular, overtime, weekend, source: "timesheets", createdBy: "seed" })
              hours++
            }
          }
        }

        // ---- invoices per client, period by period. Newest: draft; then sent (not due); then partially paid
        // and overdue; then sent and long overdue; older: paid. Short-term clients: approved, then paid.
        // Dates are relative to today.
        const clientIds = [...new Set(projects.map((p) => p.clientId))]
        let invoices = 0
        let reminders = 0
        for (const clientId of clientIds) {
          const client = (await db.get("staffing_clients", clientId))!
          const firstStart = projects.filter((p) => p.clientId === clientId).map((p) => p.startDate).sort()[0]!
          const periods: { from: string; to: string }[] = []
          for (let pr = billingPeriodOf(client.invoicingPeriod, [firstStart, addDays(today, -7 * MAX_WEEKS)].sort().at(-1)!); pr.to < today; pr = billingPeriodOf(client.invoicingPeriod, addDays(pr.to, 1))) periods.push(pr)
          const newestFirst = [...periods].reverse()
          // Long payment terms (monthly clients) give overdue invoices; short histories pay on time.
          const plan: SeedState[] = client.paymentTermsDays >= 40 ? ["draft", "sent", "partially_paid", "overdue"] : ["approved", "paid"]
          const chronological = newestFirst.map((pr, i) => ({ pr, state: plan[i] ?? ("paid" as SeedState) })).reverse()
          for (const { pr, state } of chronological) {
            const draft = await buildDraft(ctx, client, pr.from, pr.to)
            if (!draft.lines.length) continue
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
              updatedAt: Date.now(),
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
            // Reminder history: the long-overdue invoice got both stages; the partially paid one stage 1
            // only, so stage 2 is due now (the "send reminders" button / daily job sends it).
            const late = Math.round((Date.parse(today) - Date.parse(dueDate)) / 86_400_000)
            const history: ReminderStage[] = state === "overdue" ? [1, 2] : [1]
            for (const stage of history) {
              if (late < REMINDER_STAGE_DAYS[stage]) continue
              const at = Date.parse(`${addDays(dueDate, REMINDER_STAGE_DAYS[stage])}T07:00:00Z`)
              await db.insert("staffing_invoicing_reminders", { invoiceId: id, stage, daysOverdue: REMINDER_STAGE_DAYS[stage], trigger: "cron", status: "sent", to: client.contacts.find((c) => c.email)?.email, createdBy: "seed", completedAt: at })
              reminders++
            }
          }
        }

        // ---- project costs: weekly wages, accommodation and per diems as shares of the value of the hours;
        // one-off transport and workwear per worker. The newest project is the healthy one, the long-running
        // one the poor one (high accommodation in Hamburg, lower surcharge).
        let costs = 0
        const add = async (p: ProjectDoc, category: CostCategory, date: string, amountCents: number, note: string) => {
          if (amountCents <= 0) return
          await db.insert("staffing_invoicing_costs", { projectId: p._id, category, date, amountCents, note, createdBy: "seed" })
          costs++
        }
        for (const p of projects) {
          const profile = p === projects[0] && projects.length > 1 ? POOR : HEALTHY
          const client = (await db.get("staffing_clients", p.clientId))!
          const termsFor = await rateTermsResolver(ctx, client, [p])
          const rows = await billableHours(ctx, { projectId: p._id, from: "0000-01-01", to: today })
          const weekly = new Map<string, number>()
          for (const h of rows) weekly.set(weekStart(h.date), (weekly.get(weekStart(h.date)) ?? 0) + hoursValueCents(h, termsFor(h.projectId, h.tradeId)))
          for (const [week, value] of [...weekly.entries()].sort()) {
            const friday = addDays(week, 4)
            await add(p, "wages", friday, Math.round((value * profile.wagesPct) / 100), "Darbo užmokestis ir mokesčiai (savaitė)")
            await add(p, "accommodation", friday, Math.round((value * profile.accommodationPct) / 100), "Apgyvendinimas")
            await add(p, "travel", friday, Math.round((value * profile.travelPct) / 100), "Dienpinigiai")
          }
          const workers = new Set(rows.map((r) => r.workerId)).size
          await add(p, "transport", p.startDate, profile.transportPerTrip * workers, "Kelionė į objektą (mikroautobusas, keltas)")
          await add(p, "ppe", addDays(p.startDate, -2), profile.ppePerWorker * workers, "Darbo drabužiai ir AAP")
          if (profile === POOR) await add(p, "other", addDays(today, -20), 1450_00, "Kliento atmesto darbo perdarymas")
        }

        return { seeded: true, hours, invoices, reminders, costs }
      },
    }),
  }
}
