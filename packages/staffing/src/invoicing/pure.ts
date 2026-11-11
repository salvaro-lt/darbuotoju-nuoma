// Pure logic of the invoicing area (staffing-invoicing): billing periods,
// pricing of billable hours into invoice lines, totals, numbering, payment
// status, debt aging, reminder stages, profitability and the SitePro (B1) CSV.
// No Convex, no I/O: safe in the browser and in unit tests.
// Money: integer cents. Dates: `YYYY-MM-DD`. Hours: decimal numbers (7.5).
import { addDays, addMonths, daysBetween, type InvoicingPeriod } from "../pure"

export const INVOICE_STATUSES = ["draft", "approved", "sent", "partially_paid", "paid"] as const
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number]
/** Issued and not fully paid: these count as debt. */
export const OPEN_INVOICE_STATUSES: readonly InvoiceStatus[] = ["approved", "sent", "partially_paid"]

export const RATE_TYPES = ["regular", "overtime", "weekend"] as const
export type RateType = (typeof RATE_TYPES)[number]

export const HOURS_SOURCES = ["timesheets", "manual"] as const
export type HoursSource = (typeof HOURS_SOURCES)[number]

export const COST_CATEGORIES = ["wages", "accommodation", "transport", "ppe", "travel", "other"] as const
export type CostCategory = (typeof COST_CATEGORIES)[number]

export const REMINDER_STAGES = [1, 2] as const
export type ReminderStage = (typeof REMINDER_STAGES)[number]
/** Days after the due date when each reminder stage is due. */
export const REMINDER_STAGE_DAYS: Record<ReminderStage, number> = { 1: 3, 2: 14 }

/** Default surcharges, percent of the regular rate. Configurable per client and project. */
export const DEFAULT_OVERTIME_PCT = 125
export const DEFAULT_WEEKEND_PCT = 150

export const AGING_BUCKETS = ["current", "d0_30", "d31_60", "d60_plus"] as const
export type AgingBucket = (typeof AGING_BUCKETS)[number]

// ---------------------------------------------------------------- periods

const toUtc = (d: string) => Date.parse(`${d}T00:00:00Z`)

/** Monday of the ISO week of `date`. */
export function weekStart(date: string): string {
  const dow = (new Date(toUtc(date)).getUTCDay() + 6) % 7 // Monday 0 … Sunday 6
  return addDays(date, -dow)
}

/** Saturday or Sunday. */
export const isWeekend = (date: string): boolean => {
  const d = new Date(toUtc(date)).getUTCDay()
  return d === 0 || d === 6
}

/** Biweekly windows are anchored on this Monday, so every client's fortnights line up. */
const BIWEEKLY_ANCHOR = "2024-01-01"

export interface Period {
  from: string
  to: string
}

/** The billing period of the given kind that contains `date` (inclusive ends). */
export function billingPeriodOf(kind: InvoicingPeriod, date: string): Period {
  if (kind === "monthly") {
    const from = `${date.slice(0, 7)}-01`
    return { from, to: addDays(addMonths(from, 1), -1) }
  }
  const monday = weekStart(date)
  if (kind === "weekly") return { from: monday, to: addDays(monday, 6) }
  const weeks = Math.floor(daysBetween(BIWEEKLY_ANCHOR, monday) / 7)
  const from = weeks % 2 === 0 ? monday : addDays(monday, -7)
  return { from, to: addDays(from, 13) }
}

/**
 * The period to invoice next: the one right after the last invoiced period,
 * else the last period that ended before `today`.
 */
export function nextBillingPeriod(kind: InvoicingPeriod, lastInvoicedTo: string | null, today: string): Period {
  if (lastInvoicedTo) return billingPeriodOf(kind, addDays(lastInvoicedTo, 1))
  const current = billingPeriodOf(kind, today)
  return billingPeriodOf(kind, addDays(current.from, -1))
}

// ---------------------------------------------------------------- pricing

export interface BillableHoursRow {
  projectId: string
  tradeId: string
  regular: number
  overtime: number
  weekend: number
}

export interface RateTerms {
  /** Regular hourly sell rate in cents; null when neither project nor client has one. */
  rateCents: number | null
  overtimePct: number
  weekendPct: number
}

export interface InvoiceLineDraft {
  projectId: string
  tradeId: string
  rateType: RateType
  hours: number
  /** Percent of the regular rate (100, 125, 150). */
  multiplierPct: number
  unitPriceCents: number
  amountCents: number
}

/** Hours rounded to hundredths, so sums of 7.33 + 7.33 stay 14.66. */
export const roundHours = (h: number): number => Math.round(h * 100) / 100

/** Price of one hour of a rate type: regular rate × percent, rounded to the cent. */
export const unitPrice = (rateCents: number, pct: number): number => Math.round((rateCents * pct) / 100)

/**
 * Groups billable hours per project × trade and prices them: one line per
 * rate type with hours. Pairs without a sell rate are left out and reported
 * in `missingRates` (the director sets a rate, then regenerates the draft).
 */
export function priceHours(rows: readonly BillableHoursRow[], termsFor: (projectId: string, tradeId: string) => RateTerms): { lines: InvoiceLineDraft[]; missingRates: { projectId: string; tradeId: string; hours: number }[] } {
  const groups = new Map<string, { projectId: string; tradeId: string; regular: number; overtime: number; weekend: number }>()
  for (const r of rows) {
    const k = `${r.projectId}|${r.tradeId}`
    const g = groups.get(k) ?? { projectId: r.projectId, tradeId: r.tradeId, regular: 0, overtime: 0, weekend: 0 }
    g.regular += r.regular
    g.overtime += r.overtime
    g.weekend += r.weekend
    groups.set(k, g)
  }
  const lines: InvoiceLineDraft[] = []
  const missingRates: { projectId: string; tradeId: string; hours: number }[] = []
  for (const g of groups.values()) {
    const terms = termsFor(g.projectId, g.tradeId)
    const total = roundHours(g.regular + g.overtime + g.weekend)
    if (total <= 0) continue
    if (terms.rateCents === null) {
      missingRates.push({ projectId: g.projectId, tradeId: g.tradeId, hours: total })
      continue
    }
    const pct: Record<RateType, number> = { regular: 100, overtime: terms.overtimePct, weekend: terms.weekendPct }
    for (const rateType of RATE_TYPES) {
      const hours = roundHours(g[rateType])
      if (hours <= 0) continue
      const unitPriceCents = unitPrice(terms.rateCents, pct[rateType])
      lines.push({ projectId: g.projectId, tradeId: g.tradeId, rateType, hours, multiplierPct: pct[rateType], unitPriceCents, amountCents: Math.round(hours * unitPriceCents) })
    }
  }
  lines.sort((a, b) => a.projectId.localeCompare(b.projectId) || a.tradeId.localeCompare(b.tradeId) || RATE_TYPES.indexOf(a.rateType) - RATE_TYPES.indexOf(b.rateType))
  return { lines, missingRates }
}

/**
 * VAT for a staffing service sold by a Lithuanian company: 21 % to a
 * Lithuanian buyer; 0 % abroad (EU: reverse charge, outside the EU: not
 * taxable in LT). Simplified for the demo: the accountant confirms in B1.
 */
export function vatRateFor(buyerCountry: string, sellerCountry = "LT"): number {
  return buyerCountry.toUpperCase() === sellerCountry ? 21 : 0
}

export function invoiceTotals(lines: readonly { amountCents: number }[], vatRatePct: number): { subtotalCents: number; vatCents: number; totalCents: number } {
  const subtotalCents = lines.reduce((s, l) => s + l.amountCents, 0)
  const vatCents = Math.round((subtotalCents * vatRatePct) / 100)
  return { subtotalCents, vatCents, totalCents: subtotalCents + vatCents }
}

// ---------------------------------------------------------------- numbering, due dates, payments

/** `DN-2026-0001`. */
export const formatInvoiceNumber = (prefix: string, year: number, seq: number): string => `${prefix}-${year}-${String(seq).padStart(4, "0")}`

export const dueDateFor = (issueDate: string, paymentTermsDays: number): string => addDays(issueDate, paymentTermsDays)

/** Status after payments: `paid` once covered, `partially_paid` with some, else stays as issued. */
export function statusAfterPayments(issued: "approved" | "sent", totalCents: number, paidCents: number): InvoiceStatus {
  if (paidCents >= totalCents) return "paid"
  if (paidCents > 0) return "partially_paid"
  return issued
}

/** Days past the due date (0 or negative: not overdue yet). */
export const daysOverdue = (dueDate: string, today: string): number => daysBetween(dueDate, today)

export function agingBucket(dueDate: string, today: string): AgingBucket {
  const d = daysOverdue(dueDate, today)
  if (d <= 0) return "current"
  if (d <= 30) return "d0_30"
  if (d <= 60) return "d31_60"
  return "d60_plus"
}

/**
 * The reminder stage due now for an overdue invoice, or null: stage 1 from
 * +3 days, stage 2 from +14 days; each stage is sent once. A late first run
 * (e.g. +20 days, nothing sent) sends stage 2 only.
 */
export function dueReminderStage(overdueDays: number, sentStages: readonly number[]): ReminderStage | null {
  if (overdueDays >= REMINDER_STAGE_DAYS[2]) return sentStages.includes(2) ? null : 2
  if (overdueDays >= REMINDER_STAGE_DAYS[1]) return sentStages.includes(1) ? null : 1
  return null
}

/** Stage for a manual reminder: by how late the payment is. */
export const manualReminderStage = (overdueDays: number): ReminderStage => (overdueDays >= REMINDER_STAGE_DAYS[2] ? 2 : 1)

// ---------------------------------------------------------------- profitability

export interface WeekPoint {
  week: string
  revenueCents: number
  costCents: number
}

/** Sums dated amounts per ISO week (Monday), filling empty weeks between the first and last. */
export function weeklySeries(revenue: readonly { date: string; cents: number }[], costs: readonly { date: string; cents: number }[]): WeekPoint[] {
  const map = new Map<string, WeekPoint>()
  const at = (date: string) => {
    const week = weekStart(date)
    let p = map.get(week)
    if (!p) map.set(week, (p = { week, revenueCents: 0, costCents: 0 }))
    return p
  }
  for (const r of revenue) at(r.date).revenueCents += r.cents
  for (const c of costs) at(c.date).costCents += c.cents
  const weeks = [...map.keys()].sort()
  if (!weeks.length) return []
  const out: WeekPoint[] = []
  for (let w = weeks[0]!; w <= weeks.at(-1)!; w = addDays(w, 7)) out.push(map.get(w) ?? { week: w, revenueCents: 0, costCents: 0 })
  return out
}

/** Margin percent with one decimal; null without revenue. */
export function marginPct(revenueCents: number, costCents: number): number | null {
  if (revenueCents <= 0) return null
  return Math.round(((revenueCents - costCents) / revenueCents) * 1000) / 10
}

// ---------------------------------------------------------------- SitePro / B1 export

/**
 * Columns of the SitePro (B1) import file. The exact SitePro import format is
 * not known yet: this is a generic, one-row-per-line layout (semicolon
 * separated, decimal comma, UTF-8 with BOM) that maps onto B1's sales invoice
 * import. Adjust here once the accountant provides a sample.
 */
export const SITEPRO_COLUMNS = [
  "Dokumento tipas",
  "Serija",
  "Numeris",
  "Išrašymo data",
  "Apmokėti iki",
  "Pirkėjo kodas",
  "Pirkėjas",
  "Pirkėjo PVM kodas",
  "Pirkėjo šalis",
  "Projektas",
  "Paslaugos kodas",
  "Paslaugos pavadinimas",
  "Mato vnt.",
  "Kiekis",
  "Kaina be PVM",
  "Suma be PVM",
  "PVM tarifas %",
  "PVM suma",
  "Suma su PVM",
  "Valiuta",
  "Laikotarpis",
] as const

export interface SiteProInvoice {
  number: string
  issueDate: string
  dueDate: string
  currency: string
  vatRatePct: number
  periodFrom: string
  periodTo: string
  client: { code: string; name: string; vatCode: string | null; country: string }
  lines: { projectCode: string; serviceCode: string; serviceName: string; hours: number; unitPriceCents: number; amountCents: number }[]
}

const money = (cents: number) => (cents / 100).toFixed(2).replace(".", ",")
const qty = (h: number) => String(roundHours(h)).replace(".", ",")
const cell = (v: string) => (/[;"\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)

/** CSV text (no BOM; the download adds it) for one or many invoices. */
export function siteProCsv(invoices: readonly SiteProInvoice[]): string {
  const rows: string[][] = [[...SITEPRO_COLUMNS]]
  for (const inv of invoices) {
    const [series, ...rest] = inv.number.split("-")
    for (const l of inv.lines) {
      const vat = Math.round((l.amountCents * inv.vatRatePct) / 100)
      rows.push([
        "PVM sąskaita faktūra",
        series ?? "",
        rest.join("-"),
        inv.issueDate,
        inv.dueDate,
        inv.client.code,
        inv.client.name,
        inv.client.vatCode ?? "",
        inv.client.country,
        l.projectCode,
        l.serviceCode,
        l.serviceName,
        "val.",
        qty(l.hours),
        money(l.unitPriceCents),
        money(l.amountCents),
        String(inv.vatRatePct),
        money(vat),
        money(l.amountCents + vat),
        inv.currency,
        `${inv.periodFrom}–${inv.periodTo}`,
      ])
    }
  }
  return rows.map((r) => r.map(cell).join(";")).join("\r\n") + "\r\n"
}

// ---------------------------------------------------------------- billing periods of a client

/** Every billing period of the kind from the one containing `from` to the one containing `to`, oldest first. */
export function billingPeriodsBetween(kind: InvoicingPeriod, from: string, to: string): Period[] {
  const out: Period[] = []
  for (let p = billingPeriodOf(kind, from); p.from <= to; p = billingPeriodOf(kind, addDays(p.to, 1))) out.push(p)
  return out
}

// ---------------------------------------------------------------- the closed process ("uždarytas procesas")

/**
 * The chain every client billing period has to go through before it is
 * closed. It broke once after the timesheet (a €40,000 invoice was noticed
 * three months later): the chain page shows where each period stands.
 */
export const CHAIN_STEPS = ["hours", "weekApproved", "clientSheet", "reconciled", "drafted", "approved", "sent", "paid"] as const
export type ChainStep = (typeof CHAIN_STEPS)[number]
/** `partial`: some weeks / days / payments only. `na`: nothing to do (no hours in the period). */
export type StepState = "done" | "partial" | "missing" | "na"

/** Days after the period end before a missing invoice raises an alert (configurable per app). */
export const DEFAULT_MISSING_INVOICE_ALERT_DAYS = 7

export interface ChainFacts {
  period: Period
  today: string
  /** Distinct days with recorded hours (timesheets entries or manual corrections). */
  daysWithHours: number
  /** Weeks (Mondays) of the period with recorded hours, and how many of them are approved. */
  weeksWithHours: number
  weeksApproved: number
  /** Days with hours that a received client timesheet covers. */
  daysCovered: number
  /** Client timesheets overlapping the period, and their unresolved mismatches. */
  sheets: number
  openMismatches: number
  /** The client's invoice for the period (the most advanced one when several overlap). */
  invoice: { status: InvoiceStatus; sent: boolean } | null
  /** Value of approved hours at the sell rates, and the invoiced (issued, not draft) amount without VAT. */
  approvedValueCents: number
  invoicedCents: number
}

export interface ChainResult {
  steps: Record<ChainStep, StepState>
  /** First step that is not done; null when the period is closed or empty. */
  brokenAt: ChainStep | null
  closed: boolean
  /** No hours and no invoice: nothing to bill. */
  empty: boolean
  ended: boolean
  /** Days since the period's last day (0 or negative while it runs). */
  daysSinceEnd: number
  /** Value of approved hours not covered by an issued invoice. */
  atRiskCents: number
  /** The period ended more than `alertAfterDays` ago and has billable hours but no issued invoice. */
  alert: boolean
}

const ratio = (done: number, of: number): StepState => (of <= 0 ? "na" : done >= of ? "done" : done > 0 ? "partial" : "missing")

/** Pure: the chain state of one client billing period. */
export function chainStatus(f: ChainFacts, alertAfterDays = DEFAULT_MISSING_INVOICE_ALERT_DAYS): ChainResult {
  const daysSinceEnd = daysBetween(f.period.to, f.today)
  const ended = daysSinceEnd > 0
  const inv = f.invoice
  const issued = !!inv && inv.status !== "draft"
  const sent = !!inv && (inv.sent || inv.status === "sent" || inv.status === "partially_paid" || inv.status === "paid")
  const empty = f.daysWithHours === 0 && !inv
  const steps: Record<ChainStep, StepState> = {
    hours: f.daysWithHours > 0 ? "done" : "na",
    weekApproved: ratio(f.weeksApproved, f.weeksWithHours),
    clientSheet: ratio(f.daysCovered, f.daysWithHours),
    reconciled: f.daysWithHours <= 0 ? "na" : f.sheets === 0 ? "missing" : f.openMismatches > 0 ? "partial" : f.daysCovered >= f.daysWithHours ? "done" : "partial",
    drafted: inv ? "done" : "missing",
    approved: issued ? "done" : "missing",
    sent: sent ? "done" : "missing",
    paid: inv?.status === "paid" ? "done" : inv?.status === "partially_paid" ? "partial" : "missing",
  }
  if (empty) for (const s of CHAIN_STEPS) steps[s] = "na"
  const brokenAt = empty ? null : (CHAIN_STEPS.find((s) => steps[s] !== "done" && steps[s] !== "na") ?? null)
  const atRiskCents = issued ? Math.max(0, f.approvedValueCents - f.invoicedCents) : f.approvedValueCents
  const alert = ended && daysSinceEnd > alertAfterDays && !issued && f.daysWithHours > 0
  return { steps, brokenAt, closed: !empty && brokenAt === null, empty, ended, daysSinceEnd, atRiskCents, alert }
}

// ---------------------------------------------------------------- wage cost and profitability per worker

/**
 * Default hourly cost (employer's cost, cents) per trade, used when a worker
 * has no own wage rate. Demo values; the director sets real rates per worker.
 */
export const DEFAULT_WAGE_CENTS_BY_TRADE: Readonly<Record<string, number>> = {
  "WELD-MAG": 2600,
  "WELD-TIG": 2800,
  "WELD-MMA": 2550,
  "WELD-ALU": 2900,
  "SHIP-FIT": 2500,
  "PIPE-FIT": 2550,
  "STEEL-ERECT": 2400,
  FITTER: 2300,
  GRINDER: 2000,
  "BLAST-PAINT": 2150,
  ELEC: 2700,
  RIGGER: 2250,
  CRANE: 2450,
  SCAFF: 2100,
  FOREMAN: 3100,
}
export const FALLBACK_WAGE_CENTS = 2400
/** What the company pays for overtime and weekend hours, percent of the hourly cost (LT labour code: ×1.5, ×2). */
export const WAGE_OVERTIME_PCT = 150
export const WAGE_WEEKEND_PCT = 200

export const defaultWageCents = (tradeCode: string | null | undefined): number => (tradeCode ? DEFAULT_WAGE_CENTS_BY_TRADE[tradeCode] : undefined) ?? FALLBACK_WAGE_CENTS

/** Wage cost of a day's hours at an hourly cost. */
export function wageCostCents(h: { regular: number; overtime: number; weekend: number }, hourlyCents: number): number {
  return Math.round(h.regular * hourlyCents + (h.overtime * hourlyCents * WAGE_OVERTIME_PCT) / 100 + (h.weekend * hourlyCents * WAGE_WEEKEND_PCT) / 100)
}

/** Splits `totalCents` by weights (largest remainder: the parts add up exactly). Zero weights get nothing. */
export function allocateCents<K>(totalCents: number, weights: ReadonlyMap<K, number>): Map<K, number> {
  const out = new Map<K, number>()
  const sum = [...weights.values()].reduce((s, w) => s + Math.max(0, w), 0)
  if (sum <= 0 || totalCents === 0) {
    for (const k of weights.keys()) out.set(k, 0)
    return out
  }
  const parts = [...weights.entries()].map(([k, w]) => {
    const exact = (totalCents * Math.max(0, w)) / sum
    return { k, cents: Math.floor(exact), rest: exact - Math.floor(exact) }
  })
  let left = totalCents - parts.reduce((s, p) => s + p.cents, 0)
  for (const p of [...parts].sort((a, b) => b.rest - a.rest)) {
    if (left <= 0) break
    p.cents++
    left--
  }
  for (const p of parts) out.set(p.k, p.cents)
  return out
}

/** One worker-day on one project with its billed value and wage cost (cents). */
export interface WorkerDayValue {
  workerId: string
  projectId: string
  date: string
  hours: number
  valueCents: number
  wageCents: number
}

export interface WorkerProfit {
  workerId: string
  days: number
  hours: number
  billedCents: number
  wageCents: number
  /** Housing, transport and other project costs allocated by the days worked on each project. */
  overheadCents: number
  marginCents: number
  marginPct: number | null
  projectIds: string[]
}

/**
 * Pure: profitability per worker = billed value − wage cost − the worker's
 * share of each project's non-wage costs (accommodation, transport, per diems,
 * approved purchase invoices…), shared out by days worked on the project.
 * Sorted by margin, worst first.
 */
export function workerProfitability(days: readonly WorkerDayValue[], projectOverheadCents: ReadonlyMap<string, number>): WorkerProfit[] {
  const rows = new Map<string, WorkerProfit>()
  const seen = new Set<string>()
  const daysPerProject = new Map<string, Map<string, number>>()
  for (const d of days) {
    let r = rows.get(d.workerId)
    if (!r) rows.set(d.workerId, (r = { workerId: d.workerId, days: 0, hours: 0, billedCents: 0, wageCents: 0, overheadCents: 0, marginCents: 0, marginPct: null, projectIds: [] }))
    const key = `${d.workerId}|${d.projectId}|${d.date}`
    if (!seen.has(key)) {
      seen.add(key)
      r.days++
      const m = daysPerProject.get(d.projectId) ?? new Map<string, number>()
      m.set(d.workerId, (m.get(d.workerId) ?? 0) + 1)
      daysPerProject.set(d.projectId, m)
    }
    r.hours += d.hours
    r.billedCents += d.valueCents
    r.wageCents += d.wageCents
    if (!r.projectIds.includes(d.projectId)) r.projectIds.push(d.projectId)
  }
  for (const [projectId, weights] of daysPerProject) {
    for (const [workerId, cents] of allocateCents(projectOverheadCents.get(projectId) ?? 0, weights)) rows.get(workerId)!.overheadCents += cents
  }
  const out: WorkerProfit[] = []
  for (const r of rows.values()) {
    const marginCents = r.billedCents - r.wageCents - r.overheadCents
    out.push({ ...r, hours: roundHours(r.hours), marginCents, marginPct: marginPct(r.billedCents, r.wageCents + r.overheadCents) })
  }
  return out.sort((a, b) => (a.marginPct ?? 999) - (b.marginPct ?? 999))
}

// ---------------------------------------------------------------- purchase invoices

export const PURCHASE_STATUSES = ["review", "pending", "approved", "rejected"] as const
/** `review`: unknown sender, someone must look first. `pending`: known supplier, waits for the director. */
export type PurchaseStatus = (typeof PURCHASE_STATUSES)[number]
export const PURCHASE_SOURCES = ["email", "upload"] as const
export type PurchaseSource = (typeof PURCHASE_SOURCES)[number]
/** Forwarding to the SitePro import address after approval. `ready`: approved, but the address or n8n is not configured ("paruošta persiųsti"). */
export const FORWARD_STATUSES = ["none", "ready", "queued", "sent", "failed"] as const
export type ForwardStatus = (typeof FORWARD_STATUSES)[number]

/** Lower-cased bare address from `Name <a@b.lt>` or `a@b.lt`. */
export function emailAddressOf(from: string): string {
  const m = from.match(/<([^>]+)>/)
  return (m ? m[1]! : from).trim().toLowerCase()
}

/**
 * The known supplier a sender belongs to: an exact address, or a domain
 * written as `@domain.lt` in the supplier's list. Null: unknown sender.
 */
export function matchSupplier<S extends { emails: readonly string[]; active: boolean }>(from: string, suppliers: readonly S[]): S | null {
  const address = emailAddressOf(from)
  const domain = address.split("@")[1] ?? ""
  const active = suppliers.filter((s) => s.active)
  return active.find((s) => s.emails.some((e) => e.toLowerCase() === address)) ?? active.find((s) => s.emails.some((e) => e.startsWith("@") && e.slice(1).toLowerCase() === domain)) ?? null
}

/** "1 234,56" / "1,234.56" / "1234.5" → cents; null when not a number. */
export function parseMoneyCents(text: string): number | null {
  let s = text.replace(/[\s\u00a0€]|EUR/gi, "")
  if (!/^\d[\d.,]*$/.test(s)) return null
  const lastSep = Math.max(s.lastIndexOf(","), s.lastIndexOf("."))
  if (lastSep >= 0 && s.length - lastSep - 1 <= 2) s = `${s.slice(0, lastSep).replace(/[.,]/g, "")}.${s.slice(lastSep + 1)}`
  else s = s.replace(/[.,]/g, "")
  const n = Number(s)
  return Number.isFinite(n) ? Math.round(n * 100) : null
}

/**
 * Best-effort reading of a supplier's e-mail: invoice number, total ("Suma",
 * "Iš viso", "Total", "Amount due"…) and the date. Anything not found stays
 * null and the director fills it in before approving.
 */
export function parseInvoiceEmail(subject: string, text: string): { number: string | null; totalCents: number | null; issueDate: string | null } {
  const all = `${subject}\n${text}`
  const num = all.match(/(?:invoice|factuur|rechnung|faktura|fakt[uū]ra|nr\.|no\.|#)\s*(?:nr\.?|no\.?|#|:)?\s*([A-Z]{0,6}[-/]?\d[\w\-/]{1,})/i)
  const total = all.match(/(?:i[sš]\s*viso|mok[eė]ti|suma|total|amount(?:\s+due)?|totaal|gesamt|betrag)[^\d\n]{0,25}(\d[\d\s.,\u00a0]*\d)/i)
  const date = all.match(/\b(20\d\d)[-.](\d\d)[-.](\d\d)\b/)
  return {
    number: num ? num[1]!.trim() : null,
    totalCents: total ? parseMoneyCents(total[1]!) : null,
    issueDate: date ? `${date[1]}-${date[2]}-${date[3]}` : null,
  }
}
