// Purchase invoices (pirkimo sąskaitos) of the invoicing area: supplier
// invoices arrive by e-mail (a Gavimas inbox linked to the queue, see
// email.ts) or are uploaded; known suppliers queue for the director's
// approval, unknown senders need review first. Approved invoices become
// project costs and are forwarded to the SitePro import address (n8n
// `dr-nuoma-pranesimas`); without that address or n8n they wait as "ready to
// forward". The barrier the director asked for: nothing reaches the
// accountant unapproved.
import { internalActionGeneric, internalMutationGeneric, internalQueryGeneric, makeFunctionReference, mutationGeneric, queryGeneric, type GenericDatabaseWriter } from "convex/server"
import { v } from "convex/values"
import { recordAudit, type ConvexSystem } from "@digimuza/system-core/convex"
import { todayIso } from "../pure"
import { actorArgs, actorId, cleanDate, cleanText, EMAIL, fail, opts, type DbCtxLike } from "../shared"
import { StaffingInvoicingPermissions as P } from "./manifest"
import { invReader, invWriter, type InvoicingDataModel } from "./operations"
import { emailAddressOf, matchSupplier, parseInvoiceEmail, type PurchaseStatus } from "./pure"
import { costCategoryValidator, purchaseStatusValidator } from "./tables"

export type PurchaseDoc = InvoicingDataModel["staffing_invoicing_purchases"]["document"]
export type SupplierDoc = InvoicingDataModel["staffing_invoicing_suppliers"]["document"]
type Writer = GenericDatabaseWriter<InvoicingDataModel>

export interface PurchaseView {
  id: string
  status: PurchaseStatus
  supplierId: string | null
  supplierName: string
  senderEmail: string | null
  knownSender: boolean
  number: string
  issueDate: string
  dueDate: string | null
  netCents: number
  vatCents: number
  totalCents: number
  currency: string
  category: PurchaseDoc["category"]
  projectId: string | null
  projectCode: string | null
  source: PurchaseDoc["source"]
  subject: string | null
  attachmentNames: string[]
  hasFile: boolean
  fileName: string | null
  note: string | null
  rejectReason: string | null
  decidedAt: number | null
  forward: PurchaseDoc["forward"]
  forwardedTo: string | null
  forwardError: string | null
  receivedAt: number
}

/** An e-mail as the purchase queue needs it (from ingest, or the dev simulator). */
export interface PurchaseEmail {
  emailId?: string
  from: string
  fromName?: string
  subject: string
  text: string
  attachmentNames: string[]
  receivedAt: number
}

/**
 * Puts a received e-mail into the queue: `pending` for a known supplier (with
 * its category and default project), `review` for anyone else. Skips an
 * e-mail already queued. Runs inside the caller's transaction.
 */
export async function queuePurchaseEmail(db: Writer, email: PurchaseEmail): Promise<{ id: string; status: PurchaseStatus } | null> {
  if (email.emailId) {
    const dup = await db
      .query("staffing_invoicing_purchases")
      .withIndex("by_email", (i) => i.eq("emailId", email.emailId))
      .first()
    if (dup) return null
  }
  const suppliers = await db.query("staffing_invoicing_suppliers").collect()
  const supplier = matchSupplier(email.from, suppliers)
  const parsed = parseInvoiceEmail(email.subject, email.text)
  const totalCents = parsed.totalCents ?? 0
  const status: PurchaseStatus = supplier ? "pending" : "review"
  const id = await db.insert("staffing_invoicing_purchases", {
    ...(supplier ? { supplierId: supplier._id } : {}),
    supplierName: supplier?.name ?? email.fromName ?? emailAddressOf(email.from),
    senderEmail: emailAddressOf(email.from),
    number: parsed.number ?? "",
    issueDate: parsed.issueDate ?? todayIso(email.receivedAt),
    netCents: totalCents,
    vatCents: 0,
    totalCents,
    currency: "EUR",
    category: supplier?.category ?? "other",
    ...(supplier?.defaultProjectId ? { projectId: supplier.defaultProjectId } : {}),
    status,
    source: "email",
    subject: email.subject.slice(0, 300),
    ...(email.emailId ? { emailId: email.emailId } : {}),
    attachmentNames: email.attachmentNames.slice(0, 20),
    forward: "none",
    createdBy: "ingest",
    updatedAt: Date.now(),
  })
  return { id, status }
}

export interface PurchaseOptions {
  /** File name of the app's `convex/<file>.ts` exporting these functions. Default `invoicing`. */
  functionsPath?: string
}

export function definePurchases(system: ConvexSystem, options: PurchaseOptions = {}) {
  const path = options.functionsPath ?? "invoicing"
  const forwardRef = makeFunctionReference<"action">(`${path}:_forwardPurchase`)
  const forwardResultRef = makeFunctionReference<"mutation">(`${path}:_forwardPurchaseResult`)

  async function purchaseOr404(ctx: DbCtxLike, id: PurchaseDoc["_id"], op: string): Promise<PurchaseDoc> {
    const p = await invReader(ctx).get("staffing_invoicing_purchases", id)
    if (!p) fail("NOT_FOUND", "purchase_not_found", op)
    return p
  }

  function cleanMoney(n: number | undefined, field: string, op: string, allowZero = true): number {
    const x = n ?? 0
    if (!Number.isInteger(x) || x < 0 || x > 100_000_000_00 || (!allowZero && x === 0)) fail("VALIDATION", `invalid_${field}`, op, [field])
    return x
  }

  async function view(ctx: DbCtxLike, p: PurchaseDoc): Promise<PurchaseView> {
    const project = p.projectId ? await invReader(ctx).get("staffing_projects", p.projectId) : null
    return {
      id: p._id,
      status: p.status,
      supplierId: p.supplierId ?? null,
      supplierName: p.supplierName,
      senderEmail: p.senderEmail ?? null,
      knownSender: !!p.supplierId,
      number: p.number,
      issueDate: p.issueDate,
      dueDate: p.dueDate ?? null,
      netCents: p.netCents,
      vatCents: p.vatCents,
      totalCents: p.totalCents,
      currency: p.currency,
      category: p.category,
      projectId: p.projectId ?? null,
      projectCode: project?.code ?? null,
      source: p.source,
      subject: p.subject ?? null,
      attachmentNames: p.attachmentNames ?? [],
      hasFile: !!p.fileStorageId,
      fileName: p.fileName ?? null,
      note: p.note ?? null,
      rejectReason: p.rejectReason ?? null,
      decidedAt: p.decidedAt ?? null,
      forward: p.forward,
      forwardedTo: p.forwardedTo ?? null,
      forwardError: p.forwardError ?? null,
      receivedAt: p._creationTime,
    }
  }

  /** Schedules the SitePro forward, or marks it ready when the address is not configured. */
  async function queueForward(ctx: DbCtxLike & { scheduler: { runAfter: (ms: number, ref: never, args: never) => Promise<unknown> } }, p: PurchaseDoc) {
    await invWriter(ctx).patch("staffing_invoicing_purchases", p._id, { forward: "queued", updatedAt: Date.now() })
    await ctx.scheduler.runAfter(0, forwardRef as never, { purchaseId: p._id } as never)
  }

  const editable = {
    supplierName: v.optional(v.string()),
    supplierId: v.optional(v.id("staffing_invoicing_suppliers")),
    number: v.optional(v.string()),
    issueDate: v.optional(v.string()),
    dueDate: v.optional(v.string()),
    netCents: v.optional(v.number()),
    vatCents: v.optional(v.number()),
    category: v.optional(costCategoryValidator),
    projectId: v.optional(v.union(v.id("staffing_projects"), v.null())),
    note: v.optional(v.string()),
  }

  async function cleanEdit(ctx: DbCtxLike, a: { supplierName?: string | undefined; supplierId?: SupplierDoc["_id"] | undefined; number?: string | undefined; issueDate?: string | undefined; dueDate?: string | undefined; netCents?: number | undefined; vatCents?: number | undefined; projectId?: PurchaseDoc["projectId"] | null; note?: string | undefined }, op: string) {
    const db = invReader(ctx)
    const out: Partial<PurchaseDoc> & { projectId?: PurchaseDoc["projectId"] } = {}
    if (a.supplierId !== undefined) {
      const s = await db.get("staffing_invoicing_suppliers", a.supplierId)
      if (!s) fail("VALIDATION", "invalid_supplierId", op, ["supplierId"])
      out.supplierId = s._id
      out.supplierName = s.name
    }
    if (a.supplierName !== undefined && a.supplierId === undefined) out.supplierName = cleanText(a.supplierName, 200, "supplierName", op)!
    if (a.number !== undefined) out.number = cleanText(a.number, 80, "number", op, false) ?? ""
    if (a.issueDate !== undefined) out.issueDate = cleanDate(a.issueDate, "issueDate", op) ?? todayIso()
    if (a.dueDate !== undefined) out.dueDate = cleanDate(a.dueDate, "dueDate", op)
    if (a.netCents !== undefined) out.netCents = cleanMoney(a.netCents, "netCents", op)
    if (a.vatCents !== undefined) out.vatCents = cleanMoney(a.vatCents, "vatCents", op)
    if (a.projectId !== undefined) {
      if (a.projectId !== null && !(await db.get("staffing_projects", a.projectId))) fail("VALIDATION", "invalid_projectId", op, ["projectId"])
      out.projectId = a.projectId ?? undefined
    }
    if (a.note !== undefined) out.note = cleanText(a.note, 1000, "note", op, false)
    return out
  }

  return {
    /** The queue: every purchase invoice (or one status), newest first, with counts per status. */
    listPurchases: queryGeneric({
      args: { ...actorArgs, status: v.optional(purchaseStatusValidator) },
      handler: async (ctx, a) => {
        await system.requirePermission(ctx, P.invoiceRead, opts(a))
        const db = invReader(ctx)
        const all = await db.query("staffing_invoicing_purchases").collect()
        const counts = { review: 0, pending: 0, approved: 0, rejected: 0 } as Record<PurchaseStatus, number>
        let waitingCents = 0
        let readyToForward = 0
        for (const p of all) {
          counts[p.status]++
          if (p.status === "pending" || p.status === "review") waitingCents += p.totalCents
          if (p.status === "approved" && (p.forward === "ready" || p.forward === "failed")) readyToForward++
        }
        const rows = (a.status ? all.filter((p) => p.status === a.status) : all).sort((x, y) => y._creationTime - x._creationTime)
        const items: PurchaseView[] = []
        for (const p of rows) items.push(await view(ctx, p))
        return { items, counts, waitingCents, readyToForward, siteProConfigured: !!process.env.SITEPRO_IMPORT_EMAIL }
      },
    }),

    getPurchaseFileUrl: queryGeneric({
      args: { ...actorArgs, purchaseId: v.id("staffing_invoicing_purchases") },
      handler: async (ctx, a) => {
        await system.requirePermission(ctx, P.invoiceRead, opts(a))
        const p = await invReader(ctx).get("staffing_invoicing_purchases", a.purchaseId)
        return p?.fileStorageId ? await ctx.storage.getUrl(p.fileStorageId) : null
      },
    }),

    generatePurchaseUploadUrl: mutationGeneric({
      args: { ...actorArgs },
      handler: async (ctx, a) => {
        await system.requirePermission(ctx, P.costManage, opts(a))
        return await ctx.storage.generateUploadUrl()
      },
    }),

    /** A purchase invoice uploaded by hand (PDF from a supplier portal, a paper one scanned): waits for approval. */
    createPurchase: mutationGeneric({
      args: { ...actorArgs, ...editable, category: costCategoryValidator, fileStorageId: v.optional(v.id("_storage")), fileName: v.optional(v.string()) },
      handler: async (ctx, a) => {
        const { sys, actor } = await system.requirePermission(ctx, P.costManage, opts(a))
        const op = sys.operationId
        if (!a.supplierId && !a.supplierName?.trim()) fail("VALIDATION", "missing_supplier", op, ["supplierName"])
        const e = await cleanEdit(ctx, a, op)
        const netCents = e.netCents ?? 0
        const vatCents = e.vatCents ?? 0
        const id = await invWriter(ctx).insert("staffing_invoicing_purchases", {
          ...(e.supplierId ? { supplierId: e.supplierId } : {}),
          supplierName: e.supplierName!,
          number: e.number ?? "",
          issueDate: e.issueDate ?? todayIso(),
          ...(e.dueDate ? { dueDate: e.dueDate } : {}),
          netCents,
          vatCents,
          totalCents: netCents + vatCents,
          currency: "EUR",
          category: a.category,
          ...(e.projectId ? { projectId: e.projectId } : {}),
          status: "pending",
          source: "upload",
          ...(a.fileStorageId ? { fileStorageId: a.fileStorageId, fileName: cleanText(a.fileName, 200, "fileName", op, false) ?? "saskaita.pdf" } : {}),
          ...(e.note ? { note: e.note } : {}),
          forward: "none",
          createdBy: actorId(actor),
          updatedAt: Date.now(),
        })
        await recordAudit(sys, actor, { action: "staffing-invoicing.purchase.create", targetType: "staffing_invoicing_purchases", targetId: id, changes: { supplierName: e.supplierName, totalCents: netCents + vatCents } })
        return { id, operationId: op }
      },
    }),

    /** Fills in or corrects a queued invoice (amounts, project, category) before the decision. */
    updatePurchase: mutationGeneric({
      args: { ...actorArgs, purchaseId: v.id("staffing_invoicing_purchases"), ...editable },
      handler: async (ctx, a) => {
        const { sys, actor } = await system.requirePermission(ctx, P.costManage, opts(a))
        const op = sys.operationId
        const p = await purchaseOr404(ctx, a.purchaseId, op)
        if (p.status !== "pending" && p.status !== "review") fail("CONFLICT", "purchase_decided", op)
        const e = await cleanEdit(ctx, a, op)
        const netCents = e.netCents ?? p.netCents
        const vatCents = e.vatCents ?? p.vatCents
        await invWriter(ctx).patch("staffing_invoicing_purchases", p._id, { ...e, ...(a.category ? { category: a.category } : {}), netCents, vatCents, totalCents: netCents + vatCents, updatedAt: Date.now() })
        await recordAudit(sys, actor, { action: "staffing-invoicing.purchase.update", targetType: "staffing_invoicing_purchases", targetId: p._id, changes: { totalCents: netCents + vatCents, projectId: e.projectId ?? p.projectId ?? null } })
        return { operationId: op }
      },
    }),

    /**
     * An unknown sender turns out to be a real supplier: add the address to a
     * supplier (new or existing) and move the invoice to the approval queue.
     * Their next invoices queue by themselves.
     */
    acceptSender: mutationGeneric({
      args: { ...actorArgs, purchaseId: v.id("staffing_invoicing_purchases"), supplierId: v.optional(v.id("staffing_invoicing_suppliers")), name: v.optional(v.string()), category: v.optional(costCategoryValidator) },
      handler: async (ctx, a) => {
        const { sys, actor } = await system.requirePermission(ctx, P.costManage, opts(a))
        const op = sys.operationId
        const db = invWriter(ctx)
        const p = await purchaseOr404(ctx, a.purchaseId, op)
        if (p.status !== "review") fail("CONFLICT", "purchase_not_in_review", op)
        const address = p.senderEmail
        let supplier = a.supplierId ? await db.get("staffing_invoicing_suppliers", a.supplierId) : null
        if (a.supplierId && !supplier) fail("VALIDATION", "invalid_supplierId", op, ["supplierId"])
        if (supplier) {
          if (address && !supplier.emails.includes(address)) await db.patch("staffing_invoicing_suppliers", supplier._id, { emails: [...supplier.emails, address], updatedAt: Date.now() })
        } else {
          const name = cleanText(a.name ?? p.supplierName, 200, "name", op)!
          const id = await db.insert("staffing_invoicing_suppliers", { name, emails: address ? [address] : [], category: a.category ?? p.category, active: true, updatedAt: Date.now() })
          supplier = (await db.get("staffing_invoicing_suppliers", id))!
        }
        await db.patch("staffing_invoicing_purchases", p._id, { status: "pending", supplierId: supplier._id, supplierName: supplier.name, category: a.category ?? supplier.category, updatedAt: Date.now() })
        await recordAudit(sys, actor, { action: "staffing-invoicing.supplier.accept", targetType: "staffing_invoicing_suppliers", targetId: supplier._id, changes: { address, purchaseId: p._id } })
        return { supplierId: supplier._id, operationId: op }
      },
    }),

    /** The director's barrier: approved invoices become project costs and go to SitePro. */
    approvePurchase: mutationGeneric({
      args: { ...actorArgs, purchaseId: v.id("staffing_invoicing_purchases") },
      handler: async (ctx, a) => {
        const { sys, actor } = await system.requirePermission(ctx, P.purchaseApprove, opts(a))
        const op = sys.operationId
        const p = await purchaseOr404(ctx, a.purchaseId, op)
        if (p.status !== "pending") fail("CONFLICT", p.status === "review" ? "purchase_needs_review" : "purchase_decided", op)
        if (p.totalCents <= 0) fail("VALIDATION", "missing_amount", op, ["netCents"])
        if (!p.number.trim()) fail("VALIDATION", "missing_number", op, ["number"])
        await invWriter(ctx).patch("staffing_invoicing_purchases", p._id, { status: "approved", decidedBy: actorId(actor), decidedAt: Date.now(), updatedAt: Date.now() })
        await queueForward(ctx, p)
        await recordAudit(sys, actor, { action: "staffing-invoicing.purchase.approve", targetType: "staffing_invoicing_purchases", targetId: p._id, changes: { totalCents: p.totalCents, projectId: p.projectId ?? null } })
        return { operationId: op }
      },
    }),

    rejectPurchase: mutationGeneric({
      args: { ...actorArgs, purchaseId: v.id("staffing_invoicing_purchases"), reason: v.optional(v.string()) },
      handler: async (ctx, a) => {
        const { sys, actor } = await system.requirePermission(ctx, P.purchaseApprove, opts(a))
        const op = sys.operationId
        const p = await purchaseOr404(ctx, a.purchaseId, op)
        if (p.status !== "pending" && p.status !== "review") fail("CONFLICT", "purchase_decided", op)
        const reason = cleanText(a.reason, 500, "reason", op, false)
        await invWriter(ctx).patch("staffing_invoicing_purchases", p._id, { status: "rejected", ...(reason ? { rejectReason: reason } : {}), decidedBy: actorId(actor), decidedAt: Date.now(), updatedAt: Date.now() })
        await recordAudit(sys, actor, { action: "staffing-invoicing.purchase.reject", targetType: "staffing_invoicing_purchases", targetId: p._id, changes: { reason: reason ?? null } })
        return { operationId: op }
      },
    }),

    /** Tries the SitePro forward again (after configuring the address, or a failure). */
    forwardPurchase: mutationGeneric({
      args: { ...actorArgs, purchaseId: v.id("staffing_invoicing_purchases") },
      handler: async (ctx, a) => {
        const { sys, actor } = await system.requirePermission(ctx, P.costManage, opts(a))
        const op = sys.operationId
        const p = await purchaseOr404(ctx, a.purchaseId, op)
        if (p.status !== "approved") fail("CONFLICT", "purchase_not_approved", op)
        if (p.forward === "sent" || p.forward === "queued") fail("CONFLICT", "already_forwarded", op)
        await queueForward(ctx, p)
        await recordAudit(sys, actor, { action: "staffing-invoicing.purchase.forward", targetType: "staffing_invoicing_purchases", targetId: p._id })
        return { operationId: op }
      },
    }),

    /** Posts the approved invoice to n8n `dr-nuoma-pranesimas` addressed to SITEPRO_IMPORT_EMAIL; without it (or n8n) marks "ready to forward". */
    _forwardPurchase: internalActionGeneric({
      args: { purchaseId: v.id("staffing_invoicing_purchases") },
      handler: async (ctx, a) => {
        const done = (forward: "sent" | "failed" | "ready", extra: { to?: string; error?: string } = {}) => ctx.runMutation(forwardResultRef as never, { purchaseId: a.purchaseId, forward, ...extra } as never)
        const to = process.env.SITEPRO_IMPORT_EMAIL
        const url = process.env.N8N_URL
        const secret = process.env.N8N_WEBHOOK_SECRET
        if (!to || !url || !secret) return done("ready")
        const p = (await ctx.runQuery(makeFunctionReference<"query">(`${path}:_purchaseForForward`) as never, { purchaseId: a.purchaseId } as never)) as { supplierName: string; number: string; issueDate: string; totalCents: number; vatCents: number; netCents: number; projectCode: string | null; category: string; fileUrl: string | null; senderEmail: string | null } | null
        if (!p) return
        const production = process.env.APP_ENV === "production"
        const redirectTo = production ? undefined : (process.env.SUPER_USER_EMAILS ?? "").split(",").map((s) => s.trim()).find(Boolean)
        const eur = (c: number) => (c / 100).toFixed(2)
        const body = {
          to,
          ...(redirectTo ? { redirectTo } : {}),
          title: `Pirkimo sąskaita: ${p.supplierName} ${p.number}`,
          text: "Direktoriaus patvirtinta pirkimo sąskaita importui į SitePro.",
          lines: [`Tiekėjas: ${p.supplierName}${p.senderEmail ? ` (${p.senderEmail})` : ""}`, `Numeris: ${p.number}`, `Data: ${p.issueDate}`, `Suma be PVM: ${eur(p.netCents)} EUR, PVM: ${eur(p.vatCents)} EUR, iš viso: ${eur(p.totalCents)} EUR`, `Projektas: ${p.projectCode ?? "bendrosios sąnaudos"}`, `Kategorija: ${p.category}`, ...(p.fileUrl ? [`Failas: ${p.fileUrl}`] : [])],
        }
        try {
          const res = await fetch(`${url.replace(/\/$/, "")}/webhook/dr-nuoma-pranesimas`, { method: "POST", headers: { "Content-Type": "application/json", "X-Webhook-Secret": secret }, body: JSON.stringify(body) })
          if (!res.ok) return done("failed", { to, error: `http_${res.status}` })
          return done("sent", { to })
        } catch (e) {
          return done("failed", { to, error: String(e).slice(0, 200) })
        }
      },
    }),

    _purchaseForForward: internalQueryGeneric({
      args: { purchaseId: v.id("staffing_invoicing_purchases") },
      handler: async (ctx, a) => {
        const p = await invReader(ctx).get("staffing_invoicing_purchases", a.purchaseId)
        if (!p) return null
        const project = p.projectId ? await invReader(ctx).get("staffing_projects", p.projectId) : null
        return { supplierName: p.supplierName, number: p.number, issueDate: p.issueDate, totalCents: p.totalCents, vatCents: p.vatCents, netCents: p.netCents, projectCode: project?.code ?? null, category: p.category, fileUrl: p.fileStorageId ? await ctx.storage.getUrl(p.fileStorageId) : null, senderEmail: p.senderEmail ?? null }
      },
    }),

    _forwardPurchaseResult: internalMutationGeneric({
      args: { purchaseId: v.id("staffing_invoicing_purchases"), forward: v.union(v.literal("sent"), v.literal("failed"), v.literal("ready")), to: v.optional(v.string()), error: v.optional(v.string()) },
      handler: async (ctx, a) => {
        const db = invWriter(ctx)
        if (!(await db.get("staffing_invoicing_purchases", a.purchaseId))) return
        await db.patch("staffing_invoicing_purchases", a.purchaseId, { forward: a.forward, ...(a.to ? { forwardedTo: a.to } : {}), forwardError: a.error, ...(a.forward === "sent" ? { forwardedAt: Date.now() } : {}), updatedAt: Date.now() })
      },
    }),

    // ---------------------------------------------------------------- suppliers

    listSuppliers: queryGeneric({
      args: { ...actorArgs },
      handler: async (ctx, a) => {
        await system.requirePermission(ctx, P.invoiceRead, opts(a))
        const db = invReader(ctx)
        const rows = await db.query("staffing_invoicing_suppliers").withIndex("by_name").collect()
        const out = []
        for (const s of rows) {
          const project = s.defaultProjectId ? await db.get("staffing_projects", s.defaultProjectId) : null
          out.push({ id: s._id, name: s.name, emails: s.emails, category: s.category, defaultProjectId: s.defaultProjectId ?? null, defaultProjectCode: project?.code ?? null, vatCode: s.vatCode ?? null, active: s.active })
        }
        return out
      },
    }),

    /** Creates or updates a known supplier (whose e-mailed invoices queue for approval without review). */
    saveSupplier: mutationGeneric({
      args: { ...actorArgs, supplierId: v.optional(v.id("staffing_invoicing_suppliers")), name: v.string(), emails: v.array(v.string()), category: costCategoryValidator, defaultProjectId: v.optional(v.union(v.id("staffing_projects"), v.null())), vatCode: v.optional(v.string()), active: v.boolean() },
      handler: async (ctx, a) => {
        const { sys, actor } = await system.requirePermission(ctx, P.costManage, opts(a))
        const op = sys.operationId
        const db = invWriter(ctx)
        const name = cleanText(a.name, 200, "name", op)!
        const emails = [...new Set(a.emails.map((e) => e.trim().toLowerCase()).filter(Boolean))]
        for (const e of emails) if (!(e.startsWith("@") ? /^@[^\s@]+\.[^\s@]+$/.test(e) : EMAIL.test(e))) fail("VALIDATION", "invalid_emails", op, ["emails"])
        if (a.defaultProjectId && !(await db.get("staffing_projects", a.defaultProjectId))) fail("VALIDATION", "invalid_defaultProjectId", op, ["defaultProjectId"])
        const vatCode = cleanText(a.vatCode, 40, "vatCode", op, false)
        const doc = { name, emails, category: a.category, defaultProjectId: a.defaultProjectId ?? undefined, vatCode, active: a.active, updatedAt: Date.now() }
        let id = a.supplierId
        if (id) {
          if (!(await db.get("staffing_invoicing_suppliers", id))) fail("NOT_FOUND", "supplier_not_found", op)
          await db.patch("staffing_invoicing_suppliers", id, doc)
        } else id = await db.insert("staffing_invoicing_suppliers", { ...doc, defaultProjectId: a.defaultProjectId ?? undefined })
        await recordAudit(sys, actor, { action: a.supplierId ? "staffing-invoicing.supplier.update" : "staffing-invoicing.supplier.create", targetType: "staffing_invoicing_suppliers", targetId: id, changes: { name, emails } })
        return { id, operationId: op }
      },
    }),

    /** Dev only: an e-mail from a supplier as if it arrived in the purchase inbox (demo without Resend). */
    _simulatePurchaseEmail: internalMutationGeneric({
      args: { from: v.string(), fromName: v.optional(v.string()), subject: v.string(), text: v.optional(v.string()), attachmentNames: v.optional(v.array(v.string())) },
      handler: async (ctx, a) => {
        const env = process.env.APP_ENV
        if (!env || env === "production") throw new Error(`invoicing:_simulatePurchaseEmail refuses to run with APP_ENV=${env ?? "(unset)"}`)
        return await queuePurchaseEmail(invWriter(ctx), { from: a.from, ...(a.fromName ? { fromName: a.fromName } : {}), subject: a.subject, text: a.text ?? "", attachmentNames: a.attachmentNames ?? ["saskaita.pdf"], receivedAt: Date.now() })
      },
    }),
  }
}
