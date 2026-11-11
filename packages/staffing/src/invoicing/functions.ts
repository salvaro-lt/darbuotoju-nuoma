// Guarded Convex functions of the invoicing area (`staffing-invoicing`).
// Each: guard (permission + module enabled) → checks → write → audit →
// `{ operationId }`. Re-export them from the app's `convex/invoicing.ts`.
import { internalActionGeneric, internalMutationGeneric, makeFunctionReference, mutationGeneric, queryGeneric } from "convex/server"
import { v } from "convex/values"
import { recordAudit, type ConvexSystem } from "@digimuza/system-core/convex"
import { STAFFING_MODULE_ID } from "../manifest"
import { addDays, rangesOverlap, todayIso } from "../pure"
import { actorArgs, actorId, cleanDate, cleanText, fail, opts, type ClientId, type DbCtxLike, type ProjectId, type TradeId, type WorkerId } from "../shared"

import { chainAlerts, chainOverview, clientProfit, profitData, workerProfit, type ProfitRow } from "./insights"
import { STAFFING_INVOICING_MODULE_ID, StaffingInvoicingPermissions as P } from "./manifest"
import {
  allocateInvoiceNumber,
  billableHours,
  buildDraft,
  clientProjects,
  invoiceView,
  invReader,
  invWriter,
  lookups,
  openInvoices,
  surchargesFor,
  type InvoiceDoc,
  type InvoiceView,
} from "./operations"
import {
  AGING_BUCKETS,
  agingBucket,
  COST_CATEGORIES,
  daysOverdue,
  dueDateFor,
  dueReminderStage,
  DEFAULT_MISSING_INVOICE_ALERT_DAYS,
  manualReminderStage,
  nextBillingPeriod,
  OPEN_INVOICE_STATUSES,
  REMINDER_STAGE_DAYS,
  siteProCsv,
  statusAfterPayments,
  type AgingBucket,
  type CostCategory,
  type InvoiceStatus,
  type ReminderStage,
  type SiteProInvoice,
  weekStart,
} from "./pure"
import { definePurchases } from "./purchases"
import { defineInvoicingSeed } from "./seed"
import { costCategoryValidator, invoiceStatusValidator } from "./tables"

const rangeArgs = { from: v.optional(v.string()), to: v.optional(v.string()) }

export interface InvoicingOptions {
  /** Invoice number series prefix. Default `DN` (`DN-2026-0001`). */
  numberPrefix?: string
  /** File name of the app's `convex/<file>.ts` exporting these functions (for scheduling). Default `invoicing`. */
  functionsPath?: string
  /** The issuing company, printed on invoices. */
  seller?: SellerInfo
  /** Days after a billing period ends before a missing invoice raises an alert (chain page, daily check). Default 7. */
  missingInvoiceAlertDays?: number
}

export interface SellerInfo {
  name: string
  companyCode: string
  vatCode: string
  address: string
  bank: string
  iban: string
  email?: string
}

const DEFAULT_SELLER: SellerInfo = { name: "UAB (įmonės pavadinimas)", companyCode: "000000000", vatCode: "LT000000000", address: "Lietuva", bank: "Bankas", iban: "LT00 0000 0000 0000 0000" }

const MAX_HOURS_PER_DAY = 24
const MAX_NOTE = 1000
/** Reminders not repeated unless the earlier attempt failed. */
const DONE_REMINDER = new Set(["pending", "sent", "not_configured"])

export interface InvoiceDetail {
  invoice: InvoiceView
  notes: string
  vatRatePct: number
  client: { id: ClientId; name: string; code: string; country: string; vatCode: string | null; companyCode: string | null; address: string | null; contactName: string | null; contactEmail: string | null; paymentTermsDays: number }
  seller: SellerInfo
  lines: { projectId: ProjectId; projectCode: string; projectName: string; tradeCode: string; tradeNameLt: string; tradeNameEn: string; rateType: "regular" | "overtime" | "weekend"; hours: number; multiplierPct: number; unitPriceCents: number; amountCents: number }[]
  payments: { id: string; date: string; amountCents: number; reference: string | null }[]
  reminders: { id: string; stage: number; daysOverdue: number; trigger: "manual" | "cron"; status: string; at: number; error: string | null }[]
  /** Stage the daily job sends next, and from when. */
  nextReminder: { stage: ReminderStage; on: string } | null
}

export type { ProfitRow }

export function defineInvoicing(system: ConvexSystem, options: InvoicingOptions = {}) {
  const prefix = options.numberPrefix ?? "DN"
  const path = options.functionsPath ?? "invoicing"
  const seller = options.seller ?? DEFAULT_SELLER
  const alertAfterDays = options.missingInvoiceAlertDays ?? DEFAULT_MISSING_INVOICE_ALERT_DAYS
  const chainDeliverRef = makeFunctionReference<"action">(`${path}:_deliverChainAlert`)
  const chainResultRef = makeFunctionReference<"mutation">(`${path}:_chainRunResult`)
  const deliverRef = makeFunctionReference<"action">(`${path}:_deliverReminder`)
  const resultRef = makeFunctionReference<"mutation">(`${path}:_reminderResult`)

  // ---------------------------------------------------------------- helpers

  async function invoiceOr404(ctx: DbCtxLike, id: InvoiceDoc["_id"], op: string): Promise<InvoiceDoc> {
    const inv = await invReader(ctx).get("staffing_invoicing_invoices", id)
    if (!inv) fail("NOT_FOUND", "invoice_not_found", op)
    return inv
  }

  async function views(ctx: DbCtxLike, rows: readonly InvoiceDoc[]): Promise<InvoiceView[]> {
    const l = lookups(ctx)
    const today = todayIso()
    const out: InvoiceView[] = []
    for (const r of rows) {
      const client = await l.client(r.clientId)
      for (const p of r.projectIds) await l.project(p)
      out.push(invoiceView(r, client, l.projectCode, today))
    }
    return out
  }

  async function remindersOf(ctx: DbCtxLike, invoiceId: InvoiceDoc["_id"]) {
    return invReader(ctx)
      .query("staffing_invoicing_reminders")
      .withIndex("by_invoice", (i) => i.eq("invoiceId", invoiceId))
      .collect()
  }

  /** Inserts a pending reminder and schedules its delivery through n8n. */
  async function queueReminder(ctx: DbCtxLike & { scheduler: { runAfter: (ms: number, ref: never, args: never) => Promise<unknown> } }, inv: InvoiceDoc, stage: ReminderStage, trigger: "manual" | "cron", by: string) {
    const db = invWriter(ctx)
    const client = await db.get("staffing_clients", inv.clientId)
    const contact = client?.contacts.find((c) => c.email) ?? null
    const late = daysOverdue(inv.dueDate!, todayIso())
    const reminderId = await db.insert("staffing_invoicing_reminders", {
      invoiceId: inv._id,
      stage,
      daysOverdue: late,
      trigger,
      status: "pending",
      ...(contact?.email ? { to: contact.email } : {}),
      createdBy: by,
    })
    const payload = {
      to: contact?.email ?? null,
      language: client?.country === "LT" ? "lt" : "en",
      invoiceNumber: inv.number ?? "",
      amountCents: inv.totalCents - inv.paidCents,
      currency: inv.currency,
      dueDate: inv.dueDate!,
      daysOverdue: late,
      stage,
      contactName: contact?.name ?? null,
      senderName: seller.name,
    }
    await ctx.scheduler.runAfter(0, deliverRef as never, { reminderId, payload } as never)
    return reminderId
  }

  /** Calls `send` for each open invoice whose next reminder stage is due today; returns how many. */
  async function queueDueReminders(ctx: DbCtxLike, send: (inv: InvoiceDoc, stage: ReminderStage) => Promise<void>): Promise<number> {
    const today = todayIso()
    let queued = 0
    for (const inv of await openInvoices(ctx)) {
      if (!inv.dueDate) continue
      const done = (await remindersOf(ctx, inv._id)).filter((r) => DONE_REMINDER.has(r.status)).map((r) => r.stage)
      const stage = dueReminderStage(daysOverdue(inv.dueDate, today), done)
      if (!stage) continue
      await send(inv, stage)
      queued++
    }
    return queued
  }

  function cleanHours(n: number, field: string, op: string) {
    if (!Number.isFinite(n) || n < 0 || n > MAX_HOURS_PER_DAY) fail("VALIDATION", `invalid_${field}`, op, [field])
    return Math.round(n * 100) / 100
  }

  function cleanPct(n: number, field: string, op: string) {
    if (!Number.isInteger(n) || n < 100 || n > 400) fail("VALIDATION", `invalid_${field}`, op, [field])
    return n
  }

  function cleanAmount(n: number, field: string, op: string) {
    if (!Number.isInteger(n) || n <= 0 || n > 100_000_000_00) fail("VALIDATION", `invalid_${field}`, op, [field])
    return n
  }

  function cleanRange(a: { from?: string | undefined; to?: string | undefined }, op: string) {
    const from = cleanDate(a.from, "from", op) ?? "0000-01-01"
    const to = cleanDate(a.to, "to", op) ?? "9999-12-31"
    if (to < from) fail("VALIDATION", "end_before_start", op, ["to"])
    return { from, to }
  }

  /** Records a run of the missing-invoice check and schedules the director's notification when something is missing. */
  async function queueChainCheck(ctx: DbCtxLike & { scheduler: { runAfter: (ms: number, ref: never, args: never) => Promise<unknown> } }, trigger: "cron" | "manual", by: string) {
    const db = invWriter(ctx)
    const today = todayIso()
    const alerts = chainAlerts(await chainOverview(ctx, { today, alertAfterDays }))
    const atRiskCents = alerts.reduce((s, x) => s + x.atRiskCents, 0)
    const runId = await db.insert("staffing_invoicing_chainRuns", { date: today, trigger, alerts: alerts.length, atRiskCents, status: alerts.length ? "pending" : "nothing", createdBy: by, ...(alerts.length ? {} : { completedAt: Date.now() }) })
    if (alerts.length) {
      const eur = (c: number) => `${(c / 100).toLocaleString("lt-LT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EUR`
      const payload = {
        title: `Neišrašytos sąskaitos: ${alerts.length} (${eur(atRiskCents)})`,
        text: `Šių klientų atsiskaitymo periodai baigėsi daugiau nei prieš ${alertAfterDays} d., o sąskaita dar neišrašyta.`,
        lines: alerts.map((x) => `${x.clientName} (${x.clientCode}), ${x.from}–${x.to}: periodas baigėsi prieš ${x.daysSinceEnd} d., sąskaita neišrašyta, ${eur(x.atRiskCents)}`),
      }
      await ctx.scheduler.runAfter(0, chainDeliverRef as never, { runId, payload } as never)
    }
    return { runId, alerts: alerts.length, atRiskCents }
  }

  async function siteProInvoice(ctx: DbCtxLike, inv: InvoiceDoc): Promise<SiteProInvoice> {
    const l = lookups(ctx)
    const client = await l.client(inv.clientId)
    const lines: SiteProInvoice["lines"] = []
    for (const line of inv.lines) {
      const p = await l.project(line.projectId)
      const t = await l.trade(line.tradeId)
      const kind = line.rateType === "regular" ? "" : line.rateType === "overtime" ? ` – viršvalandžiai ${line.multiplierPct}%` : ` – savaitgalis ${line.multiplierPct}%`
      lines.push({
        projectCode: p?.code ?? "",
        serviceCode: `${t?.code ?? "DARB"}${line.rateType === "regular" ? "" : line.rateType === "overtime" ? "-OT" : "-WE"}`,
        serviceName: `${t?.nameLt ?? "Darbuotojų nuoma"}${kind}`,
        hours: line.hours,
        unitPriceCents: line.unitPriceCents,
        amountCents: line.amountCents,
      })
    }
    return {
      number: inv.number ?? "",
      issueDate: inv.issueDate ?? "",
      dueDate: inv.dueDate ?? "",
      currency: inv.currency,
      vatRatePct: inv.vatRatePct,
      periodFrom: inv.periodFrom,
      periodTo: inv.periodTo,
      client: { code: client?.code ?? "", name: client?.name ?? "", vatCode: client?.vatCode ?? null, country: client?.country ?? "" },
      lines,
    }
  }

  return {
    // ---------------------------------------------------------------- invoices

    listInvoices: queryGeneric({
      args: { ...actorArgs, status: v.optional(invoiceStatusValidator), clientId: v.optional(v.id("staffing_clients")), overdueOnly: v.optional(v.boolean()) },
      handler: async (ctx, a): Promise<InvoiceView[]> => {
        await system.requirePermission(ctx, P.invoiceRead, opts(a))
        const db = invReader(ctx)
        let rows: InvoiceDoc[]
        if (a.clientId) {
          const clientId = a.clientId
          rows = await db
            .query("staffing_invoicing_invoices")
            .withIndex("by_client", (i) => i.eq("clientId", clientId))
            .collect()
          if (a.status) rows = rows.filter((r) => r.status === a.status)
        } else if (a.status) {
          const status = a.status
          rows = await db
            .query("staffing_invoicing_invoices")
            .withIndex("by_status", (i) => i.eq("status", status))
            .collect()
        } else rows = await db.query("staffing_invoicing_invoices").collect()
        let out = await views(ctx, rows)
        if (a.overdueOnly) out = out.filter((r) => r.overdue)
        // Drafts first, then by period, newest first.
        return out.sort((x, y) => Number(y.status === "draft") - Number(x.status === "draft") || y.periodFrom.localeCompare(x.periodFrom) || (y.number ?? "").localeCompare(x.number ?? ""))
      },
    }),

    getInvoice: queryGeneric({
      args: { ...actorArgs, invoiceId: v.id("staffing_invoicing_invoices") },
      handler: async (ctx, a): Promise<InvoiceDetail | null> => {
        await system.requirePermission(ctx, P.invoiceRead, opts(a))
        const db = invReader(ctx)
        const inv = await db.get("staffing_invoicing_invoices", a.invoiceId)
        if (!inv) return null
        const [view] = await views(ctx, [inv])
        const l = lookups(ctx)
        const client = await l.client(inv.clientId)
        const contact = client?.contacts.find((c) => c.email) ?? client?.contacts[0] ?? null
        const lines: InvoiceDetail["lines"] = []
        for (const line of inv.lines) {
          const p = await l.project(line.projectId)
          const t = await l.trade(line.tradeId)
          lines.push({ ...line, projectCode: p?.code ?? "?", projectName: p?.name ?? "?", tradeCode: t?.code ?? "?", tradeNameLt: t?.nameLt ?? "?", tradeNameEn: t?.nameEn ?? "?" })
        }
        const payments = await db
          .query("staffing_invoicing_payments")
          .withIndex("by_invoice", (i) => i.eq("invoiceId", inv._id))
          .collect()
        const reminders = await remindersOf(ctx, inv._id)
        const sent = reminders.filter((r) => DONE_REMINDER.has(r.status)).map((r) => r.stage)
        let nextReminder: InvoiceDetail["nextReminder"] = null
        if (OPEN_INVOICE_STATUSES.includes(inv.status) && inv.dueDate) {
          const stage = !sent.includes(1) ? 1 : !sent.includes(2) ? 2 : null
          if (stage) {
            const dueNow = dueReminderStage(daysOverdue(inv.dueDate, todayIso()), sent)
            const s = (dueNow ?? stage) as ReminderStage
            const on = new Date(Date.parse(`${inv.dueDate}T00:00:00Z`) + REMINDER_STAGE_DAYS[s] * 86_400_000).toISOString().slice(0, 10)
            nextReminder = { stage: s, on }
          }
        }
        return {
          invoice: view!,
          notes: inv.notes,
          vatRatePct: inv.vatRatePct,
          client: {
            id: inv.clientId,
            name: client?.name ?? "?",
            code: client?.code ?? "?",
            country: client?.country ?? "",
            vatCode: client?.vatCode ?? null,
            companyCode: client?.companyCode ?? null,
            address: client?.address ?? null,
            contactName: contact?.name ?? null,
            contactEmail: contact?.email ?? null,
            paymentTermsDays: client?.paymentTermsDays ?? 0,
          },
          seller,
          lines,
          payments: payments.map((p) => ({ id: p._id, date: p.date, amountCents: p.amountCents, reference: p.reference ?? null })),
          reminders: reminders.sort((x, y) => y._creationTime - x._creationTime).map((r) => ({ id: r._id, stage: r.stage, daysOverdue: r.daysOverdue, trigger: r.trigger, status: r.status, at: r.completedAt ?? r._creationTime, error: r.error ?? null })),
          nextReminder,
        }
      },
    }),

    /** Clients to invoice: their period kind, the last invoiced period and the suggested next one. */
    billingOverview: queryGeneric({
      args: { ...actorArgs },
      handler: async (ctx, a) => {
        await system.requirePermission(ctx, P.invoiceRead, opts(a))
        const db = invReader(ctx)
        const today = todayIso()
        const clients = (await db.query("staffing_clients").withIndex("by_name").collect()).filter((c) => c.kind !== "subcontractor")
        const out = []
        for (const c of clients) {
          const invoices = await db
            .query("staffing_invoicing_invoices")
            .withIndex("by_client", (i) => i.eq("clientId", c._id))
            .collect()
          const lastTo = invoices.reduce<string | null>((m, i) => (!m || i.periodTo > m ? i.periodTo : m), null)
          const projects = (await clientProjects(ctx, c._id)).filter((p) => p.status === "active" || p.status === "finished")
          const terms = await surchargesFor(ctx, c._id)
          out.push({
            clientId: c._id,
            name: c.name,
            code: c.code,
            invoicingPeriod: c.invoicingPeriod,
            paymentTermsDays: c.paymentTermsDays,
            lastInvoicedTo: lastTo,
            suggested: nextBillingPeriod(c.invoicingPeriod, lastTo, today),
            activeProjects: projects.map((p) => ({ id: p._id, code: p.code, name: p.name })),
            overtimePct: terms.overtimePct,
            weekendPct: terms.weekendPct,
          })
        }
        return out
      },
    }),

    /** Builds a draft from the client's billable hours in the period. Refuses periods already invoiced. */
    createDraft: mutationGeneric({
      args: { ...actorArgs, clientId: v.id("staffing_clients"), from: v.string(), to: v.string(), notes: v.optional(v.string()) },
      handler: async (ctx, a) => {
        const { sys, actor } = await system.requirePermission(ctx, P.invoiceManage, opts(a))
        const op = sys.operationId
        const db = invWriter(ctx)
        const from = cleanDate(a.from, "from", op)!
        const to = cleanDate(a.to, "to", op)!
        if (!from || !to) fail("VALIDATION", "missing_period", op, ["from", "to"])
        if (to < from) fail("VALIDATION", "end_before_start", op, ["to"])
        const client = await db.get("staffing_clients", a.clientId)
        if (!client) fail("NOT_FOUND", "client_not_found", op)
        const existing = await db
          .query("staffing_invoicing_invoices")
          .withIndex("by_client", (i) => i.eq("clientId", client._id))
          .collect()
        if (existing.some((i) => rangesOverlap({ startDate: i.periodFrom, endDate: i.periodTo }, { startDate: from, endDate: to }))) fail("CONFLICT", "period_already_invoiced", op, ["from"])
        const draft = await buildDraft(ctx, client, from, to)
        if (!draft.lines.length) fail("VALIDATION", draft.missingRates.length ? "missing_rates" : "no_billable_hours", op, ["from"])
        const id = await db.insert("staffing_invoicing_invoices", {
          clientId: client._id,
          status: "draft",
          periodFrom: from,
          periodTo: to,
          currency: client.currency,
          lines: draft.lines,
          projectIds: draft.projectIds,
          vatRatePct: draft.vatRatePct,
          subtotalCents: draft.subtotalCents,
          vatCents: draft.vatCents,
          totalCents: draft.totalCents,
          paidCents: 0,
          notes: cleanText(a.notes, MAX_NOTE, "notes", op, false) ?? "",
          createdBy: actorId(actor),
          updatedAt: Date.now(),
        })
        await recordAudit(sys, actor, { action: "staffing-invoicing.invoice.create", targetType: "staffing_invoicing_invoices", targetId: id, changes: { clientId: client._id, from, to, totalCents: draft.totalCents } })
        return { id, missingRates: draft.missingRates, operationId: op }
      },
    }),

    /** Rebuilds a draft's lines from the current hours and rates. */
    refreshDraft: mutationGeneric({
      args: { ...actorArgs, invoiceId: v.id("staffing_invoicing_invoices") },
      handler: async (ctx, a) => {
        const { sys, actor } = await system.requirePermission(ctx, P.invoiceManage, opts(a))
        const op = sys.operationId
        const db = invWriter(ctx)
        const inv = await invoiceOr404(ctx, a.invoiceId, op)
        if (inv.status !== "draft") fail("CONFLICT", "invoice_not_draft", op)
        const client = await db.get("staffing_clients", inv.clientId)
        if (!client) fail("NOT_FOUND", "client_not_found", op)
        const d = await buildDraft(ctx, client, inv.periodFrom, inv.periodTo)
        await db.patch("staffing_invoicing_invoices", inv._id, { lines: d.lines, projectIds: d.projectIds, vatRatePct: d.vatRatePct, subtotalCents: d.subtotalCents, vatCents: d.vatCents, totalCents: d.totalCents, updatedAt: Date.now() })
        await recordAudit(sys, actor, { action: "staffing-invoicing.invoice.refresh", targetType: "staffing_invoicing_invoices", targetId: inv._id, changes: { totalCents: d.totalCents } })
        return { missingRates: d.missingRates, operationId: op }
      },
    }),

    deleteDraft: mutationGeneric({
      args: { ...actorArgs, invoiceId: v.id("staffing_invoicing_invoices") },
      handler: async (ctx, a) => {
        const { sys, actor } = await system.requirePermission(ctx, P.invoiceManage, opts(a))
        const op = sys.operationId
        const inv = await invoiceOr404(ctx, a.invoiceId, op)
        if (inv.status !== "draft") fail("CONFLICT", "invoice_not_draft", op)
        await invWriter(ctx).delete("staffing_invoicing_invoices", inv._id)
        await recordAudit(sys, actor, { action: "staffing-invoicing.invoice.delete", targetType: "staffing_invoicing_invoices", targetId: inv._id })
        return { operationId: op }
      },
    }),

    /** Director's approval: number from the series, issue date (default today), due date by the client's terms. */
    approveInvoice: mutationGeneric({
      args: { ...actorArgs, invoiceId: v.id("staffing_invoicing_invoices"), issueDate: v.optional(v.string()) },
      handler: async (ctx, a) => {
        const { sys, actor } = await system.requirePermission(ctx, P.invoiceApprove, opts(a))
        const op = sys.operationId
        const db = invWriter(ctx)
        const inv = await invoiceOr404(ctx, a.invoiceId, op)
        if (inv.status !== "draft") fail("CONFLICT", "invoice_not_draft", op)
        if (!inv.lines.length) fail("VALIDATION", "no_lines", op)
        const client = await db.get("staffing_clients", inv.clientId)
        if (!client) fail("NOT_FOUND", "client_not_found", op)
        const issueDate = cleanDate(a.issueDate, "issueDate", op) ?? todayIso()
        const number = await allocateInvoiceNumber(ctx, prefix, Number(issueDate.slice(0, 4)))
        const dueDate = dueDateFor(issueDate, client.paymentTermsDays)
        await db.patch("staffing_invoicing_invoices", inv._id, { status: "approved", number, issueDate, dueDate, approvedBy: actorId(actor), approvedAt: Date.now(), updatedAt: Date.now() })
        await recordAudit(sys, actor, { action: "staffing-invoicing.invoice.approve", targetType: "staffing_invoicing_invoices", targetId: inv._id, changes: { number, issueDate, dueDate } })
        return { number, operationId: op }
      },
    }),

    /** The invoice went out (imported to SitePro / e-mailed from B1). */
    markSent: mutationGeneric({
      args: { ...actorArgs, invoiceId: v.id("staffing_invoicing_invoices") },
      handler: async (ctx, a) => {
        const { sys, actor } = await system.requirePermission(ctx, P.invoiceManage, opts(a))
        const op = sys.operationId
        const inv = await invoiceOr404(ctx, a.invoiceId, op)
        if (inv.status !== "approved") fail("CONFLICT", "invoice_not_approved", op)
        await invWriter(ctx).patch("staffing_invoicing_invoices", inv._id, { status: "sent", sentAt: Date.now(), updatedAt: Date.now() })
        await recordAudit(sys, actor, { action: "staffing-invoicing.invoice.send", targetType: "staffing_invoicing_invoices", targetId: inv._id })
        return { operationId: op }
      },
    }),

    // ---------------------------------------------------------------- payments

    recordPayment: mutationGeneric({
      args: { ...actorArgs, invoiceId: v.id("staffing_invoicing_invoices"), date: v.string(), amountCents: v.number(), reference: v.optional(v.string()) },
      handler: async (ctx, a) => {
        const { sys, actor } = await system.requirePermission(ctx, P.paymentManage, opts(a))
        const op = sys.operationId
        const db = invWriter(ctx)
        const inv = await invoiceOr404(ctx, a.invoiceId, op)
        if (!OPEN_INVOICE_STATUSES.includes(inv.status)) fail("CONFLICT", "invoice_not_open", op)
        const date = cleanDate(a.date, "date", op)
        if (!date) fail("VALIDATION", "missing_date", op, ["date"])
        const amount = cleanAmount(a.amountCents, "amountCents", op)
        if (amount > inv.totalCents - inv.paidCents) fail("VALIDATION", "overpayment", op, ["amountCents"])
        const reference = cleanText(a.reference, 200, "reference", op, false)
        const id = await db.insert("staffing_invoicing_payments", { invoiceId: inv._id, date, amountCents: amount, ...(reference ? { reference } : {}), createdBy: actorId(actor) })
        const paidCents = inv.paidCents + amount
        const issued = inv.sentAt ? "sent" : "approved"
        const status = statusAfterPayments(issued, inv.totalCents, paidCents)
        await db.patch("staffing_invoicing_invoices", inv._id, { paidCents, status, ...(status === "paid" ? { paidAt: date } : {}), updatedAt: Date.now() })
        await recordAudit(sys, actor, { action: "staffing-invoicing.payment.create", targetType: "staffing_invoicing_invoices", targetId: inv._id, changes: { amountCents: amount, status } })
        return { id, status, operationId: op }
      },
    }),

    deletePayment: mutationGeneric({
      args: { ...actorArgs, paymentId: v.id("staffing_invoicing_payments") },
      handler: async (ctx, a) => {
        const { sys, actor } = await system.requirePermission(ctx, P.paymentManage, opts(a))
        const op = sys.operationId
        const db = invWriter(ctx)
        const pay = await db.get("staffing_invoicing_payments", a.paymentId)
        if (!pay) fail("NOT_FOUND", "payment_not_found", op)
        const inv = await invoiceOr404(ctx, pay.invoiceId, op)
        await db.delete("staffing_invoicing_payments", pay._id)
        const paidCents = Math.max(0, inv.paidCents - pay.amountCents)
        const status = statusAfterPayments(inv.sentAt ? "sent" : "approved", inv.totalCents, paidCents)
        await db.patch("staffing_invoicing_invoices", inv._id, { paidCents, status, paidAt: undefined, updatedAt: Date.now() })
        await recordAudit(sys, actor, { action: "staffing-invoicing.payment.delete", targetType: "staffing_invoicing_invoices", targetId: inv._id, changes: { amountCents: pay.amountCents } })
        return { operationId: op }
      },
    }),

    // ---------------------------------------------------------------- debts and reminders

    /** Debt overview: aging buckets, overdue invoices with reminder state, latest reminders. */
    debts: queryGeneric({
      args: { ...actorArgs },
      handler: async (ctx, a) => {
        await system.requirePermission(ctx, P.invoiceRead, opts(a))
        const today = todayIso()
        const open = await openInvoices(ctx)
        const buckets = Object.fromEntries(AGING_BUCKETS.map((b) => [b, { count: 0, cents: 0 }])) as Record<AgingBucket, { count: number; cents: number }>
        for (const inv of open) {
          const b = buckets[agingBucket(inv.dueDate ?? today, today)]
          b.count++
          b.cents += inv.totalCents - inv.paidCents
        }
        const list = await views(ctx, open)
        const overdue = []
        for (const row of list.filter((r) => r.overdue).sort((x, y) => y.daysOverdue - x.daysOverdue)) {
          const rem = await remindersOf(ctx, row.id)
          const done = rem.filter((r) => DONE_REMINDER.has(r.status)).map((r) => r.stage)
          overdue.push({ ...row, bucket: agingBucket(row.dueDate!, today), remindersSent: [...new Set(done)].sort(), reminderDue: dueReminderStage(row.daysOverdue, done) })
        }
        const reminderRows = await invReader(ctx).query("staffing_invoicing_reminders").order("desc").take(30)
        const l = lookups(ctx)
        const reminders = []
        for (const r of reminderRows) {
          const inv = await invReader(ctx).get("staffing_invoicing_invoices", r.invoiceId)
          const client = inv ? await l.client(inv.clientId) : null
          reminders.push({ id: r._id, invoiceId: r.invoiceId, invoiceNumber: inv?.number ?? "?", clientName: client?.name ?? "?", stage: r.stage, daysOverdue: r.daysOverdue, trigger: r.trigger, status: r.status, to: r.to ?? null, at: r.completedAt ?? r._creationTime, error: r.error ?? null })
        }
        const totalOpenCents = open.reduce((s, i) => s + i.totalCents - i.paidCents, 0)
        return { today, totalOpenCents, buckets, overdue, reminders }
      },
    }),

    /** Sends a payment reminder now (stage by how late it is). */
    sendReminder: mutationGeneric({
      args: { ...actorArgs, invoiceId: v.id("staffing_invoicing_invoices") },
      handler: async (ctx, a) => {
        const { sys, actor } = await system.requirePermission(ctx, P.invoiceManage, opts(a))
        const op = sys.operationId
        const inv = await invoiceOr404(ctx, a.invoiceId, op)
        if (!OPEN_INVOICE_STATUSES.includes(inv.status) || !inv.dueDate) fail("CONFLICT", "invoice_not_open", op)
        const late = daysOverdue(inv.dueDate, todayIso())
        if (late <= 0) fail("CONFLICT", "invoice_not_overdue", op)
        const stage = manualReminderStage(late)
        const id = await queueReminder(ctx, inv, stage, "manual", actorId(actor))
        await recordAudit(sys, actor, { action: "staffing-invoicing.reminder.send", targetType: "staffing_invoicing_invoices", targetId: inv._id, changes: { stage, daysOverdue: late } })
        return { id, stage, operationId: op }
      },
    }),

    /** Daily job (convex/crons.ts): stage 1 at +3 days overdue, stage 2 at +14; each once. */
    _dailyReminders: internalMutationGeneric({
      args: {},
      handler: async (ctx): Promise<{ queued: number; skipped?: string }> => {
        const { sys } = await system.context(ctx)
        for (const m of [STAFFING_MODULE_ID, STAFFING_INVOICING_MODULE_ID]) {
          const row = await sys.store.get("modules", m)
          if (!row?.enabled || !row.present) return { queued: 0, skipped: `module_disabled:${m}` }
        }
        const queued = await queueDueReminders(ctx, async (inv, stage) => {
          await queueReminder(ctx, inv, stage, "cron", "system")
          await recordAudit(sys, "system", { action: "staffing-invoicing.reminder.send", targetType: "staffing_invoicing_invoices", targetId: inv._id, changes: { stage, trigger: "cron" } })
        })
        return { queued }
      },
    }),

    /** The daily reminder run, now (same rules: only stages that are due and not sent yet). */
    runDueReminders: mutationGeneric({
      args: { ...actorArgs },
      handler: async (ctx, a) => {
        const { sys, actor } = await system.requirePermission(ctx, P.invoiceManage, opts(a))
        const queued = await queueDueReminders(ctx, async (inv, stage) => {
          await queueReminder(ctx, inv, stage, "manual", actorId(actor))
          await recordAudit(sys, actor, { action: "staffing-invoicing.reminder.send", targetType: "staffing_invoicing_invoices", targetId: inv._id, changes: { stage } })
        })
        return { queued, operationId: sys.operationId }
      },
    }),

    /** Posts the reminder to n8n (`dr-nuoma-mokejimo-priminimas`); without N8N_URL / N8N_WEBHOOK_SECRET records "not configured". */
    _deliverReminder: internalActionGeneric({
      args: {
        reminderId: v.id("staffing_invoicing_reminders"),
        payload: v.object({
          to: v.union(v.string(), v.null()),
          language: v.string(),
          invoiceNumber: v.string(),
          amountCents: v.number(),
          currency: v.string(),
          dueDate: v.string(),
          daysOverdue: v.number(),
          stage: v.number(),
          contactName: v.union(v.string(), v.null()),
          senderName: v.string(),
        }),
      },
      handler: async (ctx, a) => {
        const url = process.env.N8N_URL
        const secret = process.env.N8N_WEBHOOK_SECRET
        const done = (status: "sent" | "failed" | "not_configured", extra: { messageId?: string; error?: string } = {}) => ctx.runMutation(resultRef as never, { reminderId: a.reminderId, status, ...extra } as never)
        if (!url || !secret) return done("not_configured")
        const { to, contactName, ...rest } = a.payload
        const production = process.env.APP_ENV === "production"
        const redirectTo = production ? undefined : (process.env.SUPER_USER_EMAILS ?? "").split(",").map((s) => s.trim()).find(Boolean)
        if (!to && (production || !redirectTo)) return done("failed", { error: "no_contact_email" })
        const body = { ...rest, to: to ?? redirectTo, ...(contactName ? { contactName } : {}), ...(redirectTo ? { redirectTo } : {}) }
        try {
          const res = await fetch(`${url.replace(/\/$/, "")}/webhook/dr-nuoma-mokejimo-priminimas`, { method: "POST", headers: { "Content-Type": "application/json", "X-Webhook-Secret": secret }, body: JSON.stringify(body) })
          if (!res.ok) return done("failed", { error: `http_${res.status}` })
          const json = (await res.json().catch(() => ({}))) as { id?: string }
          return done("sent", json.id ? { messageId: json.id } : {})
        } catch (e) {
          return done("failed", { error: String(e).slice(0, 200) })
        }
      },
    }),

    _reminderResult: internalMutationGeneric({
      args: { reminderId: v.id("staffing_invoicing_reminders"), status: v.union(v.literal("sent"), v.literal("failed"), v.literal("not_configured")), messageId: v.optional(v.string()), error: v.optional(v.string()) },
      handler: async (ctx, a) => {
        const db = invWriter(ctx)
        if (!(await db.get("staffing_invoicing_reminders", a.reminderId))) return
        await db.patch("staffing_invoicing_reminders", a.reminderId, { status: a.status, ...(a.messageId ? { messageId: a.messageId } : {}), ...(a.error ? { error: a.error } : {}), completedAt: Date.now() })
      },
    }),

    // ---------------------------------------------------------------- billable hours

    listHours: queryGeneric({
      args: { ...actorArgs, projectId: v.id("staffing_projects"), from: v.optional(v.string()), to: v.optional(v.string()) },
      handler: async (ctx, a) => {
        await system.requirePermission(ctx, P.invoiceRead, opts(a))
        const db = invReader(ctx)
        const to = a.to ?? todayIso()
        const from = a.from ?? addDays(to, -27)
        // Approved timesheet weeks plus manual corrections: exactly what an invoice draft prices.
        const rows = await billableHours(ctx, { projectId: a.projectId, from, to })
        const workers = new Map<string, string>()
        const l = lookups(ctx)
        const out = []
        for (const [i, r] of rows.sort((x, y) => y.date.localeCompare(x.date)).entries()) {
          if (!workers.has(r.workerId)) {
            const w = await db.get("staffing_workers", r.workerId as WorkerId)
            workers.set(r.workerId, w ? `${w.firstName} ${w.lastName}` : "?")
          }
          const t = await l.trade(r.tradeId as TradeId)
          out.push({ id: r.id ?? `ts-${r.workerId}-${r.date}-${i}`, date: r.date, workerId: r.workerId, workerName: workers.get(r.workerId)!, tradeId: r.tradeId, tradeCode: t?.code ?? "?", tradeNameLt: t?.nameLt ?? "?", tradeNameEn: t?.nameEn ?? "?", regular: r.regular, overtime: r.overtime, weekend: r.weekend, source: r.source, note: r.note })
        }
        // Weeks of the range with own hours that are not approved yet (they are not billable until approved).
        const unapproved = new Set<string>()
        const approved = new Set(
          (
            await db
              .query("staffing_timesheets_weeks")
              .withIndex("by_project_week", (i) => i.eq("projectId", a.projectId).gte("weekStart", addDays(from, -6)).lte("weekStart", to))
              .collect()
          ).map((w) => w.weekStart),
        )
        for (const e of await db
          .query("staffing_timesheets_entries")
          .withIndex("by_project_date", (i) => i.eq("projectId", a.projectId).gte("date", from).lte("date", to))
          .collect()) {
          const monday = weekStart(e.date)
          if (!approved.has(monday)) unapproved.add(monday)
        }
        return { from, to, rows: out, unapprovedWeeks: [...unapproved].sort() }
      },
    }),

    /** Manual billable hours (corrections, or until timesheets are connected). */
    addHours: mutationGeneric({
      args: { ...actorArgs, projectId: v.id("staffing_projects"), workerId: v.id("staffing_workers"), tradeId: v.id("staffing_trades"), date: v.string(), regular: v.number(), overtime: v.number(), weekend: v.number(), note: v.optional(v.string()) },
      handler: async (ctx, a) => {
        const { sys, actor } = await system.requirePermission(ctx, P.invoiceManage, opts(a))
        const op = sys.operationId
        const db = invWriter(ctx)
        if (!(await db.get("staffing_projects", a.projectId))) fail("NOT_FOUND", "project_not_found", op)
        if (!(await db.get("staffing_workers", a.workerId))) fail("NOT_FOUND", "worker_not_found", op)
        if (!(await db.get("staffing_trades", a.tradeId))) fail("VALIDATION", "invalid_tradeId", op, ["tradeId"])
        const date = cleanDate(a.date, "date", op)
        if (!date) fail("VALIDATION", "missing_date", op, ["date"])
        const regular = cleanHours(a.regular, "regular", op)
        const overtime = cleanHours(a.overtime, "overtime", op)
        const weekend = cleanHours(a.weekend, "weekend", op)
        if (regular + overtime + weekend <= 0 || regular + overtime + weekend > MAX_HOURS_PER_DAY) fail("VALIDATION", "invalid_hours", op, ["regular"])
        const note = cleanText(a.note, 300, "note", op, false)
        const id = await db.insert("staffing_invoicing_hours", { projectId: a.projectId, workerId: a.workerId, tradeId: a.tradeId, date, regular, overtime, weekend, source: "manual", ...(note ? { note } : {}), createdBy: actorId(actor) })
        await recordAudit(sys, actor, { action: "staffing-invoicing.hours.create", targetType: "staffing_invoicing_hours", targetId: id, changes: { date, regular, overtime, weekend } })
        return { id, operationId: op }
      },
    }),

    deleteHours: mutationGeneric({
      args: { ...actorArgs, hoursId: v.id("staffing_invoicing_hours") },
      handler: async (ctx, a) => {
        const { sys, actor } = await system.requirePermission(ctx, P.invoiceManage, opts(a))
        const op = sys.operationId
        const db = invWriter(ctx)
        const h = await db.get("staffing_invoicing_hours", a.hoursId)
        if (!h) fail("NOT_FOUND", "hours_not_found", op)
        await db.delete("staffing_invoicing_hours", h._id)
        await recordAudit(sys, actor, { action: "staffing-invoicing.hours.delete", targetType: "staffing_invoicing_hours", targetId: h._id })
        return { operationId: op }
      },
    }),

    /** Overtime / weekend surcharges for a client (no project) or one project. */
    setTerms: mutationGeneric({
      args: { ...actorArgs, clientId: v.id("staffing_clients"), projectId: v.optional(v.id("staffing_projects")), overtimePct: v.number(), weekendPct: v.number() },
      handler: async (ctx, a) => {
        const { sys, actor } = await system.requirePermission(ctx, P.invoiceManage, opts(a))
        const op = sys.operationId
        const db = invWriter(ctx)
        if (!(await db.get("staffing_clients", a.clientId))) fail("NOT_FOUND", "client_not_found", op)
        if (a.projectId) {
          const p = await db.get("staffing_projects", a.projectId)
          if (!p || p.clientId !== a.clientId) fail("VALIDATION", "invalid_projectId", op, ["projectId"])
        }
        const overtimePct = cleanPct(a.overtimePct, "overtimePct", op)
        const weekendPct = cleanPct(a.weekendPct, "weekendPct", op)
        const existing = await db
          .query("staffing_invoicing_terms")
          .withIndex("by_client", (i) => i.eq("clientId", a.clientId).eq("projectId", a.projectId))
          .first()
        if (existing) await db.patch("staffing_invoicing_terms", existing._id, { overtimePct, weekendPct, updatedAt: Date.now() })
        else await db.insert("staffing_invoicing_terms", { clientId: a.clientId, ...(a.projectId ? { projectId: a.projectId } : {}), overtimePct, weekendPct, updatedAt: Date.now() })
        await recordAudit(sys, actor, { action: "staffing-invoicing.terms.update", targetType: "staffing_clients", targetId: a.clientId, changes: { projectId: a.projectId ?? null, overtimePct, weekendPct } })
        return { operationId: op }
      },
    }),

    // ---------------------------------------------------------------- costs and profitability

    addCost: mutationGeneric({
      args: { ...actorArgs, projectId: v.id("staffing_projects"), category: costCategoryValidator, date: v.string(), amountCents: v.number(), note: v.optional(v.string()) },
      handler: async (ctx, a) => {
        const { sys, actor } = await system.requirePermission(ctx, P.costManage, opts(a))
        const op = sys.operationId
        const db = invWriter(ctx)
        if (!(await db.get("staffing_projects", a.projectId))) fail("NOT_FOUND", "project_not_found", op)
        const date = cleanDate(a.date, "date", op)
        if (!date) fail("VALIDATION", "missing_date", op, ["date"])
        const amountCents = cleanAmount(a.amountCents, "amountCents", op)
        const note = cleanText(a.note, MAX_NOTE, "note", op, false) ?? ""
        const id = await db.insert("staffing_invoicing_costs", { projectId: a.projectId, category: a.category, date, amountCents, note, createdBy: actorId(actor) })
        await recordAudit(sys, actor, { action: "staffing-invoicing.cost.create", targetType: "staffing_invoicing_costs", targetId: id, changes: { projectId: a.projectId, category: a.category, amountCents } })
        return { id, operationId: op }
      },
    }),

    deleteCost: mutationGeneric({
      args: { ...actorArgs, costId: v.id("staffing_invoicing_costs") },
      handler: async (ctx, a) => {
        const { sys, actor } = await system.requirePermission(ctx, P.costManage, opts(a))
        const op = sys.operationId
        const db = invWriter(ctx)
        const c = await db.get("staffing_invoicing_costs", a.costId)
        if (!c) fail("NOT_FOUND", "cost_not_found", op)
        await db.delete("staffing_invoicing_costs", c._id)
        await recordAudit(sys, actor, { action: "staffing-invoicing.cost.delete", targetType: "staffing_invoicing_costs", targetId: c._id, changes: { amountCents: c.amountCents } })
        return { operationId: op }
      },
    }),

    /** Every project with revenue (value of billable hours), wages, costs and margin in the period; worst margin first. */
    portfolio: queryGeneric({
      args: { ...actorArgs, ...rangeArgs },
      handler: async (ctx, a): Promise<ProfitRow[]> => {
        const { sys } = await system.requirePermission(ctx, P.profitRead, opts(a))
        return (await profitData(ctx, cleanRange(a, sys.operationId))).rows
      },
    }),

    /** Per client: revenue, wages, the client's project costs and its share of general overhead (by hours), margin. */
    clientProfitability: queryGeneric({
      args: { ...actorArgs, ...rangeArgs },
      handler: async (ctx, a) => {
        const { sys } = await system.requirePermission(ctx, P.profitRead, opts(a))
        const d = await profitData(ctx, cleanRange(a, sys.operationId))
        return { rows: clientProfit(d), generalOverheadCents: d.generalOverheadCents }
      },
    }),

    /** Per worker: billed value − wage cost (hours × hourly cost) − allocated housing, transport and other project costs per day. */
    workerProfitability: queryGeneric({
      args: { ...actorArgs, ...rangeArgs },
      handler: async (ctx, a) => {
        const { sys } = await system.requirePermission(ctx, P.profitRead, opts(a))
        const d = await profitData(ctx, cleanRange(a, sys.operationId))
        return await workerProfit(ctx, d)
      },
    }),

    /** A worker's hourly cost (employer's cost); `null` goes back to the trade default. */
    setWageRate: mutationGeneric({
      args: { ...actorArgs, workerId: v.id("staffing_workers"), hourlyCostCents: v.union(v.number(), v.null()) },
      handler: async (ctx, a) => {
        const { sys, actor } = await system.requirePermission(ctx, P.costManage, opts(a))
        const op = sys.operationId
        const db = invWriter(ctx)
        if (!(await db.get("staffing_workers", a.workerId))) fail("NOT_FOUND", "worker_not_found", op)
        if (a.hourlyCostCents !== null && (!Number.isInteger(a.hourlyCostCents) || a.hourlyCostCents <= 0 || a.hourlyCostCents > 100_00_00)) fail("VALIDATION", "invalid_hourlyCostCents", op, ["hourlyCostCents"])
        const existing = await db
          .query("staffing_invoicing_wageRates")
          .withIndex("by_worker", (i) => i.eq("workerId", a.workerId))
          .first()
        if (a.hourlyCostCents === null) {
          if (existing) await db.delete("staffing_invoicing_wageRates", existing._id)
        } else if (existing) await db.patch("staffing_invoicing_wageRates", existing._id, { hourlyCostCents: a.hourlyCostCents, updatedBy: actorId(actor), updatedAt: Date.now() })
        else await db.insert("staffing_invoicing_wageRates", { workerId: a.workerId, hourlyCostCents: a.hourlyCostCents, updatedBy: actorId(actor), updatedAt: Date.now() })
        await recordAudit(sys, actor, { action: "staffing-invoicing.wage_rate.update", targetType: "staffing_workers", targetId: a.workerId, changes: { hourlyCostCents: a.hourlyCostCents } })
        return { operationId: op }
      },
    }),

    /** One project's profitability: totals, costs by category (wages computed), weekly value of hours vs costs, cost entries and approved purchase invoices. */
    projectProfitability: queryGeneric({
      args: { ...actorArgs, projectId: v.id("staffing_projects"), ...rangeArgs },
      handler: async (ctx, a) => {
        const { sys } = await system.requirePermission(ctx, P.profitRead, opts(a))
        const range = cleanRange(a, sys.operationId)
        const d = await profitData(ctx, range, a.projectId)
        const row = d.rows[0]
        if (!row) return null
        const db = invReader(ctx)
        const costs = await db
          .query("staffing_invoicing_costs")
          .withIndex("by_project_date", (i) => i.eq("projectId", a.projectId).gte("date", range.from).lte("date", range.to))
          .collect()
        const purchases = (
          await db
            .query("staffing_invoicing_purchases")
            .withIndex("by_project", (i) => i.eq("projectId", a.projectId).gte("issueDate", range.from).lte("issueDate", range.to))
            .collect()
        ).filter((p) => p.status === "approved")
        const byCategory = d.costsByCategory.get(a.projectId) ?? (Object.fromEntries(COST_CATEGORIES.map((c) => [c, 0])) as Record<CostCategory, number>)
        const entries = [
          ...costs.map((c) => ({ id: c._id as string, kind: "cost" as const, category: c.category, date: c.date, amountCents: c.amountCents, note: c.note })),
          ...purchases.map((p) => ({ id: p._id as string, kind: "purchase" as const, category: p.category, date: p.issueDate, amountCents: p.netCents, note: `${p.supplierName} ${p.number}` })),
        ]
        return {
          ...row,
          byCategory,
          weeks: d.series.get(a.projectId) ?? [],
          costs: entries.sort((x, y) => y.date.localeCompare(x.date)),
        }
      },
    }),

    // ---------------------------------------------------------------- the closed process (chain)

    /**
     * "Uždarytas procesas": for every client billing period of the last
     * `months` months, hours recorded → week approved → client timesheet
     * received → reconciled → invoice drafted → approved → sent → paid, with
     * alerts for periods that ended long ago without an issued invoice.
     */
    chain: queryGeneric({
      args: { ...actorArgs, months: v.optional(v.number()) },
      handler: async (ctx, a) => {
        const { sys } = await system.requirePermission(ctx, P.invoiceRead, opts(a))
        const months = a.months ?? 6
        if (!Number.isInteger(months) || months < 1 || months > 24) fail("VALIDATION", "invalid_months", sys.operationId, ["months"])
        const today = todayIso()
        const rows = await chainOverview(ctx, { today, months, alertAfterDays })
        const alerts = chainAlerts(rows)
        const lastRun = await invReader(ctx).query("staffing_invoicing_chainRuns").order("desc").first()
        return {
          today,
          alertAfterDays,
          rows,
          alerts,
          atRiskCents: alerts.reduce((s, x) => s + x.atRiskCents, 0),
          lastRun: lastRun ? { date: lastRun.date, trigger: lastRun.trigger, alerts: lastRun.alerts, atRiskCents: lastRun.atRiskCents, status: lastRun.status, error: lastRun.error ?? null, at: lastRun.completedAt ?? lastRun._creationTime } : null,
        }
      },
    }),

    /** The daily missing-invoice check, now (the director gets the n8n notification when something is missing). */
    runChainCheck: mutationGeneric({
      args: { ...actorArgs },
      handler: async (ctx, a) => {
        const { sys, actor } = await system.requirePermission(ctx, P.invoiceManage, opts(a))
        const r = await queueChainCheck(ctx, "manual", actorId(actor))
        await recordAudit(sys, actor, { action: "staffing-invoicing.chain.check", targetType: "staffing_invoicing_chainRuns", targetId: r.runId, changes: { alerts: r.alerts, atRiskCents: r.atRiskCents } })
        return { alerts: r.alerts, atRiskCents: r.atRiskCents, operationId: sys.operationId }
      },
    }),

    /** Daily job (convex/crons.ts): periods that ended more than `missingInvoiceAlertDays` ago without an issued invoice → the director. */
    _dailyChainCheck: internalMutationGeneric({
      args: {},
      handler: async (ctx): Promise<{ alerts: number; skipped?: string }> => {
        const { sys } = await system.context(ctx)
        for (const m of [STAFFING_MODULE_ID, STAFFING_INVOICING_MODULE_ID]) {
          const row = await sys.store.get("modules", m)
          if (!row?.enabled || !row.present) return { alerts: 0, skipped: `module_disabled:${m}` }
        }
        const r = await queueChainCheck(ctx, "cron", "system")
        if (r.alerts) await recordAudit(sys, "system", { action: "staffing-invoicing.chain.check", targetType: "staffing_invoicing_chainRuns", targetId: r.runId, changes: { alerts: r.alerts, atRiskCents: r.atRiskCents, trigger: "cron" } })
        return { alerts: r.alerts }
      },
    }),

    /** Posts the missing-invoice summary to n8n `dr-nuoma-pranesimas` (to INVOICING_DIRECTOR_EMAIL; outside production redirected to the first super user). */
    _deliverChainAlert: internalActionGeneric({
      args: { runId: v.id("staffing_invoicing_chainRuns"), payload: v.object({ title: v.string(), text: v.string(), lines: v.array(v.string()) }) },
      handler: async (ctx, a) => {
        const done = (status: "sent" | "failed" | "not_configured", extra: { to?: string; error?: string } = {}) => ctx.runMutation(chainResultRef as never, { runId: a.runId, status, ...extra } as never)
        const url = process.env.N8N_URL
        const secret = process.env.N8N_WEBHOOK_SECRET
        if (!url || !secret) return done("not_configured")
        const production = process.env.APP_ENV === "production"
        const redirectTo = production ? undefined : (process.env.SUPER_USER_EMAILS ?? "").split(",").map((s) => s.trim()).find(Boolean)
        const to = process.env.INVOICING_DIRECTOR_EMAIL ?? redirectTo
        if (!to) return done("failed", { error: "no_director_email" })
        const site = process.env.SITE_URL
        const body = { ...a.payload, to, ...(redirectTo ? { redirectTo } : {}), ...(site ? { appUrl: `${site.replace(/\/$/, "")}/app/invoicing/chain` } : {}) }
        try {
          const res = await fetch(`${url.replace(/\/$/, "")}/webhook/dr-nuoma-pranesimas`, { method: "POST", headers: { "Content-Type": "application/json", "X-Webhook-Secret": secret }, body: JSON.stringify(body) })
          if (!res.ok) return done("failed", { to, error: `http_${res.status}` })
          return done("sent", { to })
        } catch (e) {
          return done("failed", { to, error: String(e).slice(0, 200) })
        }
      },
    }),

    _chainRunResult: internalMutationGeneric({
      args: { runId: v.id("staffing_invoicing_chainRuns"), status: v.union(v.literal("sent"), v.literal("failed"), v.literal("not_configured")), to: v.optional(v.string()), error: v.optional(v.string()) },
      handler: async (ctx, a) => {
        const db = invWriter(ctx)
        if (!(await db.get("staffing_invoicing_chainRuns", a.runId))) return
        await db.patch("staffing_invoicing_chainRuns", a.runId, { status: a.status, ...(a.to ? { to: a.to } : {}), ...(a.error ? { error: a.error } : {}), completedAt: Date.now() })
      },
    }),

    // ---------------------------------------------------------------- purchase invoices

    ...definePurchases(system, { functionsPath: path }),

    // ---------------------------------------------------------------- SitePro export

    /** SitePro (B1) import file for one issued invoice, or every issued invoice with issue date in `[from, to]`. */
    siteProExport: queryGeneric({
      args: { ...actorArgs, invoiceId: v.optional(v.id("staffing_invoicing_invoices")), from: v.optional(v.string()), to: v.optional(v.string()) },
      handler: async (ctx, a): Promise<{ fileName: string; csv: string; count: number }> => {
        const { sys } = await system.requirePermission(ctx, P.invoiceRead, opts(a))
        const op = sys.operationId
        const db = invReader(ctx)
        let rows: InvoiceDoc[]
        if (a.invoiceId) {
          const inv = await invoiceOr404(ctx, a.invoiceId, op)
          if (inv.status === "draft") fail("CONFLICT", "invoice_not_approved", op)
          rows = [inv]
        } else {
          const from = cleanDate(a.from, "from", op) ?? "0000-01-01"
          const to = cleanDate(a.to, "to", op) ?? "9999-12-31"
          rows = await db
            .query("staffing_invoicing_invoices")
            .withIndex("by_issue", (i) => i.gte("issueDate", from).lte("issueDate", to))
            .collect()
          rows = rows.filter((r) => r.status !== "draft").sort((x, y) => (x.number ?? "").localeCompare(y.number ?? ""))
        }
        const invoices: SiteProInvoice[] = []
        for (const r of rows) invoices.push(await siteProInvoice(ctx, r))
        const name = a.invoiceId ? (rows[0]!.number ?? "saskaita") : `${a.from ?? "visos"}_${a.to ?? todayIso()}`
        return { fileName: `SitePro_importas_${name}.csv`, csv: siteProCsv(invoices), count: invoices.length }
      },
    }),

    ...defineInvoicingSeed(prefix),
  }
}

export type InvoicingFunctions = ReturnType<typeof defineInvoicing>
export type { InvoiceStatus }
