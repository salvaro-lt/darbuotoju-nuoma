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
