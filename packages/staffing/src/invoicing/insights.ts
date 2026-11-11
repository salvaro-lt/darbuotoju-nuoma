// Read models of the invoicing area that join hours, rates, costs and
// invoices: profitability per project, client and worker, and the "closed
// process" chain per client billing period. Like operations.ts they take any
// ctx with `db` and do NOT check permissions: guard first.
import { addDays, addMonths, todayIso } from "../pure"
import type { ClientDoc, DbCtxLike, ProjectDoc, ProjectId, WorkerDoc } from "../shared"
import { reconcile, weekStartOf } from "../timesheets/pure"
import { housingCostsByProject } from "../logistics/housing-data"
import { billableHours, hoursValueCents, invReader, rateTermsResolver, type BillableHours, type InvoiceDoc } from "./operations"
import {
  allocateCents,
  billingPeriodsBetween,
  chainStatus,
  COST_CATEGORIES,
  defaultWageCents,
  INVOICE_STATUSES,
  marginPct,
  wageCostCents,
  weeklySeries,
  workerProfitability,
  type ChainResult,
  type CostCategory,
  type InvoiceStatus,
  type WeekPoint,
} from "./pure"

export interface Range {
  from: string
  to: string
}

const ALL: Range = { from: "0000-01-01", to: "9999-12-31" }
const inRange = (d: string, r: Range) => d >= r.from && d <= r.to

// ---------------------------------------------------------------- wage rates

/** Hourly cost per worker: the worker's own rate, else the trade's default. */
export async function wageRates(ctx: DbCtxLike): Promise<{ rateFor: (workerId: string, tradeId: string) => number; own: Map<string, number>; tradeCode: Map<string, string> }> {
  const db = invReader(ctx)
  const own = new Map<string, number>()
  for (const r of await db.query("staffing_invoicing_wageRates").collect()) own.set(r.workerId, r.hourlyCostCents)
  const tradeCode = new Map<string, string>()
  for (const t of await db.query("staffing_trades").collect()) tradeCode.set(t._id, t.code)
  return { own, tradeCode, rateFor: (workerId, tradeId) => own.get(workerId) ?? defaultWageCents(tradeCode.get(tradeId)) }
}

// ---------------------------------------------------------------- profitability

export interface ProfitRow {
  projectId: ProjectId
  code: string
  name: string
  clientId: string
  clientName: string
  status: string
  hours: number
  invoicedCents: number
  paidCents: number
  /** Value of the billable hours at the sell rates (earned revenue). */
  earnedCents: number
  /** Wages (hours × the workers' hourly cost) + project costs + approved purchase invoices. */
  costCents: number
  wageCents: number
  otherCostCents: number
  purchaseCents: number
  marginCents: number
  marginPct: number | null
  uninvoicedCents: number
}

export interface ProfitData {
  rows: ProfitRow[]
  series: Map<string, WeekPoint[]>
  /** Every billable worker-day (for the worker view). */
  days: { workerId: string; projectId: string; tradeId: string; date: string; hours: number; valueCents: number; wageCents: number }[]
  /** Non-wage costs per project (project costs + approved purchase invoices). */
  overheadByProject: Map<string, number>
  /** Approved purchase invoices without a project (general overhead). */
  generalOverheadCents: number
  clients: Map<string, ClientDoc>
  costsByCategory: Map<string, Record<CostCategory, number>>
}

const emptyCategories = () => Object.fromEntries(COST_CATEGORIES.map((c) => [c, 0])) as Record<CostCategory, number>

/**
 * Revenue (value of billable hours), wages, costs and margin per project in
 * the range (dates of hours, costs and purchase invoices; invoices by their
 * period end).
 */
export async function profitData(ctx: DbCtxLike, range: Range = ALL, projectFilter?: ProjectId): Promise<ProfitData> {
  const db = invReader(ctx)
  const projects = projectFilter ? [await db.get("staffing_projects", projectFilter)].filter((p): p is ProjectDoc => p !== null) : await db.query("staffing_projects").collect()
  const invoices = (await db.query("staffing_invoicing_invoices").collect()).filter((i) => i.status !== "draft" && inRange(i.periodTo, range))
  const purchases = (
    await db
      .query("staffing_invoicing_purchases")
      .withIndex("by_status", (i) => i.eq("status", "approved").gte("issueDate", range.from).lte("issueDate", range.to))
      .collect()
  ).filter((p) => !projectFilter || p.projectId === projectFilter)
  const { rateFor } = await wageRates(ctx)
  // Housing pool and fleet (logistics): each project's share of flat rent (empty beds included) and vehicles.
  // Bounded to the last 12 months up to today: the split walks day by day.
  const today = todayIso()
  const hFrom = range.from > addMonths(today, -12) ? range.from : addMonths(today, -12)
  const hTo = range.to < today ? range.to : today
  const housing = new Map<string, { accommodationCents: number; vehicleCents: number }>()
  if (hFrom <= hTo) for (const r of (await housingCostsByProject(ctx, { from: hFrom, to: hTo })).projects) housing.set(r.projectId, r)
  const clients = new Map<string, ClientDoc>()
  const out: ProfitData = { rows: [], series: new Map(), days: [], overheadByProject: new Map(), generalOverheadCents: 0, clients, costsByCategory: new Map() }
  for (const p of purchases) if (!p.projectId) out.generalOverheadCents += p.netCents
  for (const p of projects) {
    if (p.status === "cancelled") continue
    if (!clients.has(p.clientId)) {
      const c = await db.get("staffing_clients", p.clientId)
      if (c) clients.set(c._id, c)
    }
    const client = clients.get(p.clientId)
    if (!client) continue
    const hours = await billableHours(ctx, { projectId: p._id, ...range })
    const termsFor = await rateTermsResolver(ctx, client, [p])
    const cats = emptyCategories()
    const revenue: { date: string; cents: number }[] = []
    const dayCosts: { date: string; cents: number }[] = []
    let earnedCents = 0
    let wageCents = 0
    let hoursTotal = 0
    for (const h of hours) {
      const valueCents = hoursValueCents(h, termsFor(h.projectId, h.tradeId))
      const wage = wageCostCents(h, rateFor(h.workerId, h.tradeId))
      const total = h.regular + h.overtime + h.weekend
      earnedCents += valueCents
      wageCents += wage
      hoursTotal += total
      revenue.push({ date: h.date, cents: valueCents })
      dayCosts.push({ date: h.date, cents: wage })
      out.days.push({ workerId: h.workerId, projectId: p._id, tradeId: h.tradeId, date: h.date, hours: total, valueCents, wageCents: wage })
    }
    cats.wages += wageCents
    const costs = await db
      .query("staffing_invoicing_costs")
      .withIndex("by_project_date", (i) => i.eq("projectId", p._id).gte("date", range.from).lte("date", range.to))
      .collect()
    let otherCostCents = 0
    for (const c of costs) {
      otherCostCents += c.amountCents
      cats[c.category] += c.amountCents
      dayCosts.push({ date: c.date, cents: c.amountCents })
    }
    let purchaseCents = 0
    for (const pi of purchases) {
      if (pi.projectId !== p._id) continue
      purchaseCents += pi.netCents
      cats[pi.category] += pi.netCents
      dayCosts.push({ date: pi.issueDate, cents: pi.netCents })
    }
    // Pool housing / fleet costs, unless the project already books that category by hand (no double counting).
    const pool = housing.get(p._id)
    let poolCents = 0
    if (pool) {
      const booked = (cat: string) => costs.some((c) => c.category === cat) || purchases.some((pi) => pi.projectId === p._id && pi.category === cat)
      if (!booked("accommodation") && pool.accommodationCents > 0) {
        poolCents += pool.accommodationCents
        cats.accommodation += pool.accommodationCents
      }
      if (!booked("transport") && pool.vehicleCents > 0) {
        poolCents += pool.vehicleCents
        cats.transport += pool.vehicleCents
      }
    }
    let invoicedCents = 0
    let paidCents = 0
    for (const inv of invoices) {
      if (!inv.projectIds.includes(p._id)) continue
      const part = inv.lines.filter((l) => l.projectId === p._id).reduce((s, l) => s + l.amountCents, 0)
      invoicedCents += part
      // Payments are per invoice: split them over projects pro rata.
      if (inv.subtotalCents > 0) paidCents += Math.round((inv.paidCents * part) / (inv.totalCents || 1))
    }
    const costCents = wageCents + otherCostCents + purchaseCents + poolCents
    out.overheadByProject.set(p._id, otherCostCents + purchaseCents + poolCents)
    out.costsByCategory.set(p._id, cats)
    // Margin on the value of the work done (billable hours × the same rates the invoices use), so revenue
    // and costs cover the same days; it equals invoiced revenue once every period is invoiced.
    out.rows.push({
      projectId: p._id,
      code: p.code,
      name: p.name,
      clientId: client._id,
      clientName: client.name,
      status: p.status,
      hours: Math.round(hoursTotal * 100) / 100,
      invoicedCents,
      paidCents,
      earnedCents,
      costCents,
      wageCents,
      otherCostCents,
      purchaseCents,
      marginCents: earnedCents - costCents,
      marginPct: marginPct(earnedCents, costCents),
      uninvoicedCents: Math.max(0, earnedCents - invoicedCents),
    })
    out.series.set(p._id, weeklySeries(revenue, dayCosts))
  }
  out.rows.sort((a, b) => (a.marginPct ?? 999) - (b.marginPct ?? 999))
  return out
}

export interface ClientProfitRow {
  clientId: string
  name: string
  code: string
  projectCodes: string[]
  hours: number
  earnedCents: number
  invoicedCents: number
  wageCents: number
  /** Project costs and approved purchase invoices of the client's projects. */
  directCostCents: number
  /** The client's share of general purchase invoices (no project), by hours. */
  overheadCents: number
  marginCents: number
  marginPct: number | null
}

/** Per client: the client's projects summed, plus general overhead shared out by hours worked. */
export function clientProfit(d: ProfitData): ClientProfitRow[] {
  const by = new Map<string, ClientProfitRow>()
  for (const r of d.rows) {
    const c = d.clients.get(r.clientId)
    let row = by.get(r.clientId)
    if (!row) by.set(r.clientId, (row = { clientId: r.clientId, name: c?.name ?? r.clientName, code: c?.code ?? "?", projectCodes: [], hours: 0, earnedCents: 0, invoicedCents: 0, wageCents: 0, directCostCents: 0, overheadCents: 0, marginCents: 0, marginPct: null }))
    if (r.hours > 0 || r.invoicedCents > 0 || r.costCents > 0) row.projectCodes.push(r.code)
    row.hours += r.hours
    row.earnedCents += r.earnedCents
    row.invoicedCents += r.invoicedCents
    row.wageCents += r.wageCents
    row.directCostCents += r.otherCostCents + r.purchaseCents
  }
  const shares = allocateCents(d.generalOverheadCents, new Map([...by.values()].map((r) => [r.clientId, r.hours])))
  const out: ClientProfitRow[] = []
  for (const r of by.values()) {
    if (!r.hours && !r.invoicedCents && !r.directCostCents) continue
    r.overheadCents = shares.get(r.clientId) ?? 0
    const cost = r.wageCents + r.directCostCents + r.overheadCents
    r.hours = Math.round(r.hours * 100) / 100
    r.marginCents = r.earnedCents - cost
    r.marginPct = marginPct(r.earnedCents, cost)
    out.push(r)
  }
  return out.sort((a, b) => (a.marginPct ?? 999) - (b.marginPct ?? 999))
}

export interface WorkerProfitRow {
  workerId: string
  name: string
  source: "own" | "subcontractor"
  trades: string[]
  projectCodes: string[]
  days: number
  hours: number
  billedCents: number
  wageCents: number
  overheadCents: number
  marginCents: number
  marginPct: number | null
  hourlyCostCents: number
  /** True when the worker has no own rate and the trade default applies. */
  defaultRate: boolean
}

/** Per worker: billed value − wages − the worker's share (by days) of each project's non-wage costs. */
export async function workerProfit(ctx: DbCtxLike, d: ProfitData): Promise<WorkerProfitRow[]> {
  const db = invReader(ctx)
  const { own, tradeCode, rateFor } = await wageRates(ctx)
  const rows = workerProfitability(d.days, d.overheadByProject)
  const codeOf = new Map(d.rows.map((r) => [r.projectId as string, r.code]))
  const tradesOf = new Map<string, Set<string>>()
  for (const day of d.days) {
    const s = tradesOf.get(day.workerId) ?? new Set<string>()
    s.add(day.tradeId)
    tradesOf.set(day.workerId, s)
  }
  const out: WorkerProfitRow[] = []
  for (const r of rows) {
    const w = (await db.get("staffing_workers", r.workerId as WorkerDoc["_id"])) as WorkerDoc | null
    const trades = [...(tradesOf.get(r.workerId) ?? [])]
    out.push({
      ...r,
      name: w ? `${w.firstName} ${w.lastName}` : "?",
      source: w?.source ?? "own",
      trades: trades.map((t) => tradeCode.get(t) ?? "?"),
      projectCodes: r.projectIds.map((p) => codeOf.get(p) ?? "?"),
      hourlyCostCents: rateFor(r.workerId, trades[0] ?? ""),
      defaultRate: !own.has(r.workerId),
    })
  }
  return out
}

// ---------------------------------------------------------------- the closed process (chain)

export interface ChainPeriod extends ChainResult {
  from: string
  to: string
  hours: number
  /** Value of every recorded hour (approved or not) at the sell rates. */
  valueCents: number
  approvedValueCents: number
  invoice: { id: string; number: string | null; status: InvoiceStatus; totalCents: number } | null
  /** Facts behind the steps, for the cell's tooltip. */
  facts: { daysWithHours: number; weeksWithHours: number; weeksApproved: number; daysCovered: number; sheets: number; openMismatches: number }
}

export interface ChainClientRow {
  clientId: string
  name: string
  code: string
  invoicingPeriod: "weekly" | "biweekly" | "monthly"
  projects: { id: string; code: string; name: string }[]
  periods: ChainPeriod[]
}

const STATUS_RANK = Object.fromEntries(INVOICE_STATUSES.map((s, i) => [s, i])) as Record<InvoiceStatus, number>

/**
 * The chain of every client billing period from `months` months back to
 * today: hours recorded → week approved → client timesheet received →
 * reconciled → invoice drafted → approved → sent → paid.
 */
export async function chainOverview(ctx: DbCtxLike, opts: { today?: string; months?: number; alertAfterDays: number }): Promise<ChainClientRow[]> {
  const db = invReader(ctx)
  const today = opts.today ?? todayIso()
  const windowFrom = addMonths(`${today.slice(0, 7)}-01`, -((opts.months ?? 6) - 1))
  const yesterday = addDays(today, -1)
  const clients = (await db.query("staffing_clients").withIndex("by_name").collect()).filter((c) => c.kind !== "subcontractor")
  const out: ChainClientRow[] = []
  for (const client of clients) {
    const projects = (
      await db
        .query("staffing_projects")
        .withIndex("by_client", (i) => i.eq("clientId", client._id))
        .collect()
    ).filter((p) => p.status !== "cancelled" && p.status !== "draft" && p.startDate <= today && (!p.endDate || p.endDate >= windowFrom))
    const invoices = await db
      .query("staffing_invoicing_invoices")
      .withIndex("by_client", (i) => i.eq("clientId", client._id))
      .collect()
    if (!projects.length && !invoices.some((i) => i.periodTo >= windowFrom)) continue
    const termsFor = await rateTermsResolver(ctx, client, projects)
    const earliest = projects.map((p) => p.startDate).sort()[0]
    const from = earliest && earliest > windowFrom ? earliest : windowFrom

    // Per project: recorded days, weeks, approved weeks, billable rows, client sheets with open mismatches.
    // `week`: the Monday of a timesheets entry (manual corrections have none: they need no week approval).
    const recorded: { projectId: string; date: string; hours: number; valueCents: number; week?: string }[] = []
    const weeksApproved = new Set<string>()
    const billable: BillableHours[] = []
    const sheets: { projectId: string; from: string; to: string; openDates: string[] }[] = []
    for (const p of projects) {
      const entries = await db
        .query("staffing_timesheets_entries")
        .withIndex("by_project_date", (i) => i.eq("projectId", p._id).gte("date", from).lte("date", today))
        .collect()
      const approved = await db
        .query("staffing_timesheets_weeks")
        .withIndex("by_project_week", (i) => i.eq("projectId", p._id).gte("weekStart", weekStartOf(from)))
        .collect()
      for (const w of approved) weeksApproved.add(`${p._id}|${w.weekStart}`)
      for (const e of entries) {
        const hours = e.regularHours + e.overtimeHours
        if (hours <= 0) continue
        const row = e.weekend ? { regular: 0, overtime: 0, weekend: hours } : { regular: e.regularHours, overtime: e.overtimeHours, weekend: 0 }
        recorded.push({ projectId: p._id, date: e.date, hours, valueCents: hoursValueCents(row, termsFor(p._id, e.tradeId)), week: `${p._id}|${weekStartOf(e.date)}` })
      }
      for (const h of await billableHours(ctx, { projectId: p._id, from, to: today })) {
        billable.push(h)
        if (h.source === "manual") recorded.push({ projectId: p._id, date: h.date, hours: h.regular + h.overtime + h.weekend, valueCents: hoursValueCents(h, termsFor(p._id, h.tradeId)) })
      }
      const projectSheets = await db
        .query("staffing_timesheets_clientSheets")
        .withIndex("by_project", (i) => i.eq("projectId", p._id).gte("periodTo", from))
        .collect()
      if (!projectSheets.length) continue
      const assignments = await db
        .query("staffing_assignments")
        .withIndex("by_project", (i) => i.eq("projectId", p._id))
        .collect()
      const workers: { id: string; firstName: string; lastName: string }[] = []
      for (const id of new Set(assignments.filter((a) => a.status !== "cancelled").map((a) => a.workerId))) {
        const w = await db.get("staffing_workers", id)
        if (w) workers.push({ id: w._id, firstName: w.firstName, lastName: w.lastName })
      }
      for (const s of projectSheets) {
        if (s.status !== "ready") {
          sheets.push({ projectId: p._id, from: s.periodFrom, to: s.periodTo, openDates: [s.periodFrom] })
          continue
        }
        const own = entries.filter((e) => e.date >= s.periodFrom && e.date <= s.periodTo).map((e) => ({ workerId: e.workerId, date: e.date, hours: e.regularHours + e.overtimeHours }))
        const rec = reconcile({ from: s.periodFrom, to: s.periodTo, workers, ours: own, theirs: s.rows, nameMap: Object.fromEntries(s.nameMap.map((m) => [m.name, m.workerId])) })
        const resolved = new Set(
          (
            await db
              .query("staffing_timesheets_resolutions")
              .withIndex("by_sheet", (i) => i.eq("sheetId", s._id))
              .collect()
          ).map((r) => r.key),
        )
        sheets.push({ projectId: p._id, from: s.periodFrom, to: s.periodTo, openDates: rec.lines.filter((l) => l.kind !== "ok" && !resolved.has(l.key)).map((l) => l.date) })
      }
    }

    const periods: ChainPeriod[] = []
    for (const pr of billingPeriodsBetween(client.invoicingPeriod, from, today)) {
      const inP = (d: string) => d >= pr.from && d <= pr.to && d <= yesterday
      const days = new Set<string>()
      const weekSet = new Set<string>()
      let hours = 0
      let valueCents = 0
      for (const r of recorded)
        if (inP(r.date)) {
          days.add(`${r.projectId}|${r.date}`)
          if (r.week) weekSet.add(r.week)
          hours += r.hours
          valueCents += r.valueCents
        }
      const weeks = [...weekSet]
      const covered = [...days].filter((k) => {
        const [projectId, date] = k.split("|") as [string, string]
        return sheets.some((s) => s.projectId === projectId && s.from <= date && s.to >= date)
      }).length
      const overlapping = sheets.filter((s) => s.to >= pr.from && s.from <= pr.to)
      const openMismatches = overlapping.reduce((n, s) => n + s.openDates.filter((d) => d >= pr.from && d <= pr.to).length, 0)
      const approvedValueCents = billable.filter((h) => h.date >= pr.from && h.date <= pr.to).reduce((s, h) => s + hoursValueCents(h, termsFor(h.projectId, h.tradeId)), 0)
      const periodInvoices = invoices.filter((i) => i.periodFrom <= pr.to && i.periodTo >= pr.from)
      const best = periodInvoices.sort((a, b) => STATUS_RANK[b.status] - STATUS_RANK[a.status])[0] ?? null
      const invoicedCents = periodInvoices.filter((i) => i.status !== "draft").reduce((s, i) => s + i.subtotalCents, 0)
      const facts = { daysWithHours: days.size, weeksWithHours: weeks.length, weeksApproved: weeks.filter((k) => weeksApproved.has(k)).length, daysCovered: covered, sheets: overlapping.length, openMismatches }
      const res = chainStatus({ period: pr, today, ...facts, invoice: best ? { status: best.status, sent: !!best.sentAt } : null, approvedValueCents, invoicedCents }, opts.alertAfterDays)
      periods.push({
        ...res,
        from: pr.from,
        to: pr.to,
        hours: Math.round(hours * 100) / 100,
        valueCents,
        approvedValueCents,
        invoice: best ? { id: best._id, number: best.number ?? null, status: best.status, totalCents: best.totalCents } : null,
        facts,
      })
    }
    out.push({ clientId: client._id, name: client.name, code: client.code, invoicingPeriod: client.invoicingPeriod, projects: projects.map((p) => ({ id: p._id, code: p.code, name: p.name })), periods })
  }
  return out
}

export interface ChainAlert {
  clientId: string
  clientName: string
  clientCode: string
  from: string
  to: string
  daysSinceEnd: number
  atRiskCents: number
  brokenAt: string | null
  invoiceId: string | null
}

export function chainAlerts(rows: readonly ChainClientRow[]): ChainAlert[] {
  const out: ChainAlert[] = []
  for (const r of rows)
    for (const p of r.periods)
      if (p.alert) out.push({ clientId: r.clientId, clientName: r.name, clientCode: r.code, from: p.from, to: p.to, daysSinceEnd: p.daysSinceEnd, atRiskCents: p.atRiskCents || p.valueCents, brokenAt: p.brokenAt, invoiceId: p.invoice?.id ?? null })
  return out.sort((a, b) => b.atRiskCents - a.atRiskCents)
}

export type { InvoiceDoc }
