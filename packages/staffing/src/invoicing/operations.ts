// Shared operations of the invoicing area. Like the base's operations they
// take any ctx with `db` and do NOT check permissions: guard first.
import type { GenericDatabaseReader, GenericDatabaseWriter } from "convex/server"
import type { GenericId } from "convex/values"
import { sellRateFor, todayIso } from "../pure"
import type { DataModelOf, DbCtxLike, ClientDoc, ClientId, ProjectDoc, ProjectId, TradeDoc } from "../shared"
import type { staffingTables } from "../tables"
import {
  daysOverdue,
  DEFAULT_OVERTIME_PCT,
  DEFAULT_WEEKEND_PCT,
  formatInvoiceNumber,
  invoiceTotals,
  OPEN_INVOICE_STATUSES,
  priceHours,
  unitPrice,
  vatRateFor,
  type BillableHoursRow,
  type HoursSource,
  type InvoiceLineDraft,
  type InvoiceStatus,
  type RateTerms,
} from "./pure"
import type { invoicingTables } from "./tables"

export type InvoicingDataModel = DataModelOf<typeof staffingTables & typeof invoicingTables>
export const invReader = (ctx: DbCtxLike) => ctx.db as GenericDatabaseReader<InvoicingDataModel>
export const invWriter = (ctx: DbCtxLike) => ctx.db as GenericDatabaseWriter<InvoicingDataModel>

export type InvoiceId = GenericId<"staffing_invoicing_invoices">
export type InvoiceDoc = InvoicingDataModel["staffing_invoicing_invoices"]["document"]
export type HoursDoc = InvoicingDataModel["staffing_invoicing_hours"]["document"]
export type CostDoc = InvoicingDataModel["staffing_invoicing_costs"]["document"]

// ---------------------------------------------------------------- billable hours

export interface BillableHours extends BillableHoursRow {
  workerId: string
  date: string
  source: HoursSource
}

/**
 * Billable hours of a project in `[from, to]` (inclusive). The one place
 * invoicing reads hours from.
 *
 * TODO(after merge with the timesheets area, DIG-99): read the timesheets
 * area's approved hours (its `approvedHours(ctx, { projectId, from, to })`)
 * instead, and add only `source: "manual"` rows from `staffing_invoicing_hours`
 * on top (corrections). Until then the demo seed and the manual form fill
 * `staffing_invoicing_hours`.
 */
export async function billableHours(ctx: DbCtxLike, q: { projectId: ProjectId; from: string; to: string }): Promise<BillableHours[]> {
  const rows = await invReader(ctx)
    .query("staffing_invoicing_hours")
    .withIndex("by_project_date", (i) => i.eq("projectId", q.projectId).gte("date", q.from).lte("date", q.to))
    .collect()
  return rows.map((r) => ({ projectId: r.projectId, tradeId: r.tradeId, workerId: r.workerId, date: r.date, regular: r.regular, overtime: r.overtime, weekend: r.weekend, source: r.source }))
}

// ---------------------------------------------------------------- rates and surcharges

/** Surcharges for a project: the project's own terms, else the client's, else the defaults. */
export async function surchargesFor(ctx: DbCtxLike, clientId: ClientId, projectId?: ProjectId): Promise<{ overtimePct: number; weekendPct: number; scope: "project" | "client" | "default" }> {
  const db = invReader(ctx)
  if (projectId) {
    const p = await db
      .query("staffing_invoicing_terms")
      .withIndex("by_project", (i) => i.eq("projectId", projectId))
      .first()
    if (p) return { overtimePct: p.overtimePct, weekendPct: p.weekendPct, scope: "project" }
  }
  const c = await db
    .query("staffing_invoicing_terms")
    .withIndex("by_client", (i) => i.eq("clientId", clientId).eq("projectId", undefined))
    .first()
  if (c) return { overtimePct: c.overtimePct, weekendPct: c.weekendPct, scope: "client" }
  return { overtimePct: DEFAULT_OVERTIME_PCT, weekendPct: DEFAULT_WEEKEND_PCT, scope: "default" }
}

/** Loads rate terms for a set of projects of one client; `termsFor` is synchronous for the pure pricing. */
export async function rateTermsResolver(ctx: DbCtxLike, client: ClientDoc, projects: readonly ProjectDoc[]): Promise<(projectId: string, tradeId: string) => RateTerms> {
  const byProject = new Map<string, { project: ProjectDoc; overtimePct: number; weekendPct: number }>()
  for (const p of projects) {
    const s = await surchargesFor(ctx, client._id, p._id)
    byProject.set(p._id, { project: p, overtimePct: s.overtimePct, weekendPct: s.weekendPct })
  }
  return (projectId, tradeId) => {
    const e = byProject.get(projectId)
    if (!e) return { rateCents: null, overtimePct: DEFAULT_OVERTIME_PCT, weekendPct: DEFAULT_WEEKEND_PCT }
    return { rateCents: sellRateFor(tradeId, e.project.rates, client.defaultRates), overtimePct: e.overtimePct, weekendPct: e.weekendPct }
  }
}

/** Value of hours at the sell rates (earned revenue), for profitability. */
export function hoursValueCents(h: BillableHoursRow, terms: RateTerms): number {
  if (terms.rateCents === null) return 0
  return Math.round(h.regular * terms.rateCents + h.overtime * unitPrice(terms.rateCents, terms.overtimePct) + h.weekend * unitPrice(terms.rateCents, terms.weekendPct))
}

// ---------------------------------------------------------------- drafts and numbering

export async function clientProjects(ctx: DbCtxLike, clientId: ClientId): Promise<ProjectDoc[]> {
  return invReader(ctx)
    .query("staffing_projects")
    .withIndex("by_client", (i) => i.eq("clientId", clientId))
    .collect()
}

export interface DraftBuild {
  lines: (InvoiceLineDraft & { projectId: ProjectId; tradeId: GenericId<"staffing_trades"> })[]
  projectIds: ProjectId[]
  missingRates: { projectId: string; tradeId: string; hours: number }[]
  vatRatePct: number
  subtotalCents: number
  vatCents: number
  totalCents: number
}

/** Prices the client's billable hours in the period into invoice lines. */
export async function buildDraft(ctx: DbCtxLike, client: ClientDoc, from: string, to: string): Promise<DraftBuild> {
  const projects = (await clientProjects(ctx, client._id)).filter((p) => p.status !== "cancelled" && p.startDate <= to && (!p.endDate || p.endDate >= from))
  const rows: BillableHours[] = []
  for (const p of projects) rows.push(...(await billableHours(ctx, { projectId: p._id, from, to })))
  const termsFor = await rateTermsResolver(ctx, client, projects)
  const { lines, missingRates } = priceHours(rows, termsFor)
  const vatRatePct = vatRateFor(client.country)
  const totals = invoiceTotals(lines, vatRatePct)
  const projectIds = [...new Set(lines.map((l) => l.projectId))] as ProjectId[]
  return { lines: lines as DraftBuild["lines"], projectIds, missingRates, vatRatePct, ...totals }
}

/** Next number of the series for the year (`DN-2026-0007`); call inside the approving mutation. */
export async function allocateInvoiceNumber(ctx: DbCtxLike, prefix: string, year: number): Promise<string> {
  const db = invWriter(ctx)
  const c = await db
    .query("staffing_invoicing_counters")
    .withIndex("by_series", (i) => i.eq("prefix", prefix).eq("year", year))
    .first()
  const next = (c?.last ?? 0) + 1
  if (c) await db.patch("staffing_invoicing_counters", c._id, { last: next })
  else await db.insert("staffing_invoicing_counters", { prefix, year, last: next })
  return formatInvoiceNumber(prefix, year, next)
}

/** Issued, unpaid invoices (approved, sent, partially paid). */
export async function openInvoices(ctx: DbCtxLike): Promise<InvoiceDoc[]> {
  const db = invReader(ctx)
  const out: InvoiceDoc[] = []
  for (const status of OPEN_INVOICE_STATUSES)
    out.push(
      ...(await db
        .query("staffing_invoicing_invoices")
        .withIndex("by_status", (i) => i.eq("status", status))
        .collect()),
    )
  return out
}

// ---------------------------------------------------------------- views

export interface InvoiceView {
  id: InvoiceId
  number: string | null
  status: InvoiceStatus
  clientId: ClientId
  clientName: string
  clientCode: string
  periodFrom: string
  periodTo: string
  issueDate: string | null
  dueDate: string | null
  currency: string
  subtotalCents: number
  vatCents: number
  totalCents: number
  paidCents: number
  outstandingCents: number
  /** Days past due for open invoices; 0 when not due or closed. */
  daysOverdue: number
  overdue: boolean
  projectCodes: string[]
  createdAt: number
}

export function invoiceView(inv: InvoiceDoc, client: ClientDoc | null, projectCode: (id: string) => string, today = todayIso()): InvoiceView {
  const open = OPEN_INVOICE_STATUSES.includes(inv.status)
  const late = open && inv.dueDate ? Math.max(0, daysOverdue(inv.dueDate, today)) : 0
  return {
    id: inv._id,
    number: inv.number ?? null,
    status: inv.status,
    clientId: inv.clientId,
    clientName: client?.name ?? "?",
    clientCode: client?.code ?? "?",
    periodFrom: inv.periodFrom,
    periodTo: inv.periodTo,
    issueDate: inv.issueDate ?? null,
    dueDate: inv.dueDate ?? null,
    currency: inv.currency,
    subtotalCents: inv.subtotalCents,
    vatCents: inv.vatCents,
    totalCents: inv.totalCents,
    paidCents: inv.paidCents,
    outstandingCents: inv.status === "draft" ? 0 : Math.max(0, inv.totalCents - inv.paidCents),
    daysOverdue: late,
    overdue: late > 0,
    projectCodes: inv.projectIds.map(projectCode),
    createdAt: inv._creationTime,
  }
}

/** Memoized lookups for building views of many rows. */
export function lookups(ctx: DbCtxLike) {
  const db = invReader(ctx)
  const clients = new Map<string, ClientDoc | null>()
  const projects = new Map<string, ProjectDoc | null>()
  const trades = new Map<string, TradeDoc | null>()
  return {
    async client(id: ClientId) {
      if (!clients.has(id)) clients.set(id, await db.get("staffing_clients", id))
      return clients.get(id) ?? null
    },
    async project(id: ProjectId) {
      if (!projects.has(id)) projects.set(id, await db.get("staffing_projects", id))
      return projects.get(id) ?? null
    },
    async trade(id: GenericId<"staffing_trades">) {
      if (!trades.has(id)) trades.set(id, await db.get("staffing_trades", id))
      return trades.get(id) ?? null
    },
    projectCode: (id: string) => projects.get(id)?.code ?? "?",
  }
}
