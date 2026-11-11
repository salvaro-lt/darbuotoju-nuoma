// The staffing base's guarded Convex functions. Each one: guard
// (permission + module enabled) → object checks → write → audit, and returns
// `operationId`. Re-export them from the app's `convex/staffing.ts`.
import { mutationGeneric, queryGeneric } from "convex/server"
import { v } from "convex/values"
import { decide, recordAudit, type ConvexSystem } from "@digimuza/system-core/convex"
import { StaffingPermissions as P } from "./manifest"
import {
  assignmentViews,
  certificateTypeView,
  getWorkerCard,
  listAvailableWorkers,
  loadCatalog,
  projectTeam,
  tradeView,
  workerSummaries,
  type AssignmentView,
  type AvailableWorker,
  type CertificateTypeView,
  type TeamMember,
  type TradeView,
  type WorkerCard,
  type WorkerSummary,
} from "./operations"
import { defaultExpiry, fold, isBlockingAssignment, OPEN_PROJECT_STATUSES, rangesOverlap, todayIso, type AssignmentStatus } from "./pure"
import {
  actorArgs,
  actorId,
  checkRange,
  cleanCents,
  cleanCode,
  cleanCountry,
  cleanDate,
  cleanText,
  EMAIL,
  fail,
  LANGUAGE,
  opts,
  readerOf,
  writerOf,
  type ClientDoc,
  type ProjectDoc,
  type WorkerDoc,
  workerSearchText,
} from "./shared"
import {
  assignmentStatusValidator,
  certAppliesToValidator,
  clientContactValidator,
  clientKindValidator,
  clothingSizesValidator,
  invoicingPeriodValidator,
  projectStatusValidator,
  tradeLevelValidator,
  tradeRateValidator,
  workerSourceValidator,
  workerStatusValidator,
  workerTradeValidator,
} from "./tables"
import { defineSeed } from "./seed"

export interface StaffingOptions {
  /** Rows read by list queries before filtering. Default 2000. */
  scanLimit?: number
}

export interface ClientView {
  id: ClientDoc["_id"]
  name: string
  code: string
  kind: ClientDoc["kind"]
  country: string
  vatCode: string | null
  companyCode: string | null
  address: string | null
  contacts: ClientDoc["contacts"]
  defaultRates: ClientDoc["defaultRates"]
  currency: string
  paymentTermsDays: number
  invoicingPeriod: ClientDoc["invoicingPeriod"]
  notes: string
  projectCount: number
  workerCount: number
}
export interface ProjectView {
  id: ProjectDoc["_id"]
  clientId: ProjectDoc["clientId"]
  clientName: string
  name: string
  code: string
  country: string
  city: string
  siteAddress: string | null
  startDate: string
  endDate: string | null
  status: ProjectDoc["status"]
  coordinatorUserId: string | null
  rates: ProjectDoc["rates"]
  currency: string
  notes: string
  /** Workers with a confirmed or active assignment covering today. */
  headcountToday: number
}
export interface ProjectDetail {
  project: ProjectView
  team: TeamMember[]
}

const MAX_NAME = 120
const MAX_NOTES = 5000

const clientView = (c: ClientDoc, counts: { projects: number; workers: number }): ClientView => ({
  id: c._id,
  name: c.name,
  code: c.code,
  kind: c.kind,
  country: c.country,
  vatCode: c.vatCode ?? null,
  companyCode: c.companyCode ?? null,
  address: c.address ?? null,
  contacts: c.contacts,
  defaultRates: c.defaultRates,
  currency: c.currency,
  paymentTermsDays: c.paymentTermsDays,
  invoicingPeriod: c.invoicingPeriod,
  notes: c.notes,
  projectCount: counts.projects,
  workerCount: counts.workers,
})

export function defineStaffing(system: ConvexSystem, options: StaffingOptions = {}) {
  const scanLimit = Math.min(Math.max(options.scanLimit ?? 2000, 100), 8000)

  // ---------------------------------------------------------------- validation helpers

  function cleanRates(rates: { tradeId: string; hourlyRateCents: number }[], op: string) {
    const seen = new Set<string>()
    for (const r of rates) {
      cleanCents(r.hourlyRateCents, "rates", op)
      if (seen.has(r.tradeId)) fail("VALIDATION", "duplicate_trade", op, ["rates"])
      seen.add(r.tradeId)
    }
  }

  async function checkTrades(ctx: { db: unknown }, ids: string[], op: string, field: string) {
    const db = readerOf(ctx)
    for (const id of ids) if (!(await db.get("staffing_trades", id as never))) fail("VALIDATION", "invalid_trade", op, [field])
  }

  async function projectView(ctx: { db: unknown }, p: ProjectDoc, today: string): Promise<ProjectView> {
    const db = readerOf(ctx)
    const client = await db.get("staffing_clients", p.clientId)
    const rows = await db
      .query("staffing_assignments")
      .withIndex("by_project", (q) => q.eq("projectId", p._id).lte("startDate", today))
      .collect()
    const headcount = new Set(rows.filter((a) => isBlockingAssignment(a) && (!a.endDate || a.endDate >= today)).map((a) => a.workerId)).size
    return {
      id: p._id,
      clientId: p.clientId,
      clientName: client?.name ?? "?",
      name: p.name,
      code: p.code,
      country: p.country,
      city: p.city,
      siteAddress: p.siteAddress ?? null,
      startDate: p.startDate,
      endDate: p.endDate ?? null,
      status: p.status,
      coordinatorUserId: p.coordinatorUserId ?? null,
      rates: p.rates,
      currency: p.currency,
      notes: p.notes,
      headcountToday: headcount,
    }
  }

  /** Refuses a blocking assignment that overlaps another blocking one of the same worker. */
  async function checkOverlap(ctx: { db: unknown }, a: { workerId: string; startDate: string; endDate?: string | undefined; status: AssignmentStatus }, op: string, ignoreId?: string) {
    if (!isBlockingAssignment(a)) return
    const rows = await readerOf(ctx)
      .query("staffing_assignments")
      .withIndex("by_worker", (q) => q.eq("workerId", a.workerId as never))
      .collect()
    if (rows.some((o) => o._id !== ignoreId && isBlockingAssignment(o) && rangesOverlap(o, a))) fail("CONFLICT", "worker_busy", op, ["startDate", "endDate"])
  }

  const workerFields = {
    firstName: v.string(),
    lastName: v.string(),
    phone: v.string(),
    email: v.optional(v.string()),
    nationality: v.string(),
    languages: v.array(v.string()),
    source: workerSourceValidator,
    subcontractorClientId: v.optional(v.id("staffing_clients")),
    trades: v.array(workerTradeValidator),
    driverLicenseCategories: v.array(v.string()),
    driverLicenseExpiresAt: v.optional(v.string()),
    clothingSizes: clothingSizesValidator,
    status: workerStatusValidator,
    notes: v.string(),
    homeCountry: v.string(),
    homeCity: v.string(),
  }
  type WorkerInput = Omit<WorkerDoc, "_id" | "_creationTime" | "searchText" | "updatedAt">

  async function cleanWorker(ctx: { db: unknown }, a: WorkerInput, op: string): Promise<WorkerInput> {
    const email = cleanText(a.email, 200, "email", op, false)
    if (email && !EMAIL.test(email)) fail("VALIDATION", "invalid_email", op, ["email"])
    const languages = [...new Set(a.languages.map((l) => l.trim().toLowerCase()).filter(Boolean))]
    if (languages.some((l) => !LANGUAGE.test(l))) fail("VALIDATION", "invalid_languages", op, ["languages"])
    if (a.source === "subcontractor") {
      if (!a.subcontractorClientId) fail("VALIDATION", "missing_subcontractorClientId", op, ["subcontractorClientId"])
      if (!(await readerOf(ctx).get("staffing_clients", a.subcontractorClientId))) fail("VALIDATION", "invalid_subcontractorClientId", op, ["subcontractorClientId"])
    }
    const seen = new Set<string>()
    for (const t of a.trades) {
      if (seen.has(t.tradeId)) fail("VALIDATION", "duplicate_trade", op, ["trades"])
      seen.add(t.tradeId)
    }
    await checkTrades(
      ctx,
      a.trades.map((t) => t.tradeId),
      op,
      "trades",
    )
    const sizes = Object.fromEntries(Object.entries(a.clothingSizes).map(([k, val]) => [k, cleanText(val, 20, k, op, false)]).filter(([, val]) => val)) as WorkerInput["clothingSizes"]
    return {
      firstName: cleanText(a.firstName, MAX_NAME, "firstName", op)!,
      lastName: cleanText(a.lastName, MAX_NAME, "lastName", op)!,
      phone: cleanText(a.phone, 40, "phone", op)!,
      ...(email ? { email } : {}),
      nationality: cleanCountry(a.nationality, "nationality", op),
      languages,
      source: a.source,
      ...(a.source === "subcontractor" ? { subcontractorClientId: a.subcontractorClientId } : {}),
      trades: a.trades,
      driverLicenseCategories: [...new Set(a.driverLicenseCategories.map((c) => c.trim().toUpperCase()).filter(Boolean))],
      ...(cleanDate(a.driverLicenseExpiresAt, "driverLicenseExpiresAt", op) ? { driverLicenseExpiresAt: a.driverLicenseExpiresAt } : {}),
      clothingSizes: sizes,
      status: a.status,
      notes: cleanText(a.notes, MAX_NOTES, "notes", op, false) ?? "",
      homeCountry: cleanCountry(a.homeCountry, "homeCountry", op),
      homeCity: cleanText(a.homeCity, MAX_NAME, "homeCity", op, false) ?? "",
    }
  }

  const clientFields = {
    name: v.string(),
    code: v.string(),
    kind: clientKindValidator,
    country: v.string(),
    vatCode: v.optional(v.string()),
    companyCode: v.optional(v.string()),
    address: v.optional(v.string()),
    contacts: v.array(clientContactValidator),
    defaultRates: v.array(tradeRateValidator),
    currency: v.optional(v.string()),
    paymentTermsDays: v.number(),
    invoicingPeriod: invoicingPeriodValidator,
    notes: v.string(),
  }
  type ClientInput = Omit<ClientDoc, "_id" | "_creationTime" | "updatedAt" | "currency"> & { currency?: string | undefined }

  async function cleanClient(ctx: { db: unknown }, a: ClientInput, op: string, selfId?: string) {
    const code = cleanCode(a.code, "code", op)
    const dup = await readerOf(ctx)
      .query("staffing_clients")
      .withIndex("by_code", (q) => q.eq("code", code))
      .first()
    if (dup && dup._id !== selfId) fail("CONFLICT", "duplicate_code", op, ["code"])
    if (!Number.isInteger(a.paymentTermsDays) || a.paymentTermsDays < 0 || a.paymentTermsDays > 365) fail("VALIDATION", "invalid_paymentTermsDays", op, ["paymentTermsDays"])
    cleanRates(a.defaultRates, op)
    await checkTrades(
      ctx,
      a.defaultRates.map((r) => r.tradeId),
      op,
      "defaultRates",
    )
    const contacts = a.contacts.map((c) => ({
      name: cleanText(c.name, MAX_NAME, "contacts", op)!,
      ...(c.role?.trim() ? { role: c.role.trim() } : {}),
      ...(c.email?.trim() ? { email: c.email.trim() } : {}),
      ...(c.phone?.trim() ? { phone: c.phone.trim() } : {}),
    }))
    return {
      name: cleanText(a.name, 200, "name", op)!,
      code,
      kind: a.kind,
      country: cleanCountry(a.country, "country", op),
      ...(a.vatCode?.trim() ? { vatCode: a.vatCode.trim() } : {}),
      ...(a.companyCode?.trim() ? { companyCode: a.companyCode.trim() } : {}),
      ...(a.address?.trim() ? { address: a.address.trim() } : {}),
      contacts,
      defaultRates: a.defaultRates,
      currency: a.currency?.trim().toUpperCase() || "EUR",
      paymentTermsDays: a.paymentTermsDays,
      invoicingPeriod: a.invoicingPeriod,
      notes: cleanText(a.notes, MAX_NOTES, "notes", op, false) ?? "",
    }
  }

  const projectFields = {
    clientId: v.id("staffing_clients"),
    name: v.string(),
    code: v.string(),
    country: v.string(),
    city: v.string(),
    siteAddress: v.optional(v.string()),
    startDate: v.string(),
    endDate: v.optional(v.string()),
    status: projectStatusValidator,
    coordinatorUserId: v.optional(v.string()),
    rates: v.array(tradeRateValidator),
    currency: v.optional(v.string()),
    notes: v.string(),
  }
  type ProjectInput = Omit<ProjectDoc, "_id" | "_creationTime" | "updatedAt" | "currency"> & { currency?: string | undefined }

  async function cleanProject(ctx: { db: unknown }, a: ProjectInput, op: string, selfId?: string) {
    const db = readerOf(ctx)
    if (!(await db.get("staffing_clients", a.clientId))) fail("VALIDATION", "invalid_client", op, ["clientId"])
    const code = cleanCode(a.code, "code", op)
    const dup = await db
      .query("staffing_projects")
      .withIndex("by_code", (q) => q.eq("code", code))
      .first()
    if (dup && dup._id !== selfId) fail("CONFLICT", "duplicate_code", op, ["code"])
    const startDate = cleanDate(a.startDate, "startDate", op)
    if (!startDate) fail("VALIDATION", "missing_startDate", op, ["startDate"])
    const endDate = cleanDate(a.endDate, "endDate", op)
    checkRange(startDate, endDate, op)
    cleanRates(a.rates, op)
    await checkTrades(
      ctx,
      a.rates.map((r) => r.tradeId),
      op,
      "rates",
    )
    return {
      clientId: a.clientId,
      name: cleanText(a.name, 200, "name", op)!,
      code,
      country: cleanCountry(a.country, "country", op),
      city: cleanText(a.city, MAX_NAME, "city", op)!,
      ...(a.siteAddress?.trim() ? { siteAddress: a.siteAddress.trim() } : {}),
      startDate,
      ...(endDate ? { endDate } : {}),
      status: a.status,
      ...(a.coordinatorUserId ? { coordinatorUserId: a.coordinatorUserId } : {}),
      rates: a.rates,
      currency: a.currency?.trim().toUpperCase() || "EUR",
      notes: cleanText(a.notes, MAX_NOTES, "notes", op, false) ?? "",
    }
  }

  return {
    ...defineSeed(),

    // ---------------------------------------------------------------- catalog

    listTrades: queryGeneric({
      args: { ...actorArgs },
      handler: async (ctx, a): Promise<TradeView[]> => {
        await system.requirePermission(ctx, P.workerRead, opts(a))
        return (await loadCatalog(ctx)).tradeList.map(tradeView)
      },
    }),

    createTrade: mutationGeneric({
      args: { ...actorArgs, code: v.string(), nameLt: v.string(), nameEn: v.string() },
      handler: async (ctx, a) => {
        const { sys, actor } = await system.requirePermission(ctx, P.catalogManage, opts(a))
        const op = sys.operationId
        const db = writerOf(ctx)
        const code = cleanCode(a.code, "code", op)
        if (
          await db
            .query("staffing_trades")
            .withIndex("by_code", (q) => q.eq("code", code))
            .first()
        )
          fail("CONFLICT", "duplicate_code", op, ["code"])
        const last = await db.query("staffing_trades").withIndex("by_position").order("desc").first()
        const id = await db.insert("staffing_trades", { code, nameLt: cleanText(a.nameLt, MAX_NAME, "nameLt", op)!, nameEn: cleanText(a.nameEn, MAX_NAME, "nameEn", op)!, position: (last?.position ?? 0) + 1 })
        await recordAudit(sys, actor, { action: "staffing.trade.create", targetType: "staffing_trades", targetId: id, changes: { code } })
        return { id, operationId: op }
      },
    }),

    updateTrade: mutationGeneric({
      args: { ...actorArgs, tradeId: v.id("staffing_trades"), code: v.string(), nameLt: v.string(), nameEn: v.string() },
      handler: async (ctx, a) => {
        const { sys, actor } = await system.requirePermission(ctx, P.catalogManage, opts(a))
        const op = sys.operationId
        const db = writerOf(ctx)
        const trade = await db.get("staffing_trades", a.tradeId)
        if (!trade) fail("NOT_FOUND", "trade_not_found", op)
        const code = cleanCode(a.code, "code", op)
        const dup = await db
          .query("staffing_trades")
          .withIndex("by_code", (q) => q.eq("code", code))
          .first()
        if (dup && dup._id !== trade._id) fail("CONFLICT", "duplicate_code", op, ["code"])
        await db.patch("staffing_trades", trade._id, { code, nameLt: cleanText(a.nameLt, MAX_NAME, "nameLt", op)!, nameEn: cleanText(a.nameEn, MAX_NAME, "nameEn", op)! })
        await recordAudit(sys, actor, { action: "staffing.trade.update", targetType: "staffing_trades", targetId: trade._id, changes: { code } })
        return { operationId: op }
      },
    }),

    /** Refused (CONFLICT) while an assignment uses the trade. Workers, clients and projects lose it. */
    deleteTrade: mutationGeneric({
      args: { ...actorArgs, tradeId: v.id("staffing_trades") },
      handler: async (ctx, a) => {
        const { sys, actor } = await system.requirePermission(ctx, P.catalogManage, opts(a))
        const op = sys.operationId
        const db = writerOf(ctx)
        const trade = await db.get("staffing_trades", a.tradeId)
        if (!trade) fail("NOT_FOUND", "trade_not_found", op)
        const used = (await db.query("staffing_assignments").take(scanLimit)).some((x) => x.tradeId === trade._id)
        if (used) fail("CONFLICT", "trade_in_use", op)
        for (const w of await db.query("staffing_workers").take(scanLimit))
          if (w.trades.some((t) => t.tradeId === trade._id)) await db.patch("staffing_workers", w._id, { trades: w.trades.filter((t) => t.tradeId !== trade._id) })
        for (const c of await db.query("staffing_clients").collect())
          if (c.defaultRates.some((r) => r.tradeId === trade._id)) await db.patch("staffing_clients", c._id, { defaultRates: c.defaultRates.filter((r) => r.tradeId !== trade._id) })
        for (const p of await db.query("staffing_projects").take(scanLimit))
          if (p.rates.some((r) => r.tradeId === trade._id)) await db.patch("staffing_projects", p._id, { rates: p.rates.filter((r) => r.tradeId !== trade._id) })
        await db.delete("staffing_trades", trade._id)
        await recordAudit(sys, actor, { action: "staffing.trade.delete", targetType: "staffing_trades", targetId: trade._id, changes: { code: trade.code } })
        return { operationId: op }
      },
    }),

    listCertificateTypes: queryGeneric({
      args: { ...actorArgs },
      handler: async (ctx, a): Promise<CertificateTypeView[]> => {
        await system.requirePermission(ctx, P.workerRead, opts(a))
        return (await loadCatalog(ctx)).certificateTypeList.map(certificateTypeView)
      },
    }),

    createCertificateType: mutationGeneric({
      args: { ...actorArgs, name: v.string(), nameEn: v.optional(v.string()), appliesTo: v.optional(certAppliesToValidator), mandatory: v.boolean(), defaultValidityMonths: v.optional(v.number()) },
      handler: async (ctx, a) => {
        const { sys, actor } = await system.requirePermission(ctx, P.catalogManage, opts(a))
        const op = sys.operationId
        const db = writerOf(ctx)
        const name = cleanText(a.name, MAX_NAME, "name", op)!
        if (
          await db
            .query("staffing_certificateTypes")
            .withIndex("by_name", (q) => q.eq("name", name))
            .first()
        )
          fail("CONFLICT", "duplicate_name", op, ["name"])
        if (a.defaultValidityMonths !== undefined && (!Number.isInteger(a.defaultValidityMonths) || a.defaultValidityMonths < 1 || a.defaultValidityMonths > 240)) fail("VALIDATION", "invalid_defaultValidityMonths", op, ["defaultValidityMonths"])
        const last = await db.query("staffing_certificateTypes").withIndex("by_position").order("desc").first()
        const nameEn = cleanText(a.nameEn, MAX_NAME, "nameEn", op, false)
        const id = await db.insert("staffing_certificateTypes", {
          name,
          ...(nameEn ? { nameEn } : {}),
          appliesTo: a.appliesTo ?? "worker",
          mandatory: a.mandatory,
          ...(a.defaultValidityMonths ? { defaultValidityMonths: a.defaultValidityMonths } : {}),
          position: (last?.position ?? 0) + 1,
        })
        await recordAudit(sys, actor, { action: "staffing.certificate_type.create", targetType: "staffing_certificateTypes", targetId: id, changes: { name } })
        return { id, operationId: op }
      },
    }),

    updateCertificateType: mutationGeneric({
      args: { ...actorArgs, certificateTypeId: v.id("staffing_certificateTypes"), name: v.string(), nameEn: v.optional(v.string()), mandatory: v.boolean(), defaultValidityMonths: v.optional(v.number()) },
      handler: async (ctx, a) => {
        const { sys, actor } = await system.requirePermission(ctx, P.catalogManage, opts(a))
        const op = sys.operationId
        const db = writerOf(ctx)
        const type = await db.get("staffing_certificateTypes", a.certificateTypeId)
        if (!type) fail("NOT_FOUND", "certificate_type_not_found", op)
        const name = cleanText(a.name, MAX_NAME, "name", op)!
        const dup = await db
          .query("staffing_certificateTypes")
          .withIndex("by_name", (q) => q.eq("name", name))
          .first()
        if (dup && dup._id !== type._id) fail("CONFLICT", "duplicate_name", op, ["name"])
        if (a.defaultValidityMonths !== undefined && (!Number.isInteger(a.defaultValidityMonths) || a.defaultValidityMonths < 1 || a.defaultValidityMonths > 240)) fail("VALIDATION", "invalid_defaultValidityMonths", op, ["defaultValidityMonths"])
        await db.patch("staffing_certificateTypes", type._id, {
          name,
          nameEn: cleanText(a.nameEn, MAX_NAME, "nameEn", op, false),
          mandatory: a.mandatory,
          defaultValidityMonths: a.defaultValidityMonths || undefined,
        })
        await recordAudit(sys, actor, { action: "staffing.certificate_type.update", targetType: "staffing_certificateTypes", targetId: type._id, changes: { name, mandatory: a.mandatory } })
        return { operationId: op }
      },
    }),

    /** Refused (CONFLICT) while any worker holds a certificate of this type. */
    deleteCertificateType: mutationGeneric({
      args: { ...actorArgs, certificateTypeId: v.id("staffing_certificateTypes") },
      handler: async (ctx, a) => {
        const { sys, actor } = await system.requirePermission(ctx, P.catalogManage, opts(a))
        const op = sys.operationId
        const db = writerOf(ctx)
        const type = await db.get("staffing_certificateTypes", a.certificateTypeId)
        if (!type) fail("NOT_FOUND", "certificate_type_not_found", op)
        const used = await db
          .query("staffing_workerCertificates")
          .withIndex("by_type", (q) => q.eq("certificateTypeId", type._id))
          .first()
        if (used) fail("CONFLICT", "certificate_type_in_use", op)
        await db.delete("staffing_certificateTypes", type._id)
        await recordAudit(sys, actor, { action: "staffing.certificate_type.delete", targetType: "staffing_certificateTypes", targetId: type._id, changes: { name: type.name } })
        return { operationId: op }
      },
    }),

    // ---------------------------------------------------------------- workers

    /** Workers with trades and certificate status on `onDate` (default today). Filters combine. */
    listWorkers: queryGeneric({
      args: {
        ...actorArgs,
        search: v.optional(v.string()),
        status: v.optional(workerStatusValidator),
        source: v.optional(workerSourceValidator),
        tradeId: v.optional(v.id("staffing_trades")),
        onDate: v.optional(v.string()),
      },
      handler: async (ctx, a): Promise<WorkerSummary[]> => {
        const { sys } = await system.requirePermission(ctx, P.workerRead, opts(a))
        const db = readerOf(ctx)
        const onDate = cleanDate(a.onDate, "onDate", sys.operationId) ?? todayIso()
        const search = a.search?.trim()
        let rows: WorkerDoc[]
        if (search)
          rows = await db
            .query("staffing_workers")
            .withSearchIndex("search", (q) => {
              const s = q.search("searchText", fold(search))
              return a.status ? (a.source ? s.eq("status", a.status).eq("source", a.source) : s.eq("status", a.status)) : a.source ? s.eq("source", a.source) : s
            })
            .take(200)
        else if (a.status)
          rows = await db
            .query("staffing_workers")
            .withIndex("by_status", (q) => q.eq("status", a.status!))
            .take(scanLimit)
        else if (a.source)
          rows = await db
            .query("staffing_workers")
            .withIndex("by_source", (q) => q.eq("source", a.source!))
            .take(scanLimit)
        else rows = await db.query("staffing_workers").take(scanLimit)
        rows = rows.filter((w) => (!a.source || w.source === a.source) && (!a.tradeId || w.trades.some((t) => t.tradeId === a.tradeId)))
        if (!search) rows.sort((x, y) => x.lastName.localeCompare(y.lastName) || x.firstName.localeCompare(y.firstName))
        return (await workerSummaries(ctx, rows, { onDate })).map(({ requiredCertStatus: _ignored, ...w }) => w)
      },
    }),

    /** The worker card (`getWorkerCard`); assignments only for those who may read them. */
    getWorker: queryGeneric({
      args: { ...actorArgs, workerId: v.id("staffing_workers"), onDate: v.optional(v.string()) },
      handler: async (ctx, a): Promise<WorkerCard | null> => {
        const { sys } = await system.requirePermission(ctx, P.workerRead, opts(a))
        const onDate = cleanDate(a.onDate, "onDate", sys.operationId)
        return getWorkerCard(ctx, a.workerId, onDate ? { onDate } : {})
      },
    }),

    findAvailableWorkers: queryGeneric({
      args: {
        ...actorArgs,
        from: v.string(),
        to: v.optional(v.string()),
        trades: v.optional(v.array(v.id("staffing_trades"))),
        minLevel: v.optional(tradeLevelValidator),
        requireValidCertsOn: v.optional(v.string()),
        requiredCertificateTypeIds: v.optional(v.array(v.id("staffing_certificateTypes"))),
        source: v.optional(workerSourceValidator),
        ignoreAssignmentIds: v.optional(v.array(v.id("staffing_assignments"))),
      },
      handler: async (ctx, a): Promise<AvailableWorker[]> => {
        const { sys } = await system.requirePermission(ctx, P.workerRead, opts(a))
        const op = sys.operationId
        const from = cleanDate(a.from, "from", op)!
        const to = cleanDate(a.to, "to", op)
        checkRange(from, to, op, "to")
        const { apiKey: _k, operationId: _o, ...query } = a
        return listAvailableWorkers(ctx, { ...query, from, to, requireValidCertsOn: cleanDate(a.requireValidCertsOn, "requireValidCertsOn", op) })
      },
    }),

    createWorker: mutationGeneric({
      args: { ...actorArgs, ...workerFields },
      handler: async (ctx, a) => {
        const { sys, actor } = await system.requirePermission(ctx, P.workerCreate, opts(a))
        const op = sys.operationId
        const { apiKey: _k, operationId: _o, ...input } = a
        const w = await cleanWorker(ctx, input, op)
        const id = await writerOf(ctx).insert("staffing_workers", { ...w, searchText: workerSearchText(w), updatedAt: Date.now() })
        await recordAudit(sys, actor, { action: "staffing.worker.create", targetType: "staffing_workers", targetId: id, changes: { source: w.source } })
        return { id, operationId: op }
      },
    }),

    /** Replaces the worker's details (send every field). */
    updateWorker: mutationGeneric({
      args: { ...actorArgs, workerId: v.id("staffing_workers"), ...workerFields },
      handler: async (ctx, a) => {
        const { sys, actor } = await system.requirePermission(ctx, P.workerUpdate, opts(a))
        const op = sys.operationId
        const db = writerOf(ctx)
        const current = await db.get("staffing_workers", a.workerId)
        if (!current) fail("NOT_FOUND", "worker_not_found", op)
        const { apiKey: _k, operationId: _o, workerId: _w, ...input } = a
        const w = await cleanWorker(ctx, input, op)
        await db.replace("staffing_workers", current._id, { ...w, searchText: workerSearchText(w), updatedAt: Date.now() })
        const changed = (Object.keys(w) as (keyof typeof w)[]).filter((k) => JSON.stringify(w[k]) !== JSON.stringify(current[k]))
        await recordAudit(sys, actor, { action: "staffing.worker.update", targetType: "staffing_workers", targetId: current._id, changes: { fields: changed } })
        return { operationId: op }
      },
    }),

    /** Only workers without assignments (set them `inactive` instead); their certificates go too. */
    deleteWorker: mutationGeneric({
      args: { ...actorArgs, workerId: v.id("staffing_workers") },
      handler: async (ctx, a) => {
        const { sys, actor } = await system.requirePermission(ctx, P.workerDelete, opts(a))
        const op = sys.operationId
        const db = writerOf(ctx)
        const w = await db.get("staffing_workers", a.workerId)
        if (!w) fail("NOT_FOUND", "worker_not_found", op)
        const assigned = await db
          .query("staffing_assignments")
          .withIndex("by_worker", (q) => q.eq("workerId", w._id))
          .first()
        if (assigned) fail("CONFLICT", "worker_has_assignments", op)
        for (const c of await db
          .query("staffing_workerCertificates")
          .withIndex("by_worker", (q) => q.eq("workerId", w._id))
          .collect()) {
          if (c.fileStorageId) await ctx.storage.delete(c.fileStorageId)
          await db.delete("staffing_workerCertificates", c._id)
        }
        await db.delete("staffing_workers", w._id)
        await recordAudit(sys, actor, { action: "staffing.worker.delete", targetType: "staffing_workers", targetId: w._id })
        return { operationId: op }
      },
    }),

    // ---------------------------------------------------------------- certificates

    generateCertificateUploadUrl: mutationGeneric({
      args: { ...actorArgs },
      handler: async (ctx, a): Promise<string> => {
        await system.requirePermission(ctx, P.workerUpdate, opts(a))
        return ctx.storage.generateUploadUrl()
      },
    }),

    getCertificateFileUrl: queryGeneric({
      args: { ...actorArgs, certificateId: v.id("staffing_workerCertificates") },
      handler: async (ctx, a): Promise<string | null> => {
        await system.requirePermission(ctx, P.workerRead, opts(a))
        const c = await readerOf(ctx).get("staffing_workerCertificates", a.certificateId)
        return c?.fileStorageId ? ctx.storage.getUrl(c.fileStorageId) : null
      },
    }),

    /** Adds a certificate (a renewal is a new one). `expiresAt` defaults from the type's validity. */
    addWorkerCertificate: mutationGeneric({
      args: {
        ...actorArgs,
        workerId: v.id("staffing_workers"),
        certificateTypeId: v.id("staffing_certificateTypes"),
        number: v.optional(v.string()),
        issuedAt: v.optional(v.string()),
        expiresAt: v.optional(v.string()),
        fileStorageId: v.optional(v.id("_storage")),
        fileName: v.optional(v.string()),
        notes: v.optional(v.string()),
      },
      handler: async (ctx, a) => {
        const { sys, actor } = await system.requirePermission(ctx, P.workerUpdate, opts(a))
        const op = sys.operationId
        const db = writerOf(ctx)
        if (!(await db.get("staffing_workers", a.workerId))) fail("NOT_FOUND", "worker_not_found", op)
        const type = await db.get("staffing_certificateTypes", a.certificateTypeId)
        if (!type) fail("VALIDATION", "invalid_certificateTypeId", op, ["certificateTypeId"])
        const issuedAt = cleanDate(a.issuedAt, "issuedAt", op)
        let expiresAt = cleanDate(a.expiresAt, "expiresAt", op)
        if (!expiresAt) expiresAt = defaultExpiry(issuedAt, type.defaultValidityMonths)
        if (issuedAt && expiresAt) checkRange(issuedAt, expiresAt, op, "expiresAt")
        if (a.fileStorageId && !(await db.system.get(a.fileStorageId))) fail("VALIDATION", "invalid_file", op, ["fileStorageId"])
        const number = cleanText(a.number, 100, "number", op, false)
        const fileName = cleanText(a.fileName, 200, "fileName", op, false)
        const notes = cleanText(a.notes, MAX_NOTES, "notes", op, false)
        const id = await db.insert("staffing_workerCertificates", {
          workerId: a.workerId,
          certificateTypeId: a.certificateTypeId,
          ...(number ? { number } : {}),
          ...(issuedAt ? { issuedAt } : {}),
          ...(expiresAt ? { expiresAt } : {}),
          ...(a.fileStorageId ? { fileStorageId: a.fileStorageId } : {}),
          ...(fileName ? { fileName } : {}),
          ...(notes ? { notes } : {}),
          updatedAt: Date.now(),
        })
        await recordAudit(sys, actor, { action: "staffing.certificate.create", targetType: "staffing_workerCertificates", targetId: id, changes: { workerId: a.workerId, type: type.name, expiresAt: expiresAt ?? null } })
        return { id, operationId: op }
      },
    }),

    /** Replaces number, dates, notes; a new `fileStorageId` replaces the file, `removeFile` drops it. */
    updateWorkerCertificate: mutationGeneric({
      args: {
        ...actorArgs,
        certificateId: v.id("staffing_workerCertificates"),
        number: v.optional(v.string()),
        issuedAt: v.optional(v.string()),
        expiresAt: v.optional(v.string()),
        fileStorageId: v.optional(v.id("_storage")),
        fileName: v.optional(v.string()),
        removeFile: v.optional(v.boolean()),
        notes: v.optional(v.string()),
      },
      handler: async (ctx, a) => {
        const { sys, actor } = await system.requirePermission(ctx, P.workerUpdate, opts(a))
        const op = sys.operationId
        const db = writerOf(ctx)
        const c = await db.get("staffing_workerCertificates", a.certificateId)
        if (!c) fail("NOT_FOUND", "certificate_not_found", op)
        const issuedAt = cleanDate(a.issuedAt, "issuedAt", op)
        const expiresAt = cleanDate(a.expiresAt, "expiresAt", op)
        if (issuedAt && expiresAt) checkRange(issuedAt, expiresAt, op, "expiresAt")
        if (a.fileStorageId && !(await db.system.get(a.fileStorageId))) fail("VALIDATION", "invalid_file", op, ["fileStorageId"])
        const replaceFile = Boolean(a.fileStorageId) || a.removeFile
        if (replaceFile && c.fileStorageId && c.fileStorageId !== a.fileStorageId) await ctx.storage.delete(c.fileStorageId)
        await db.patch("staffing_workerCertificates", c._id, {
          number: cleanText(a.number, 100, "number", op, false),
          issuedAt,
          expiresAt,
          notes: cleanText(a.notes, MAX_NOTES, "notes", op, false),
          ...(replaceFile ? { fileStorageId: a.fileStorageId, fileName: a.fileStorageId ? cleanText(a.fileName, 200, "fileName", op, false) : undefined } : {}),
          updatedAt: Date.now(),
        })
        await recordAudit(sys, actor, { action: "staffing.certificate.update", targetType: "staffing_workerCertificates", targetId: c._id, changes: { expiresAt: expiresAt ?? null } })
        return { operationId: op }
      },
    }),

    deleteWorkerCertificate: mutationGeneric({
      args: { ...actorArgs, certificateId: v.id("staffing_workerCertificates") },
      handler: async (ctx, a) => {
        const { sys, actor } = await system.requirePermission(ctx, P.workerUpdate, opts(a))
        const op = sys.operationId
        const db = writerOf(ctx)
        const c = await db.get("staffing_workerCertificates", a.certificateId)
        if (!c) fail("NOT_FOUND", "certificate_not_found", op)
        if (c.fileStorageId) await ctx.storage.delete(c.fileStorageId)
        await db.delete("staffing_workerCertificates", c._id)
        await recordAudit(sys, actor, { action: "staffing.certificate.delete", targetType: "staffing_workerCertificates", targetId: c._id, changes: { workerId: c.workerId } })
        return { operationId: op }
      },
    }),

    // ---------------------------------------------------------------- clients

    listClients: queryGeneric({
      args: { ...actorArgs, search: v.optional(v.string()), kind: v.optional(clientKindValidator) },
      handler: async (ctx, a): Promise<ClientView[]> => {
        await system.requirePermission(ctx, P.clientRead, opts(a))
        const db = readerOf(ctx)
        const needle = a.search ? fold(a.search.trim()) : ""
        const rows = (await db.query("staffing_clients").withIndex("by_name").take(scanLimit)).filter(
          (c) => (!a.kind || c.kind === a.kind || c.kind === "both") && (!needle || fold(`${c.name} ${c.code} ${c.vatCode ?? ""}`).includes(needle)),
        )
        return Promise.all(
          rows.map(async (c) => {
            const projects = await db
              .query("staffing_projects")
              .withIndex("by_client", (q) => q.eq("clientId", c._id))
              .collect()
            const workers = await db
              .query("staffing_workers")
              .withIndex("by_subcontractor", (q) => q.eq("subcontractorClientId", c._id))
              .collect()
            return clientView(c, { projects: projects.length, workers: workers.length })
          }),
        )
      },
    }),

    getClient: queryGeneric({
      args: { ...actorArgs, clientId: v.id("staffing_clients") },
      handler: async (ctx, a): Promise<(ClientView & { projects: ProjectView[] }) | null> => {
        await system.requirePermission(ctx, P.clientRead, opts(a))
        const db = readerOf(ctx)
        const c = await db.get("staffing_clients", a.clientId)
        if (!c) return null
        const projects = await db
          .query("staffing_projects")
          .withIndex("by_client", (q) => q.eq("clientId", c._id))
          .order("desc")
          .collect()
        const workers = await db
          .query("staffing_workers")
          .withIndex("by_subcontractor", (q) => q.eq("subcontractorClientId", c._id))
          .collect()
        const today = todayIso()
        return { ...clientView(c, { projects: projects.length, workers: workers.length }), projects: await Promise.all(projects.map((p) => projectView(ctx, p, today))) }
      },
    }),

    createClient: mutationGeneric({
      args: { ...actorArgs, ...clientFields },
      handler: async (ctx, a) => {
        const { sys, actor } = await system.requirePermission(ctx, P.clientCreate, opts(a))
        const op = sys.operationId
        const { apiKey: _k, operationId: _o, ...input } = a
        const c = await cleanClient(ctx, input, op)
        const id = await writerOf(ctx).insert("staffing_clients", { ...c, updatedAt: Date.now() })
        await recordAudit(sys, actor, { action: "staffing.client.create", targetType: "staffing_clients", targetId: id, changes: { code: c.code } })
        return { id, operationId: op }
      },
    }),

    /** Replaces the client's details (send every field). */
    updateClient: mutationGeneric({
      args: { ...actorArgs, clientId: v.id("staffing_clients"), ...clientFields },
      handler: async (ctx, a) => {
        const { sys, actor } = await system.requirePermission(ctx, P.clientUpdate, opts(a))
        const op = sys.operationId
        const db = writerOf(ctx)
        const current = await db.get("staffing_clients", a.clientId)
        if (!current) fail("NOT_FOUND", "client_not_found", op)
        const { apiKey: _k, operationId: _o, clientId: _c, ...input } = a
        const c = await cleanClient(ctx, input, op, current._id)
        await db.replace("staffing_clients", current._id, { ...c, updatedAt: Date.now() })
        await recordAudit(sys, actor, { action: "staffing.client.update", targetType: "staffing_clients", targetId: current._id, changes: { code: c.code } })
        return { operationId: op }
      },
    }),

    /** Refused (CONFLICT) while the client has projects or supplies workers. */
    deleteClient: mutationGeneric({
      args: { ...actorArgs, clientId: v.id("staffing_clients") },
      handler: async (ctx, a) => {
        const { sys, actor } = await system.requirePermission(ctx, P.clientDelete, opts(a))
        const op = sys.operationId
        const db = writerOf(ctx)
        const c = await db.get("staffing_clients", a.clientId)
        if (!c) fail("NOT_FOUND", "client_not_found", op)
        const project = await db
          .query("staffing_projects")
          .withIndex("by_client", (q) => q.eq("clientId", c._id))
          .first()
        const worker = await db
          .query("staffing_workers")
          .withIndex("by_subcontractor", (q) => q.eq("subcontractorClientId", c._id))
          .first()
        if (project || worker) fail("CONFLICT", "client_in_use", op)
        await db.delete("staffing_clients", c._id)
        await recordAudit(sys, actor, { action: "staffing.client.delete", targetType: "staffing_clients", targetId: c._id, changes: { code: c.code } })
        return { operationId: op }
      },
    }),

    // ---------------------------------------------------------------- projects

    listProjects: queryGeneric({
      args: { ...actorArgs, status: v.optional(projectStatusValidator), clientId: v.optional(v.id("staffing_clients")) },
      handler: async (ctx, a): Promise<ProjectView[]> => {
        await system.requirePermission(ctx, P.projectRead, opts(a))
        const db = readerOf(ctx)
        const rows = a.clientId
          ? (
              await db
                .query("staffing_projects")
                .withIndex("by_client", (q) => q.eq("clientId", a.clientId!))
                .order("desc")
                .collect()
            ).filter((p) => !a.status || p.status === a.status)
          : a.status
            ? await db
                .query("staffing_projects")
                .withIndex("by_status", (q) => q.eq("status", a.status!))
                .order("desc")
                .take(scanLimit)
            : (await db.query("staffing_projects").take(scanLimit)).sort((x, y) => y.startDate.localeCompare(x.startDate))
        const today = todayIso()
        return Promise.all(rows.map((p) => projectView(ctx, p, today)))
      },
    }),

    /** The project and its team (`projectTeam`); the team needs assignment read access. */
    getProject: queryGeneric({
      args: { ...actorArgs, projectId: v.id("staffing_projects"), onDate: v.optional(v.string()) },
      handler: async (ctx, a): Promise<ProjectDetail | null> => {
        const { sys, actor } = await system.requirePermission(ctx, P.projectRead, opts(a))
        const p = await readerOf(ctx).get("staffing_projects", a.projectId)
        if (!p) return null
        const canTeam = (await decide(sys, actor, P.assignmentRead)).allowed
        const onDate = cleanDate(a.onDate, "onDate", sys.operationId)
        return { project: await projectView(ctx, p, todayIso()), team: canTeam ? await projectTeam(ctx, p._id, onDate) : [] }
      },
    }),

    createProject: mutationGeneric({
      args: { ...actorArgs, ...projectFields },
      handler: async (ctx, a) => {
        const { sys, actor } = await system.requirePermission(ctx, P.projectCreate, opts(a))
        const op = sys.operationId
        const { apiKey: _k, operationId: _o, ...input } = a
        const p = await cleanProject(ctx, input, op)
        const id = await writerOf(ctx).insert("staffing_projects", { ...p, updatedAt: Date.now() })
        await recordAudit(sys, actor, { action: "staffing.project.create", targetType: "staffing_projects", targetId: id, changes: { code: p.code, clientId: p.clientId } })
        return { id, operationId: op }
      },
    }),

    /** Replaces the project's details (send every field). */
    updateProject: mutationGeneric({
      args: { ...actorArgs, projectId: v.id("staffing_projects"), ...projectFields },
      handler: async (ctx, a) => {
        const { sys, actor } = await system.requirePermission(ctx, P.projectUpdate, opts(a))
        const op = sys.operationId
        const db = writerOf(ctx)
        const current = await db.get("staffing_projects", a.projectId)
        if (!current) fail("NOT_FOUND", "project_not_found", op)
        const { apiKey: _k, operationId: _o, projectId: _p, ...input } = a
        const p = await cleanProject(ctx, input, op, current._id)
        await db.replace("staffing_projects", current._id, { ...p, updatedAt: Date.now() })
        await recordAudit(sys, actor, { action: "staffing.project.update", targetType: "staffing_projects", targetId: current._id, changes: { code: p.code, status: p.status } })
        return { operationId: op }
      },
    }),

    /** Refused (CONFLICT) while the project has assignments (cancel the project instead). */
    deleteProject: mutationGeneric({
      args: { ...actorArgs, projectId: v.id("staffing_projects") },
      handler: async (ctx, a) => {
        const { sys, actor } = await system.requirePermission(ctx, P.projectDelete, opts(a))
        const op = sys.operationId
        const db = writerOf(ctx)
        const p = await db.get("staffing_projects", a.projectId)
        if (!p) fail("NOT_FOUND", "project_not_found", op)
        const used = await db
          .query("staffing_assignments")
          .withIndex("by_project", (q) => q.eq("projectId", p._id))
          .first()
        if (used) fail("CONFLICT", "project_has_assignments", op)
        await db.delete("staffing_projects", p._id)
        await recordAudit(sys, actor, { action: "staffing.project.delete", targetType: "staffing_projects", targetId: p._id, changes: { code: p.code } })
        return { operationId: op }
      },
    }),

    // ---------------------------------------------------------------- assignments

    /** By project or by worker (one of them), oldest start first, cancelled included. */
    listAssignments: queryGeneric({
      args: { ...actorArgs, projectId: v.optional(v.id("staffing_projects")), workerId: v.optional(v.id("staffing_workers")) },
      handler: async (ctx, a): Promise<AssignmentView[]> => {
        const { sys } = await system.requirePermission(ctx, P.assignmentRead, opts(a))
        const db = readerOf(ctx)
        if (!a.projectId === !a.workerId) fail("VALIDATION", "project_or_worker", sys.operationId, ["projectId", "workerId"])
        const rows = a.projectId
          ? await db
              .query("staffing_assignments")
              .withIndex("by_project", (q) => q.eq("projectId", a.projectId!))
              .collect()
          : await db
              .query("staffing_assignments")
              .withIndex("by_worker", (q) => q.eq("workerId", a.workerId!))
              .collect()
        return assignmentViews(ctx, rows)
      },
    }),

    /**
     * Puts a worker on a project. The worker must be active and have the trade;
     * the project must be draft or active; a confirmed or active assignment
     * must not overlap another one of the same worker (CONFLICT `worker_busy`).
     */
    createAssignment: mutationGeneric({
      args: {
        ...actorArgs,
        projectId: v.id("staffing_projects"),
        workerId: v.id("staffing_workers"),
        tradeId: v.id("staffing_trades"),
        startDate: v.string(),
        endDate: v.optional(v.string()),
        status: v.optional(assignmentStatusValidator),
        isDriver: v.optional(v.boolean()),
        notes: v.optional(v.string()),
      },
      handler: async (ctx, a) => {
        const { sys, actor } = await system.requirePermission(ctx, P.assignmentCreate, opts(a))
        const op = sys.operationId
        const db = writerOf(ctx)
        const project = await db.get("staffing_projects", a.projectId)
        if (!project) fail("NOT_FOUND", "project_not_found", op)
        if (!OPEN_PROJECT_STATUSES.includes(project.status)) fail("CONFLICT", "project_closed", op, ["projectId"])
        const worker = await db.get("staffing_workers", a.workerId)
        if (!worker) fail("NOT_FOUND", "worker_not_found", op)
        if (worker.status !== "active") fail("VALIDATION", "worker_inactive", op, ["workerId"])
        if (!(await db.get("staffing_trades", a.tradeId))) fail("VALIDATION", "invalid_trade", op, ["tradeId"])
        if (!worker.trades.some((t) => t.tradeId === a.tradeId)) fail("VALIDATION", "worker_lacks_trade", op, ["tradeId"])
        const startDate = cleanDate(a.startDate, "startDate", op)
        if (!startDate) fail("VALIDATION", "missing_startDate", op, ["startDate"])
        const endDate = cleanDate(a.endDate, "endDate", op)
        checkRange(startDate, endDate, op)
        const status = a.status ?? "proposed"
        await checkOverlap(ctx, { workerId: worker._id, startDate, endDate, status }, op)
        const id = await db.insert("staffing_assignments", {
          projectId: project._id,
          workerId: worker._id,
          tradeId: a.tradeId,
          startDate,
          ...(endDate ? { endDate } : {}),
          status,
          isDriver: a.isDriver ?? false,
          notes: cleanText(a.notes, MAX_NOTES, "notes", op, false) ?? "",
          createdBy: actorId(actor),
          updatedAt: Date.now(),
        })
        await recordAudit(sys, actor, { action: "staffing.assignment.create", targetType: "staffing_assignments", targetId: id, changes: { projectId: project._id, workerId: worker._id, startDate, endDate: endDate ?? null, status } })
        return { id, operationId: op }
      },
    }),

    /** Changes dates, status, trade, driver flag or notes (only the fields sent). `endDate: null` makes it open-ended. */
    updateAssignment: mutationGeneric({
      args: {
        ...actorArgs,
        assignmentId: v.id("staffing_assignments"),
        tradeId: v.optional(v.id("staffing_trades")),
        startDate: v.optional(v.string()),
        endDate: v.optional(v.union(v.string(), v.null())),
        status: v.optional(assignmentStatusValidator),
        isDriver: v.optional(v.boolean()),
        notes: v.optional(v.string()),
      },
      handler: async (ctx, a) => {
        const { sys, actor } = await system.requirePermission(ctx, P.assignmentUpdate, opts(a))
        const op = sys.operationId
        const db = writerOf(ctx)
        const cur = await db.get("staffing_assignments", a.assignmentId)
        if (!cur) fail("NOT_FOUND", "assignment_not_found", op)
        const worker = await db.get("staffing_workers", cur.workerId)
        const tradeId = a.tradeId ?? cur.tradeId
        if (a.tradeId && !worker?.trades.some((t) => t.tradeId === a.tradeId)) fail("VALIDATION", "worker_lacks_trade", op, ["tradeId"])
        const startDate = a.startDate !== undefined ? cleanDate(a.startDate, "startDate", op) : cur.startDate
        if (!startDate) fail("VALIDATION", "missing_startDate", op, ["startDate"])
        const endDate = a.endDate === null ? undefined : a.endDate !== undefined ? cleanDate(a.endDate, "endDate", op) : cur.endDate
        checkRange(startDate, endDate, op)
        const status = a.status ?? cur.status
        if (status !== cur.status && isBlockingAssignment({ status }) && worker?.status !== "active") fail("VALIDATION", "worker_inactive", op, ["status"])
        await checkOverlap(ctx, { workerId: cur.workerId, startDate, endDate, status }, op, cur._id)
        await db.patch("staffing_assignments", cur._id, {
          tradeId,
          startDate,
          endDate,
          status,
          ...(a.isDriver !== undefined ? { isDriver: a.isDriver } : {}),
          ...(a.notes !== undefined ? { notes: cleanText(a.notes, MAX_NOTES, "notes", op, false) ?? "" } : {}),
          updatedAt: Date.now(),
        })
        await recordAudit(sys, actor, { action: "staffing.assignment.update", targetType: "staffing_assignments", targetId: cur._id, changes: { startDate, endDate: endDate ?? null, status, from: cur.status } })
        return { operationId: op }
      },
    }),

    /** For mistakes. Real changes of plan: status `cancelled` or `ended`. */
    deleteAssignment: mutationGeneric({
      args: { ...actorArgs, assignmentId: v.id("staffing_assignments") },
      handler: async (ctx, a) => {
        const { sys, actor } = await system.requirePermission(ctx, P.assignmentDelete, opts(a))
        const op = sys.operationId
        const db = writerOf(ctx)
        const cur = await db.get("staffing_assignments", a.assignmentId)
        if (!cur) fail("NOT_FOUND", "assignment_not_found", op)
        await db.delete("staffing_assignments", cur._id)
        await recordAudit(sys, actor, { action: "staffing.assignment.delete", targetType: "staffing_assignments", targetId: cur._id, changes: { projectId: cur.projectId, workerId: cur.workerId } })
        return { operationId: op }
      },
    }),
  }
}

export type StaffingFunctions = ReturnType<typeof defineStaffing>
