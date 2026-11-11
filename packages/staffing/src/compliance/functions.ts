// Guarded Convex functions of the compliance area. Re-export them from the
// app's `convex/compliance.ts`:
//   export const { … } = defineCompliance(system, { companyName: "UAB …" })
import { internalActionGeneric, internalMutationGeneric, internalQueryGeneric, makeFunctionReference, mutationGeneric, queryGeneric } from "convex/server"
import { v, type Infer } from "convex/values"
import { recordAudit, type ConvexSystem } from "@digimuza/system-core/convex"
import { OPEN_PROJECT_STATUSES, todayIso } from "../pure"
import { actorArgs, actorId, cleanCents, cleanCountry, cleanText, fail, opts, writerOf, type ProjectId, type StorageId } from "../shared"
import { StaffingCompliancePermissions as P } from "./manifest"
import {
  complianceReader,
  draftContract,
  expiringWithProjects,
  projectReadiness,
  type ComplianceDataModel,
  type ContractDraft,
  type ExpiringItem,
  type ProjectReadiness,
} from "./operations"
import { pickDigest, digestKey, unknownPlaceholders, type DigestThreshold, type Readiness, type RequirementScope } from "./pure"
import { digestItemValidator, requirementScopeValidator, templateLanguageValidator, type DigestRunStatus } from "./tables"
import { defineComplianceSeed } from "./seed"
import { definePackageFunctions } from "./package-functions"

export interface ComplianceOptions {
  /** Module path (relative to `convex/`) where these functions are exported. Default "compliance". */
  functionsModule?: string
  /** Your company's name for `{{company.name}}` in contracts (and the signature of package emails). */
  companyName?: string
  /** Client document package: attach files up to this many bytes in total (default 15 MB), else a ZIP link. */
  packageCapBytes?: number
  /** Client document package: days a public download link stays valid (default 14). */
  packageLinkDays?: number
}

export interface RequirementView {
  id: string
  certificateTypeId: string
  typeName: string
  typeNameEn: string | null
  country: string | null
  clientId: string | null
  clientName: string | null
  scope: RequirementScope
  note: string | null
}
export interface ReadinessProjectSummary {
  id: ProjectId
  code: string
  name: string
  country: string
  city: string
  clientName: string
  startDate: string
  endDate: string | null
  status: string
  documents: number
  team: number
  readiness: Readiness
  counts: Record<Readiness, number>
}
export interface PackageFile {
  certificateId: string
  workerName: string
  typeName: string
  fileName: string
  url: string | null
}
export interface ProjectPackage extends ProjectReadiness {
  files: PackageFile[]
}
export interface TemplateView {
  id: string
  name: string
  language: "lt" | "en"
  description: string | null
  body: string
  updatedAt: number
  contracts: number
}
export interface ContractView {
  id: string
  title: string
  templateName: string
  language: "lt" | "en"
  workerId: string
  workerName: string
  projectId: string | null
  projectCode: string | null
  missing: string[]
  createdAt: number
}
export interface DigestRunView {
  id: string
  trigger: "cron" | "manual"
  status: DigestRunStatus
  to: string | null
  items: Infer<typeof digestItemValidator>[]
  error: string | null
  createdAt: number
  finishedAt: number | null
}

const MAX_BODY = 30_000
const DIGEST_WEBHOOK = "dr-nuoma-dokumentu-galiojimas"

/** First recipient for the digest: STAFFING_COMPLIANCE_DIGEST_TO, else the first SUPER_USER_EMAILS. */
const digestRecipient = () => (process.env.STAFFING_COMPLIANCE_DIGEST_TO || process.env.SUPER_USER_EMAILS || "").split(",")[0]?.trim() || undefined

export function defineCompliance(system: ConvexSystem, options: ComplianceOptions = {}) {
  const functionsModule = options.functionsModule ?? "compliance"
  const ref = (name: string) => makeFunctionReference<"query" | "mutation" | "action">(`${functionsModule}:${name}`)
  const companyName = options.companyName

  /** Due digest items (not yet reported for their threshold) → a run; schedules delivery. */
  async function startDigest(ctx: { db: unknown; scheduler: { runAfter: (ms: number, fn: never, args: never) => Promise<unknown> } }, trigger: "cron" | "manual") {
    const db = writerOf<ComplianceDataModel>(ctx)
    const today = todayIso()
    const expiring = await expiringWithProjects(ctx, { today, days: 60 })
    const sent = new Set<string>()
    for (const e of expiring)
      for (const row of await db
        .query("staffing_compliance_digestLog")
        .withIndex("by_certificate", (q) => q.eq("certificateId", e.certificateId))
        .collect())
        sent.add(digestKey(row.certificateId, row.threshold))
    const due = pickDigest(
      expiring.map((e) => ({ ...e, certificateId: e.certificateId as string })),
      today,
      sent,
    )
    const items = due.map((d) => ({
      certificateId: d.certificateId as ExpiringItem["certificateId"],
      threshold: d.threshold,
      worker: d.workerName,
      document: d.typeName,
      expiresAt: d.expiresAt,
      daysLeft: d.daysLeft,
      ...(d.project ? { currentProject: `${d.project.code} ${d.project.name}` } : {}),
    }))
    const to = digestRecipient()
    const runId = await db.insert("staffing_compliance_digestRuns", { trigger, status: items.length ? "pending" : "empty", ...(to ? { to } : {}), items, ...(items.length ? {} : { finishedAt: Date.now() }) })
    if (items.length) await ctx.scheduler.runAfter(0, ref("_deliverDigest") as never, { runId } as never)
    return { runId, items: items.length }
  }

  return {
    // ---------------------------------------------------------------- requirements

    listRequirements: queryGeneric({
      args: { ...actorArgs },
      handler: async (ctx, a): Promise<RequirementView[]> => {
        await system.requirePermission(ctx, P.readinessRead, opts(a))
        const db = complianceReader(ctx)
        const rows = await db.query("staffing_compliance_requirements").take(2000)
        const types = new Map((await db.query("staffing_certificateTypes").collect()).map((t) => [t._id as string, t]))
        const clients = new Map((await db.query("staffing_clients").collect()).map((c) => [c._id as string, c]))
        return rows
          .map((r) => ({
            id: r._id,
            certificateTypeId: r.certificateTypeId,
            typeName: types.get(r.certificateTypeId)?.name ?? "?",
            typeNameEn: types.get(r.certificateTypeId)?.nameEn ?? null,
            country: r.country ?? null,
            clientId: r.clientId ?? null,
            clientName: (r.clientId && clients.get(r.clientId)?.name) || null,
            scope: r.scope,
            note: r.note ?? null,
            position: types.get(r.certificateTypeId)?.position ?? 0,
          }))
          .sort((x, y) => (x.country ?? "~").localeCompare(y.country ?? "~") || (x.clientName ?? "").localeCompare(y.clientName ?? "") || x.position - y.position)
          .map(({ position: _p, ...r }) => r)
      },
    }),

    addRequirement: mutationGeneric({
      args: { ...actorArgs, certificateTypeId: v.id("staffing_certificateTypes"), country: v.optional(v.string()), clientId: v.optional(v.id("staffing_clients")), scope: requirementScopeValidator, note: v.optional(v.string()) },
      handler: async (ctx, a) => {
        const { sys, actor } = await system.requirePermission(ctx, P.requirementManage, opts(a))
        const op = sys.operationId
        const db = writerOf<ComplianceDataModel>(ctx)
        if (Boolean(a.country) === Boolean(a.clientId)) fail("VALIDATION", "country_or_client", op, ["country", "clientId"])
        if (!(await db.get("staffing_certificateTypes", a.certificateTypeId))) fail("VALIDATION", "invalid_certificateTypeId", op, ["certificateTypeId"])
        const country = a.country ? cleanCountry(a.country, "country", op) : undefined
        if (a.clientId && !(await db.get("staffing_clients", a.clientId))) fail("VALIDATION", "invalid_clientId", op, ["clientId"])
        const dup = country
          ? await db
              .query("staffing_compliance_requirements")
              .withIndex("by_country", (q) => q.eq("country", country).eq("certificateTypeId", a.certificateTypeId))
              .first()
          : await db
              .query("staffing_compliance_requirements")
              .withIndex("by_client", (q) => q.eq("clientId", a.clientId).eq("certificateTypeId", a.certificateTypeId))
              .first()
        if (dup) fail("CONFLICT", "duplicate_requirement", op, ["certificateTypeId"])
        const note = cleanText(a.note, 500, "note", op, false)
        const id = await db.insert("staffing_compliance_requirements", {
          certificateTypeId: a.certificateTypeId,
          ...(country ? { country } : {}),
          ...(a.clientId ? { clientId: a.clientId } : {}),
          scope: a.scope,
          ...(note ? { note } : {}),
          updatedAt: Date.now(),
        })
        await recordAudit(sys, actor, { action: "staffing-compliance.requirement.create", targetType: "staffing_compliance_requirements", targetId: id, changes: { country: country ?? null, clientId: a.clientId ?? null, scope: a.scope } })
        return { id, operationId: op }
      },
    }),

    deleteRequirement: mutationGeneric({
      args: { ...actorArgs, requirementId: v.id("staffing_compliance_requirements") },
      handler: async (ctx, a) => {
        const { sys, actor } = await system.requirePermission(ctx, P.requirementManage, opts(a))
        const db = writerOf<ComplianceDataModel>(ctx)
        const r = await db.get("staffing_compliance_requirements", a.requirementId)
        if (!r) fail("NOT_FOUND", "requirement_not_found", sys.operationId)
        await db.delete("staffing_compliance_requirements", r._id)
        await recordAudit(sys, actor, { action: "staffing-compliance.requirement.delete", targetType: "staffing_compliance_requirements", targetId: r._id, changes: { country: r.country ?? null, clientId: r.clientId ?? null } })
        return { operationId: sys.operationId }
      },
    }),

    // ---------------------------------------------------------------- readiness

    listReadiness: queryGeneric({
      args: { ...actorArgs },
      handler: async (ctx, a): Promise<ReadinessProjectSummary[]> => {
        await system.requirePermission(ctx, P.readinessRead, opts(a))
        const db = complianceReader(ctx)
        const projects = []
        for (const status of OPEN_PROJECT_STATUSES)
          projects.push(
            ...(await db
              .query("staffing_projects")
              .withIndex("by_status", (q) => q.eq("status", status))
              .collect()),
          )
        const out: ReadinessProjectSummary[] = []
        for (const p of projects) {
          const r = (await projectReadiness(ctx, p._id))!
          out.push({ ...r.project, documents: r.documents.length, team: r.rows.length, readiness: r.readiness, counts: r.counts })
        }
        return out.sort((x, y) => x.startDate.localeCompare(y.startDate))
      },
    }),

    getProjectReadiness: queryGeneric({
      args: { ...actorArgs, projectId: v.id("staffing_projects") },
      handler: async (ctx, a): Promise<ProjectReadiness | null> => {
        await system.requirePermission(ctx, P.readinessRead, opts(a))
        return projectReadiness(ctx, a.projectId)
      },
    }),

    /** The client document package of a project: confirmed/active team, required documents, links to the stored files. */
    getProjectPackage: queryGeneric({
      args: { ...actorArgs, projectId: v.id("staffing_projects") },
      handler: async (ctx, a): Promise<ProjectPackage | null> => {
        await system.requirePermission(ctx, P.readinessRead, opts(a))
        const r = await projectReadiness(ctx, a.projectId, { confirmedOnly: true })
        if (!r) return null
        const db = complianceReader(ctx)
        const files: PackageFile[] = []
        for (const row of r.rows)
          for (const [i, cell] of row.cells.entries()) {
            if (!cell.certificateId || !cell.hasFile) continue
            const c = await db.get("staffing_workerCertificates", cell.certificateId)
            if (!c?.fileStorageId) continue
            files.push({ certificateId: c._id, workerName: row.workerName, typeName: r.documents[i]!.name, fileName: c.fileName ?? "document.pdf", url: await ctx.storage.getUrl(c.fileStorageId as StorageId) })
          }
        return { ...r, files }
      },
    }),

    // ---------------------------------------------------------------- expiry radar and digest

    listExpiring: queryGeneric({
      args: { ...actorArgs, days: v.optional(v.number()) },
      handler: async (ctx, a): Promise<ExpiringItem[]> => {
        await system.requirePermission(ctx, P.readinessRead, opts(a))
        return expiringWithProjects(ctx, { days: Math.min(Math.max(a.days ?? 60, 1), 365) })
      },
    }),

    listDigestRuns: queryGeneric({
      args: { ...actorArgs },
      handler: async (ctx, a): Promise<DigestRunView[]> => {
        await system.requirePermission(ctx, P.readinessRead, opts(a))
        const rows = await complianceReader(ctx).query("staffing_compliance_digestRuns").order("desc").take(10)
        return rows.map((r) => ({ id: r._id, trigger: r.trigger, status: r.status, to: r.to ?? null, items: r.items, error: r.error ?? null, createdAt: r._creationTime, finishedAt: r.finishedAt ?? null }))
      },
    }),

    /** Sends the digest of due items now (the daily cron does the same). */
    sendDigest: mutationGeneric({
      args: { ...actorArgs },
      handler: async (ctx, a) => {
        const { sys, actor } = await system.requirePermission(ctx, P.digestSend, opts(a))
        const r = await startDigest(ctx as never, "manual")
        await recordAudit(sys, actor, { action: "staffing-compliance.digest.send", targetType: "staffing_compliance_digestRuns", targetId: r.runId, changes: { items: r.items } })
        return { ...r, operationId: sys.operationId }
      },
    }),

    /** Daily cron (convex/crons.ts). */
    _dailyDigest: internalMutationGeneric({
      args: {},
      handler: async (ctx) => {
        return startDigest(ctx as never, "cron")
      },
    }),

    _deliverDigest: internalActionGeneric({
      args: { runId: v.id("staffing_compliance_digestRuns") },
      handler: async (ctx, a): Promise<void> => {
        const run = (await ctx.runQuery(ref("_digestRun") as never, { runId: a.runId } as never)) as { items: Infer<typeof digestItemValidator>[]; to?: string } | null
        if (!run) return
        const base = process.env.N8N_URL
        const secret = process.env.N8N_WEBHOOK_SECRET
        const finish = (status: DigestRunStatus, error?: string) => ctx.runMutation(ref("_finishDigest") as never, { runId: a.runId, status, ...(error ? { error } : {}) } as never)
        if (!base || !secret || !run.to) {
          await finish("not_configured", !run.to ? "no recipient (STAFFING_COMPLIANCE_DIGEST_TO / SUPER_USER_EMAILS)" : "N8N_URL / N8N_WEBHOOK_SECRET not set")
          return
        }
        const production = process.env.APP_ENV === "production"
        const redirectTo = (process.env.SUPER_USER_EMAILS ?? "").split(",")[0]?.trim()
        const site = process.env.SITE_URL
        const body = {
          to: run.to,
          ...(!production && redirectTo ? { redirectTo } : {}),
          language: "lt",
          items: run.items.map((i) => ({ worker: i.worker, document: i.document, expiresAt: i.expiresAt, daysLeft: i.daysLeft, ...(i.currentProject ? { currentProject: i.currentProject } : {}) })),
          ...(site ? { appUrl: `${site.replace(/\/$/, "")}/app/compliance/expiring` } : {}),
        }
        try {
          const res = await fetch(`${base.replace(/\/$/, "")}/webhook/${DIGEST_WEBHOOK}`, { method: "POST", headers: { "Content-Type": "application/json", "X-Webhook-Secret": secret }, body: JSON.stringify(body) })
          if (!res.ok) await finish("failed", `HTTP ${res.status}`)
          else await finish("sent")
        } catch (e) {
          await finish("failed", e instanceof Error ? e.message.slice(0, 300) : "fetch failed")
        }
      },
    }),

    _digestRun: internalQueryGeneric({
      args: { runId: v.id("staffing_compliance_digestRuns") },
      handler: async (ctx, a) => {
        const r = await complianceReader(ctx).get("staffing_compliance_digestRuns", a.runId)
        return r && r.status === "pending" ? { items: r.items, ...(r.to ? { to: r.to } : {}) } : null
      },
    }),

    _finishDigest: internalMutationGeneric({
      args: { runId: v.id("staffing_compliance_digestRuns"), status: v.union(v.literal("sent"), v.literal("not_configured"), v.literal("failed")), error: v.optional(v.string()) },
      handler: async (ctx, a) => {
        const db = writerOf<ComplianceDataModel>(ctx)
        const run = await db.get("staffing_compliance_digestRuns", a.runId)
        if (!run) return
        const now = Date.now()
        await db.patch("staffing_compliance_digestRuns", run._id, { status: a.status, finishedAt: now, ...(a.error ? { error: a.error } : {}) })
        // Only what really went out is remembered, so a not-configured run is retried next time.
        if (a.status === "sent") for (const i of run.items) await db.insert("staffing_compliance_digestLog", { certificateId: i.certificateId, threshold: i.threshold as DigestThreshold, runId: run._id, sentAt: now })
      },
    }),

    // ---------------------------------------------------------------- templates

    listTemplates: queryGeneric({
      args: { ...actorArgs },
      handler: async (ctx, a): Promise<TemplateView[]> => {
        await system.requirePermission(ctx, P.contractRead, opts(a))
        const db = complianceReader(ctx)
        const rows = await db.query("staffing_compliance_templates").withIndex("by_name").collect()
        const contracts = await db.query("staffing_compliance_contracts").take(5000)
        return rows.map((t) => ({ id: t._id, name: t.name, language: t.language, description: t.description ?? null, body: t.body, updatedAt: t.updatedAt, contracts: contracts.filter((c) => c.templateId === t._id).length }))
      },
    }),

    saveTemplate: mutationGeneric({
      args: { ...actorArgs, templateId: v.optional(v.id("staffing_compliance_templates")), name: v.string(), language: templateLanguageValidator, body: v.string(), description: v.optional(v.string()) },
      handler: async (ctx, a) => {
        const { sys, actor } = await system.requirePermission(ctx, P.templateManage, opts(a))
        const op = sys.operationId
        const db = writerOf<ComplianceDataModel>(ctx)
        const name = cleanText(a.name, 120, "name", op)!
        const body = cleanText(a.body, MAX_BODY, "body", op)!
        const description = cleanText(a.description, 500, "description", op, false)
        const unknown = unknownPlaceholders(body)
        if (unknown.length) fail("VALIDATION", `unknown_placeholder:${unknown.join(",")}`, op, ["body"])
        const fields = { name, language: a.language, body, ...(description ? { description } : {}), updatedAt: Date.now() }
        let id = a.templateId
        if (id) {
          const cur = await db.get("staffing_compliance_templates", id)
          if (!cur) fail("NOT_FOUND", "template_not_found", op)
          await db.replace("staffing_compliance_templates", id, fields)
        } else id = await db.insert("staffing_compliance_templates", fields)
        await recordAudit(sys, actor, { action: a.templateId ? "staffing-compliance.template.update" : "staffing-compliance.template.create", targetType: "staffing_compliance_templates", targetId: id, changes: { name } })
        return { id, operationId: op }
      },
    }),

    deleteTemplate: mutationGeneric({
      args: { ...actorArgs, templateId: v.id("staffing_compliance_templates") },
      handler: async (ctx, a) => {
        const { sys, actor } = await system.requirePermission(ctx, P.templateManage, opts(a))
        const db = writerOf<ComplianceDataModel>(ctx)
        const t = await db.get("staffing_compliance_templates", a.templateId)
        if (!t) fail("NOT_FOUND", "template_not_found", sys.operationId)
        await db.delete("staffing_compliance_templates", t._id)
        await recordAudit(sys, actor, { action: "staffing-compliance.template.delete", targetType: "staffing_compliance_templates", targetId: t._id, changes: { name: t.name } })
        return { operationId: sys.operationId }
      },
    }),

    // ---------------------------------------------------------------- contracts

    /** Assignments a contract can be generated for: open projects' proposed, confirmed and active ones. */
    listContractCandidates: queryGeneric({
      args: { ...actorArgs },
      handler: async (ctx, a) => {
        await system.requirePermission(ctx, P.contractRead, opts(a))
        const db = complianceReader(ctx)
        const out: { assignmentId: string; projectId: string; projectCode: string; projectName: string; workerName: string; tradeName: string; startDate: string; endDate: string | null; status: string }[] = []
        for (const status of OPEN_PROJECT_STATUSES) {
          const projects = await db
            .query("staffing_projects")
            .withIndex("by_status", (q) => q.eq("status", status))
            .collect()
          for (const p of projects) {
            const rows = (
              await db
                .query("staffing_assignments")
                .withIndex("by_project", (q) => q.eq("projectId", p._id))
                .collect()
            ).filter((x) => x.status === "proposed" || x.status === "confirmed" || x.status === "active")
            for (const x of rows) {
              const [w, tr] = await Promise.all([db.get("staffing_workers", x.workerId), db.get("staffing_trades", x.tradeId)])
              if (w) out.push({ assignmentId: x._id, projectId: p._id, projectCode: p.code, projectName: p.name, workerName: `${w.firstName} ${w.lastName}`, tradeName: tr?.nameLt ?? "?", startDate: x.startDate, endDate: x.endDate ?? null, status: x.status })
            }
          }
        }
        return out.sort((x, y) => x.projectCode.localeCompare(y.projectCode) || x.workerName.localeCompare(y.workerName))
      },
    }),

    previewContract: queryGeneric({
      args: { ...actorArgs, templateId: v.id("staffing_compliance_templates"), assignmentId: v.id("staffing_assignments"), hourlyRateCents: v.optional(v.number()) },
      handler: async (ctx, a): Promise<ContractDraft | null> => {
        await system.requirePermission(ctx, P.contractRead, opts(a))
        return draftContract(ctx, a.templateId, a.assignmentId, { ...(companyName ? { companyName } : {}), ...(a.hourlyRateCents !== undefined ? { hourlyRateCents: a.hourlyRateCents } : {}) })
      },
    }),

    generateContract: mutationGeneric({
      args: { ...actorArgs, templateId: v.id("staffing_compliance_templates"), assignmentId: v.id("staffing_assignments"), hourlyRateCents: v.optional(v.number()) },
      handler: async (ctx, a) => {
        const { sys, actor } = await system.requirePermission(ctx, P.contractCreate, opts(a))
        const op = sys.operationId
        if (a.hourlyRateCents !== undefined) cleanCents(a.hourlyRateCents, "hourlyRateCents", op)
        const draft = await draftContract(ctx, a.templateId, a.assignmentId, { ...(companyName ? { companyName } : {}), ...(a.hourlyRateCents !== undefined ? { hourlyRateCents: a.hourlyRateCents } : {}) })
        if (!draft) fail("NOT_FOUND", "template_or_assignment_not_found", op)
        const id = await writerOf<ComplianceDataModel>(ctx).insert("staffing_compliance_contracts", {
          templateId: a.templateId,
          templateName: draft.templateName,
          language: draft.language,
          title: draft.title,
          body: draft.body,
          missing: draft.missing,
          workerId: draft.workerId,
          assignmentId: draft.assignmentId,
          projectId: draft.projectId,
          createdBy: actorId(actor),
        })
        await recordAudit(sys, actor, { action: "staffing-compliance.contract.create", targetType: "staffing_compliance_contracts", targetId: id, changes: { template: draft.templateName, workerId: draft.workerId, missing: draft.missing.length } })
        return { id, missing: draft.missing, operationId: op }
      },
    }),

    listContracts: queryGeneric({
      args: { ...actorArgs, projectId: v.optional(v.id("staffing_projects")), workerId: v.optional(v.id("staffing_workers")) },
      handler: async (ctx, a): Promise<ContractView[]> => {
        await system.requirePermission(ctx, P.contractRead, opts(a))
        const db = complianceReader(ctx)
        const rows = a.workerId
          ? await db
              .query("staffing_compliance_contracts")
              .withIndex("by_worker", (q) => q.eq("workerId", a.workerId!))
              .collect()
          : a.projectId
            ? await db
                .query("staffing_compliance_contracts")
                .withIndex("by_project", (q) => q.eq("projectId", a.projectId))
                .collect()
            : await db.query("staffing_compliance_contracts").order("desc").take(500)
        const out: ContractView[] = []
        const names = new Map<string, string>()
        const codes = new Map<string, string | null>()
        for (const c of rows) {
          if (!names.has(c.workerId)) {
            const w = await db.get("staffing_workers", c.workerId)
            names.set(c.workerId, w ? `${w.firstName} ${w.lastName}` : "?")
          }
          if (c.projectId && !codes.has(c.projectId)) codes.set(c.projectId, (await db.get("staffing_projects", c.projectId))?.code ?? null)
          out.push({ id: c._id, title: c.title, templateName: c.templateName, language: c.language, workerId: c.workerId, workerName: names.get(c.workerId)!, projectId: c.projectId ?? null, projectCode: c.projectId ? (codes.get(c.projectId) ?? null) : null, missing: c.missing, createdAt: c._creationTime })
        }
        return out.sort((x, y) => y.createdAt - x.createdAt)
      },
    }),

    getContract: queryGeneric({
      args: { ...actorArgs, contractId: v.id("staffing_compliance_contracts") },
      handler: async (ctx, a) => {
        await system.requirePermission(ctx, P.contractRead, opts(a))
        const c = await complianceReader(ctx).get("staffing_compliance_contracts", a.contractId)
        return c ? { id: c._id, title: c.title, body: c.body, language: c.language, templateName: c.templateName, missing: c.missing, workerId: c.workerId, projectId: c.projectId ?? null, createdAt: c._creationTime } : null
      },
    }),

    deleteContract: mutationGeneric({
      args: { ...actorArgs, contractId: v.id("staffing_compliance_contracts") },
      handler: async (ctx, a) => {
        const { sys, actor } = await system.requirePermission(ctx, P.templateManage, opts(a))
        const db = writerOf<ComplianceDataModel>(ctx)
        const c = await db.get("staffing_compliance_contracts", a.contractId)
        if (!c) fail("NOT_FOUND", "contract_not_found", sys.operationId)
        await db.delete("staffing_compliance_contracts", c._id)
        await recordAudit(sys, actor, { action: "staffing-compliance.contract.delete", targetType: "staffing_compliance_contracts", targetId: c._id, changes: { title: c.title } })
        return { operationId: sys.operationId }
      },
    }),

    // ---------------------------------------------------------------- client document package (DIG-113)
    ...definePackageFunctions(system, { ref, companyName: companyName ?? "", ...(options.packageCapBytes ? { capBytes: options.packageCapBytes } : {}), ...(options.packageLinkDays ? { linkDays: options.packageLinkDays } : {}) }),

    // ---------------------------------------------------------------- dev
    ...defineComplianceSeed({ ref, ...(companyName ? { companyName } : {}) }),
  }
}

export type ComplianceFunctions = ReturnType<typeof defineCompliance>
