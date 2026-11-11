import { defineTable } from "convex/server"
import { v } from "convex/values"
import { COST_CATEGORIES, FORWARD_STATUSES, HOURS_SOURCES, INVOICE_STATUSES, PURCHASE_SOURCES, PURCHASE_STATUSES, RATE_TYPES } from "./pure"

const lit = <T extends string>(values: readonly T[]) => v.union(...values.map((x) => v.literal(x)))

export const invoiceStatusValidator = lit(INVOICE_STATUSES)
export const rateTypeValidator = lit(RATE_TYPES)
export const hoursSourceValidator = lit(HOURS_SOURCES)
export const costCategoryValidator = lit(COST_CATEGORIES)
export const purchaseStatusValidator = lit(PURCHASE_STATUSES)
export const purchaseSourceValidator = lit(PURCHASE_SOURCES)
export const forwardStatusValidator = lit(FORWARD_STATUSES)

export const invoiceLineValidator = v.object({
  projectId: v.id("staffing_projects"),
  tradeId: v.id("staffing_trades"),
  rateType: rateTypeValidator,
  hours: v.number(),
  /** Percent of the regular rate (100, 125, 150). */
  multiplierPct: v.number(),
  unitPriceCents: v.number(),
  amountCents: v.number(),
})

/**
 * Tables of the invoicing area (`staffing-invoicing`). Spread into the app
 * schema after `staffingTables`. Dates `YYYY-MM-DD`, money integer cents.
 */
const coreTables = {
  /**
   * Manual corrections of billable hours (`source: "manual"`), added on top of
   * the timesheets area's approved hours by `billableHours` (operations.ts).
   * Rows with `source: "timesheets"` are legacy (before the timesheets area
   * existed) and are ignored.
   */
  staffing_invoicing_hours: defineTable({
    projectId: v.id("staffing_projects"),
    workerId: v.id("staffing_workers"),
    tradeId: v.id("staffing_trades"),
    date: v.string(),
    regular: v.number(),
    overtime: v.number(),
    weekend: v.number(),
    source: hoursSourceValidator,
    note: v.optional(v.string()),
    createdBy: v.string(),
  })
    .index("by_project_date", ["projectId", "date"])
    .index("by_worker_date", ["workerId", "date"]),

  /** Overtime and weekend surcharges per client (no `projectId`) or per project (overrides the client's). */
  staffing_invoicing_terms: defineTable({
    clientId: v.id("staffing_clients"),
    projectId: v.optional(v.id("staffing_projects")),
    overtimePct: v.number(),
    weekendPct: v.number(),
    updatedAt: v.number(),
  })
    .index("by_client", ["clientId", "projectId"])
    .index("by_project", ["projectId"]),

  staffing_invoicing_invoices: defineTable({
    clientId: v.id("staffing_clients"),
    /** Set on approval: `DN-2026-0001`. Drafts have none. */
    number: v.optional(v.string()),
    status: invoiceStatusValidator,
    periodFrom: v.string(),
    periodTo: v.string(),
    /** Set on approval. */
    issueDate: v.optional(v.string()),
    dueDate: v.optional(v.string()),
    currency: v.string(),
    lines: v.array(invoiceLineValidator),
    /** Distinct projects of the lines (for per-project reports). */
    projectIds: v.array(v.id("staffing_projects")),
    vatRatePct: v.number(),
    subtotalCents: v.number(),
    vatCents: v.number(),
    totalCents: v.number(),
    paidCents: v.number(),
    notes: v.string(),
    createdBy: v.string(),
    approvedBy: v.optional(v.string()),
    approvedAt: v.optional(v.number()),
    sentAt: v.optional(v.number()),
    paidAt: v.optional(v.string()),
    updatedAt: v.number(),
  })
    .index("by_status", ["status", "dueDate"])
    .index("by_client", ["clientId", "periodFrom"])
    .index("by_number", ["number"])
    .index("by_issue", ["issueDate"]),

  staffing_invoicing_payments: defineTable({
    invoiceId: v.id("staffing_invoicing_invoices"),
    date: v.string(),
    amountCents: v.number(),
    reference: v.optional(v.string()),
    createdBy: v.string(),
  }).index("by_invoice", ["invoiceId", "date"]),

  /** Payment reminders sent (or attempted) through n8n `dr-nuoma-mokejimo-priminimas`. */
  staffing_invoicing_reminders: defineTable({
    invoiceId: v.id("staffing_invoicing_invoices"),
    stage: v.number(),
    daysOverdue: v.number(),
    trigger: v.union(v.literal("manual"), v.literal("cron")),
    status: v.union(v.literal("pending"), v.literal("sent"), v.literal("failed"), v.literal("not_configured")),
    to: v.optional(v.string()),
    messageId: v.optional(v.string()),
    error: v.optional(v.string()),
    createdBy: v.string(),
    completedAt: v.optional(v.number()),
  }).index("by_invoice", ["invoiceId", "stage"]),

  /** Year counters of the invoice number series. */
  staffing_invoicing_counters: defineTable({
    prefix: v.string(),
    year: v.number(),
    last: v.number(),
  }).index("by_series", ["prefix", "year"]),

  staffing_invoicing_costs: defineTable({
    projectId: v.id("staffing_projects"),
    category: costCategoryValidator,
    date: v.string(),
    amountCents: v.number(),
    note: v.string(),
    createdBy: v.string(),
  }).index("by_project_date", ["projectId", "date"]),
}

export const purchaseTables = {
  /** Known suppliers: invoices e-mailed from their addresses (or `@domain`) queue for approval; others need review. */
  staffing_invoicing_suppliers: defineTable({
    name: v.string(),
    /** Lower-case addresses or `@domain.lt`. */
    emails: v.array(v.string()),
    category: costCategoryValidator,
    defaultProjectId: v.optional(v.id("staffing_projects")),
    vatCode: v.optional(v.string()),
    active: v.boolean(),
    updatedAt: v.number(),
  }).index("by_name", ["name"]),

  /** Purchase invoices: received by e-mail (Gavimas inbox) or uploaded; the director approves before they go to SitePro. */
  staffing_invoicing_purchases: defineTable({
    supplierId: v.optional(v.id("staffing_invoicing_suppliers")),
    supplierName: v.string(),
    senderEmail: v.optional(v.string()),
    number: v.string(),
    issueDate: v.string(),
    dueDate: v.optional(v.string()),
    netCents: v.number(),
    vatCents: v.number(),
    totalCents: v.number(),
    currency: v.string(),
    category: costCategoryValidator,
    /** Project the cost belongs to; none: general overhead (shared by hours in client profitability). */
    projectId: v.optional(v.id("staffing_projects")),
    status: purchaseStatusValidator,
    source: purchaseSourceValidator,
    subject: v.optional(v.string()),
    /** Ingest email (`ingestEmails` id) it came from. */
    emailId: v.optional(v.string()),
    attachmentNames: v.optional(v.array(v.string())),
    fileStorageId: v.optional(v.id("_storage")),
    fileName: v.optional(v.string()),
    note: v.optional(v.string()),
    decidedBy: v.optional(v.string()),
    decidedAt: v.optional(v.number()),
    rejectReason: v.optional(v.string()),
    forward: forwardStatusValidator,
    forwardedTo: v.optional(v.string()),
    forwardError: v.optional(v.string()),
    forwardedAt: v.optional(v.number()),
    createdBy: v.string(),
    updatedAt: v.number(),
  })
    .index("by_status", ["status", "issueDate"])
    .index("by_project", ["projectId", "issueDate"])
    .index("by_email", ["emailId"]),

  /** Gavimas inboxes whose mail lands in the purchase invoice queue (consumer `staffing-invoicing-purchases`). */
  staffing_invoicing_purchaseInboxes: defineTable({
    inboxId: v.string(),
    address: v.string(),
    createdBy: v.string(),
    createdAt: v.number(),
  }).index("by_inbox", ["inboxId"]),
}

export const profitTables = {
  /** Hourly cost of a worker (employer's cost, cents). Without a row: the trade's default (`defaultWageCents`). */
  staffing_invoicing_wageRates: defineTable({
    workerId: v.id("staffing_workers"),
    hourlyCostCents: v.number(),
    updatedBy: v.string(),
    updatedAt: v.number(),
  }).index("by_worker", ["workerId"]),

  /** Runs of the daily "missing invoice" check (n8n `dr-nuoma-pranesimas` to the director). */
  staffing_invoicing_chainRuns: defineTable({
    date: v.string(),
    trigger: v.union(v.literal("cron"), v.literal("manual")),
    alerts: v.number(),
    atRiskCents: v.number(),
    status: v.union(v.literal("nothing"), v.literal("pending"), v.literal("sent"), v.literal("failed"), v.literal("not_configured")),
    to: v.optional(v.string()),
    error: v.optional(v.string()),
    createdBy: v.string(),
    completedAt: v.optional(v.number()),
  }).index("by_date", ["date"]),
}

/** Every table of the area; spread into the app schema after `staffingTables`. */
export const invoicingTables = { ...coreTables, ...purchaseTables, ...profitTables }

export type InvoicingTableName = keyof typeof invoicingTables
