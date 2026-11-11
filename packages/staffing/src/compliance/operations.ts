// Read operations of the compliance area, shared by its functions, AI tool and
// seed. No permission checks here: callers guard first.
import { latestCertificateByType, todayIso, addDays, currentAndNext, daysBetween, fullName, type AssignmentStatus, type CertificateStatus } from "../pure"
import { listExpiringCertificates, loadCatalog, projectSellRate, projectTeam, workerAssignments, workerCertificates } from "../operations"
import { readerOf, type AssignmentId, type CertificateTypeId, type DataModelOf, type DbCtxLike, type ProjectId, type WorkerCertificateId, type WorkerId } from "../shared"
import type { staffingTables } from "../tables"
import type { complianceTables } from "./tables"
import { centsText, digestThreshold, fillTemplate, laterDay, projectRequirements, readinessCell, requirementApplies, rowReadiness, worstReadiness, type DigestThreshold, type Readiness, type ReadinessCell, type RequirementScope, type TemplateValues } from "./pure"
import type { GenericId } from "convex/values"

export type ComplianceDataModel = DataModelOf<typeof staffingTables & typeof complianceTables>
export const complianceReader = (ctx: DbCtxLike) => readerOf<ComplianceDataModel>(ctx)

export type TemplateId = GenericId<"staffing_compliance_templates">
export type ContractId = GenericId<"staffing_compliance_contracts">
export type RequirementId = GenericId<"staffing_compliance_requirements">

// ---------------------------------------------------------------- readiness

export interface ReadinessDocument {
  certificateTypeId: CertificateTypeId
  name: string
  nameEn: string | null
  scope: RequirementScope
}
export interface ReadinessCellView extends ReadinessCell {
  certificateId: WorkerCertificateId | null
  number: string | null
  expiresAt: string | null
  hasFile: boolean
}
export interface ReadinessRow {
  assignmentId: AssignmentId
  workerId: WorkerId
  workerName: string
  nationality: string
  tradeName: string
  tradeCode: string
  assignmentStatus: AssignmentStatus
  startDate: string
  endDate: string | null
  /** Checked from this day (the later of today and the start)… */
  from: string
  /** …through this one (assignment or project end; null = open-ended). */
  to: string | null
  /** Aligned with `ProjectReadiness.documents`. */
  cells: ReadinessCellView[]
  readiness: Readiness
  /** Names of the documents that block (missing or expired) or warn. */
  blockers: string[]
  warnings: string[]
}
export interface ProjectReadiness {
  project: { id: ProjectId; name: string; code: string; country: string; city: string; clientId: string; clientName: string; startDate: string; endDate: string | null; status: string }
  documents: ReadinessDocument[]
  rows: ReadinessRow[]
  readiness: Readiness
  counts: Record<Readiness, number>
  onDate: string
}

/** Required document types of a project (its country's and its client's requirements), in catalog order. */
export async function projectDocuments(ctx: DbCtxLike, project: { country: string; clientId: string }): Promise<ReadinessDocument[]> {
  const db = complianceReader(ctx)
  const [byCountry, byClient, catalog] = await Promise.all([
    db
      .query("staffing_compliance_requirements")
      .withIndex("by_country", (q) => q.eq("country", project.country))
      .collect(),
    db
      .query("staffing_compliance_requirements")
      .withIndex("by_client", (q) => q.eq("clientId", project.clientId as never))
      .collect(),
    loadCatalog(ctx),
  ])
  const req = projectRequirements([...byCountry, ...byClient], project)
  return catalog.certificateTypeList
    .filter((t) => req.has(t._id))
    .map((t) => ({ certificateTypeId: t._id, name: t.name, nameEn: t.nameEn ?? null, scope: req.get(t._id)! }))
}

/**
 * Team members (proposed, confirmed, active; `confirmedOnly` drops proposed) ×
 * required documents, each checked from the later of today and the member's
 * start through the member's (or project's) end.
 */
export async function projectReadiness(ctx: DbCtxLike, projectId: ProjectId, opts: { today?: string; confirmedOnly?: boolean } = {}): Promise<ProjectReadiness | null> {
  const db = complianceReader(ctx)
  const p = await db.get("staffing_projects", projectId)
  if (!p) return null
  const client = await db.get("staffing_clients", p.clientId)
  const today = opts.today ?? todayIso()
  const documents = await projectDocuments(ctx, { country: p.country, clientId: p.clientId })
  const keep: AssignmentStatus[] = opts.confirmedOnly ? ["confirmed", "active"] : ["proposed", "confirmed", "active"]
  const team = (await projectTeam(ctx, projectId)).filter((m) => keep.includes(m.status))
  const rows: ReadinessRow[] = []
  const certsByWorker = new Map<string, Awaited<ReturnType<typeof workerCertificates>>>()
  for (const m of team) {
    if (!certsByWorker.has(m.workerId)) certsByWorker.set(m.workerId, await workerCertificates(ctx, m.workerId))
    const latest = latestCertificateByType(certsByWorker.get(m.workerId)!)
    const from = laterDay(today, m.startDate)
    const to = m.endDate ?? p.endDate ?? null
    const cells: ReadinessCellView[] = documents.map((d) => {
      const c = latest.get(d.certificateTypeId)
      const cell = readinessCell(c, from, to, requirementApplies(d.scope, m.worker.nationality))
      return { ...cell, certificateId: c?._id ?? null, number: c?.number ?? null, expiresAt: c?.expiresAt ?? null, hasFile: Boolean(c?.fileStorageId) }
    })
    const blockers = documents.filter((_, i) => cells[i]!.status === "missing" || cells[i]!.status === "expired").map((d) => d.name)
    const warnings = documents.filter((_, i) => ["expiring30", "expiring60"].includes(cells[i]!.status) || cells[i]!.expiresDuring).map((d) => d.name)
    rows.push({
      assignmentId: m.id,
      workerId: m.workerId,
      workerName: m.worker.fullName,
      nationality: m.worker.nationality,
      tradeName: m.tradeName,
      tradeCode: m.tradeCode,
      assignmentStatus: m.status,
      startDate: m.startDate,
      endDate: m.endDate,
      from,
      to,
      cells,
      readiness: rowReadiness(cells),
      blockers,
      warnings,
    })
  }
  const counts: Record<Readiness, number> = { ready: 0, warning: 0, blocked: 0 }
  for (const r of rows) counts[r.readiness]++
  return {
    project: { id: p._id, name: p.name, code: p.code, country: p.country, city: p.city, clientId: p.clientId, clientName: client?.name ?? "?", startDate: p.startDate, endDate: p.endDate ?? null, status: p.status },
    documents,
    rows,
    readiness: worstReadiness(rows.map((r) => r.readiness)),
    counts,
    onDate: today,
  }
}

// ---------------------------------------------------------------- expiry radar

export interface ExpiringItem {
  certificateId: WorkerCertificateId
  certificateTypeId: CertificateTypeId
  typeName: string
  typeNameEn: string | null
  number: string | null
  expiresAt: string
  daysLeft: number
  status: CertificateStatus
  threshold: DigestThreshold
  workerId: WorkerId
  workerName: string
  hasFile: boolean
  /** The worker's current assignment, else the next one. */
  project: { id: ProjectId; code: string; name: string; when: "current" | "next"; startDate: string; endDate: string | null } | null
  /** The document expires before the worker leaves that project (or has expired). */
  hitsProject: boolean
}

/** Latest certificates of active workers expiring within `days` (default 60) or already expired, with the project they affect. */
export async function expiringWithProjects(ctx: DbCtxLike, opts: { today?: string; days?: number } = {}): Promise<ExpiringItem[]> {
  const db = complianceReader(ctx)
  const today = opts.today ?? todayIso()
  const certs = await listExpiringCertificates(ctx, { from: today, to: addDays(today, opts.days ?? 60), includeExpired: true })
  const projects = new Map<string, { code: string; name: string } | null>()
  const nowByWorker = new Map<string, ExpiringItem["project"]>()
  const out: ExpiringItem[] = []
  for (const c of certs) {
    if (!c.expiresAt) continue
    if (!nowByWorker.has(c.workerId)) {
      const { current, next } = currentAndNext(await workerAssignments(ctx, c.workerId), today)
      const a = current ?? next
      let view: ExpiringItem["project"] = null
      if (a) {
        if (!projects.has(a.projectId)) {
          const p = await db.get("staffing_projects", a.projectId)
          projects.set(a.projectId, p ? { code: p.code, name: p.name } : null)
        }
        const p = projects.get(a.projectId)
        if (p) view = { id: a.projectId, code: p.code, name: p.name, when: a === current ? "current" : "next", startDate: a.startDate, endDate: a.endDate ?? null }
      }
      nowByWorker.set(c.workerId, view)
    }
    const project = nowByWorker.get(c.workerId) ?? null
    const daysLeft = daysBetween(today, c.expiresAt)
    out.push({
      certificateId: c.id,
      certificateTypeId: c.certificateTypeId,
      typeName: c.typeName,
      typeNameEn: c.typeNameEn,
      number: c.number,
      expiresAt: c.expiresAt,
      daysLeft,
      status: c.status,
      threshold: digestThreshold(daysLeft) ?? "60",
      workerId: c.workerId,
      workerName: c.workerName,
      hasFile: c.hasFile,
      project,
      hitsProject: Boolean(project && (daysLeft < 0 || !project.endDate || c.expiresAt < project.endDate)),
    })
  }
  return out
}

// ---------------------------------------------------------------- contracts

export interface ContractDraft {
  title: string
  body: string
  missing: string[]
  workerId: WorkerId
  projectId: ProjectId
  assignmentId: AssignmentId
  templateName: string
  language: "lt" | "en"
}

/** Placeholder values for one assignment (worker, project, client, trade, rate). */
export async function contractValues(ctx: DbCtxLike, assignmentId: AssignmentId, opts: { companyName?: string; hourlyRateCents?: number | null; today?: string } = {}): Promise<{ values: TemplateValues; workerId: WorkerId; projectId: ProjectId; workerName: string } | null> {
  const db = complianceReader(ctx)
  const a = await db.get("staffing_assignments", assignmentId)
  if (!a) return null
  const [w, p, trade] = await Promise.all([db.get("staffing_workers", a.workerId), db.get("staffing_projects", a.projectId), db.get("staffing_trades", a.tradeId)])
  if (!w || !p) return null
  const client = await db.get("staffing_clients", p.clientId)
  const rate = opts.hourlyRateCents ?? (await projectSellRate(ctx, p._id, a.tradeId))
  const values: TemplateValues = {
    today: opts.today ?? todayIso(),
    "company.name": opts.companyName,
    "worker.fullName": fullName(w),
    "worker.firstName": w.firstName,
    "worker.lastName": w.lastName,
    "worker.personalCode": (w as { personalCode?: string }).personalCode,
    "worker.nationality": w.nationality,
    "worker.phone": w.phone,
    "worker.email": w.email,
    "worker.homeCity": w.homeCity,
    "worker.homeCountry": w.homeCountry,
    "project.name": p.name,
    "project.code": p.code,
    "project.country": p.country,
    "project.city": p.city,
    "project.siteAddress": p.siteAddress,
    "project.startDate": p.startDate,
    "project.endDate": p.endDate,
    "client.name": client?.name,
    "client.country": client?.country,
    "client.address": client?.address,
    "client.vatCode": client?.vatCode,
    "assignment.startDate": a.startDate,
    "assignment.endDate": a.endDate,
    trade: trade?.nameLt,
    tradeEn: trade?.nameEn,
    hourlyRate: centsText(rate),
    currency: p.currency,
  }
  return { values, workerId: w._id, projectId: p._id, workerName: fullName(w) }
}

/** A filled contract for an assignment from a template; `null` when the template or assignment is gone. */
export async function draftContract(ctx: DbCtxLike, templateId: TemplateId, assignmentId: AssignmentId, opts: { companyName?: string; hourlyRateCents?: number | null; today?: string } = {}): Promise<ContractDraft | null> {
  const db = complianceReader(ctx)
  const tpl = await db.get("staffing_compliance_templates", templateId)
  if (!tpl) return null
  const v = await contractValues(ctx, assignmentId, opts)
  if (!v) return null
  const { text, missing } = fillTemplate(tpl.body, v.values)
  return { title: `${tpl.name} – ${v.workerName}`, body: text, missing, workerId: v.workerId, projectId: v.projectId, assignmentId, templateName: tpl.name, language: tpl.language }
}
