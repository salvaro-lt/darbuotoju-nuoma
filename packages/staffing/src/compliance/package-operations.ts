// Client document package (DIG-113): build the package of a project's team
// (required documents, their latest versions and files), store it as a send
// log row, issue public download links. No permission checks: callers guard.
import type { Infer } from "convex/values"
import type { GenericId } from "convex/values"
import { loadCatalog } from "../operations"
import { writerOf, type DbCtxLike, type ProjectId, type StorageId, type WorkerId } from "../shared"
import { complianceReader, projectReadiness, type ComplianceDataModel } from "./operations"
import {
  DEFAULT_ATTACHMENT_CAP_BYTES,
  DEFAULT_LINK_DAYS,
  defaultPackageLanguage,
  evaluatePackage,
  initialPackageStatus,
  packageEmail,
  planDelivery,
  randomToken,
  sha256Hex,
  type PackageDelivery,
  type PackageEmail,
  type PackageEvaluation,
  type PackageLanguage,
  type PackageStatus,
  type PackageTrigger,
} from "./pure"
import type { packageMemberValidator, packageRecipientValidator } from "./tables"

export type PackageId = GenericId<"staffing_compliance_packages">
export type PackageLinkId = GenericId<"staffing_compliance_packageLinks">
export type PackageMember = Infer<typeof packageMemberValidator>
export type PackageRecipient = Infer<typeof packageRecipientValidator>

export interface PackageOptions {
  /** Signature line of the email, e.g. `UAB „…“`. */
  companyName: string
  /** Attach files up to this many bytes in total; above it the email carries a ZIP link. */
  capBytes?: number
}

export interface PackageCandidate {
  workerId: WorkerId
  workerName: string
  tradeName: string
  assignmentStatus: string
  readiness: "ready" | "warning" | "blocked"
}

export interface PackageDraft {
  project: { id: ProjectId; code: string; name: string; city: string; country: string; startDate: string; endDate: string | null; clientId: GenericId<"staffing_clients">; clientName: string; clientCountry: string }
  /** The confirmed / active team the members are chosen from. */
  candidates: PackageCandidate[]
  members: PackageMember[]
  evaluation: PackageEvaluation
  delivery: PackageDelivery
  capBytes: number
  language: PackageLanguage
  recipients: PackageRecipient[]
  /** Preview (no link yet). */
  email: PackageEmail
}

export interface BuildPackageInput {
  projectId: ProjectId
  /** Default: the whole confirmed / active team. */
  workerIds?: readonly string[] | undefined
  /** Default: the project's saved recipients, else the client's contacts with an email. */
  recipients?: readonly PackageRecipient[] | undefined
  language?: PackageLanguage | undefined
  note?: string | undefined
  today?: string
}

type StorageMeta = { size?: number } | null

/** Size of a stored file (0 when unknown). */
async function fileSize(ctx: DbCtxLike, id: StorageId): Promise<number> {
  const sys = (ctx.db as { system?: { get: (id: StorageId) => Promise<StorageMeta> } }).system
  try {
    return (await sys?.get(id))?.size ?? 0
  } catch {
    return 0
  }
}

/** The client's contacts that have an email. */
export async function clientRecipients(ctx: DbCtxLike, clientId: GenericId<"staffing_clients">): Promise<PackageRecipient[]> {
  const c = await complianceReader(ctx).get("staffing_clients", clientId)
  return (c?.contacts ?? []).filter((x) => x.email).map((x) => ({ email: x.email!.trim(), name: x.name }))
}

export async function packageSettings(ctx: DbCtxLike, projectId: ProjectId) {
  return complianceReader(ctx)
    .query("staffing_compliance_packageSettings")
    .withIndex("by_project", (q) => q.eq("projectId", projectId))
    .first()
}

/**
 * The package of a project as it would be sent now: each chosen member's
 * required documents (latest certificate, its file and size), the rule's
 * verdict, the delivery (attachments or link) and the email preview.
 */
export async function buildPackageDraft(ctx: DbCtxLike, input: BuildPackageInput, o: PackageOptions): Promise<PackageDraft | null> {
  const db = complianceReader(ctx)
  const r = await projectReadiness(ctx, input.projectId, { confirmedOnly: true, ...(input.today ? { today: input.today } : {}) })
  if (!r) return null
  const project = (await db.get("staffing_projects", input.projectId))!
  const client = await db.get("staffing_clients", project.clientId)
  const catalog = await loadCatalog(ctx)
  const tradeByCode = new Map(catalog.tradeList.map((t) => [t.code, t]))
  const settings = await packageSettings(ctx, input.projectId)

  const seen = new Set<string>()
  const rows = r.rows.filter((row) => (seen.has(row.workerId) ? false : (seen.add(row.workerId), true)))
  const candidates: PackageCandidate[] = rows.map((row) => ({ workerId: row.workerId, workerName: row.workerName, tradeName: row.tradeName, assignmentStatus: row.assignmentStatus, readiness: row.readiness }))
  const wanted = input.workerIds ? new Set(input.workerIds) : null
  const members: PackageMember[] = []
  for (const row of rows) {
    if (wanted && !wanted.has(row.workerId)) continue
    const documents: PackageMember["documents"] = []
    for (const [i, cell] of row.cells.entries()) {
      const d = r.documents[i]!
      const cert = cell.certificateId ? await db.get("staffing_workerCertificates", cell.certificateId) : null
      const size = cert?.fileStorageId ? await fileSize(ctx, cert.fileStorageId as StorageId) : 0
      documents.push({
        certificateTypeId: d.certificateTypeId,
        name: d.name,
        ...(d.nameEn ? { nameEn: d.nameEn } : {}),
        status: cell.status,
        expiresDuring: cell.expiresDuring,
        ...(cert ? { certificateId: cert._id, version: cert.updatedAt } : {}),
        ...(cert?.number ? { number: cert.number } : {}),
        ...(cert?.expiresAt ? { expiresAt: cert.expiresAt } : {}),
        ...(cert?.fileStorageId ? { fileStorageId: cert.fileStorageId, fileName: cert.fileName ?? `${d.name}.pdf`, size } : {}),
      })
    }
    const trade = tradeByCode.get(row.tradeCode)
    members.push({ workerId: row.workerId, workerName: row.workerName, tradeName: row.tradeName, ...(trade?.nameEn ? { tradeNameEn: trade.nameEn } : {}), nationality: row.nationality, documents })
  }

  const evaluation = evaluatePackage(members.map((m) => ({ workerId: m.workerId, workerName: m.workerName, documents: m.documents.map((d) => ({ ...d, hasFile: Boolean(d.fileStorageId) })) })))
  const capBytes = o.capBytes ?? DEFAULT_ATTACHMENT_CAP_BYTES
  const delivery = planDelivery(evaluation.totalBytes, evaluation.fileCount, capBytes)
  const language = input.language ?? settings?.language ?? defaultPackageLanguage(client?.country)
  const recipients = input.recipients?.length ? [...input.recipients] : settings?.recipients?.length ? settings.recipients : await clientRecipients(ctx, project.clientId)
  const projectView = { id: project._id, code: project.code, name: project.name, city: project.city, country: project.country, startDate: project.startDate, endDate: project.endDate ?? null, clientId: project.clientId, clientName: client?.name ?? "?", clientCountry: client?.country ?? project.country }
  const email = renderPackageEmail({ project: projectView, members, evaluation, delivery, language, recipients, note: input.note }, o.companyName, null)
  return { project: projectView, candidates, members, evaluation, delivery, capBytes, language, recipients, email }
}

/** The email of a package (draft or stored row); `link` is added at send time. */
export function renderPackageEmail(
  p: { project: { code: string; name: string; city: string; country: string; startDate: string; endDate: string | null; clientName?: string }; members: readonly PackageMember[]; evaluation: Pick<PackageEvaluation, "missing" | "warnings" | "fileCount" | "totalBytes">; delivery: PackageDelivery; language: PackageLanguage; recipients: readonly PackageRecipient[]; note?: string | null | undefined },
  companyName: string,
  link: { url: string; expiresOn: string } | null,
): PackageEmail {
  return packageEmail({
    language: p.language,
    project: p.project,
    clientName: p.project.clientName ?? "",
    companyName,
    contactName: p.recipients.length === 1 ? (p.recipients[0]!.name ?? null) : null,
    members: p.members,
    missing: p.evaluation.missing,
    warnings: p.evaluation.warnings,
    delivery: p.delivery,
    fileCount: p.evaluation.fileCount,
    totalBytes: p.evaluation.totalBytes,
    link,
    note: p.note,
  })
}

/** Display name of whoever acts: the user's name or email, else "API". */
export async function actorName(ctx: DbCtxLike, actor: { kind: "user"; userId: string } | { kind: "agent"; apiKeyId: string }): Promise<string> {
  if (actor.kind !== "user") return "API"
  const db = ctx.db as { query: (t: "users") => { withIndex: (i: "by_key", f: (q: { eq: (f: "key", v: string) => unknown }) => unknown) => { first: () => Promise<{ displayName?: string; email: string } | null> } } }
  const u = await db
    .query("users")
    .withIndex("by_key", (q) => q.eq("key", actor.userId))
    .first()
  return u?.displayName || u?.email || actor.userId
}

/**
 * Stores a built package as a log row. Complete → `ready` (→ `queued` when
 * `send` is set, e.g. the project's "siųsti automatiškai"); incomplete → `needs_approval`.
 */
export async function insertPackage(
  ctx: DbCtxLike,
  draft: PackageDraft,
  a: { trigger: PackageTrigger; createdBy: string; createdByName: string; note?: string | undefined; sendIfComplete: boolean; now?: number },
): Promise<{ packageId: PackageId; status: PackageStatus }> {
  const db = writerOf<ComplianceDataModel>(ctx)
  const now = a.now ?? Date.now()
  const initial = initialPackageStatus(draft.evaluation)
  const status: PackageStatus = initial === "ready" && a.sendIfComplete ? "queued" : initial
  const strip = <T extends { documentEn: string | null; expiresAt: string | null }>(g: T) => {
    const { documentEn, expiresAt, ...rest } = g
    return { ...rest, ...(documentEn ? { documentEn } : {}), ...(expiresAt ? { expiresAt } : {}) }
  }
  const packageId = await db.insert("staffing_compliance_packages", {
    projectId: draft.project.id,
    clientId: draft.project.clientId,
    status,
    trigger: a.trigger,
    language: draft.language,
    recipients: draft.recipients,
    members: draft.members,
    missing: draft.evaluation.missing.map((g) => strip({ ...g, workerId: g.workerId as WorkerId })),
    warnings: draft.evaluation.warnings.map((g) => strip({ ...g, workerId: g.workerId as WorkerId })),
    fileCount: draft.evaluation.fileCount,
    totalBytes: draft.evaluation.totalBytes,
    delivery: draft.delivery,
    ...(a.note?.trim() ? { note: a.note.trim() } : {}),
    subject: draft.email.subject,
    text: draft.email.text,
    createdBy: a.createdBy,
    createdByName: a.createdByName,
    ...(status === "queued" ? { queuedAt: now } : {}),
  })
  return { packageId, status }
}

/** A fresh public link for a package; returns the token (shown or emailed once) and stores its hash. */
export async function issuePackageLink(ctx: DbCtxLike, packageId: PackageId, byName: string, days = DEFAULT_LINK_DAYS, now = Date.now()): Promise<{ token: string; linkId: PackageLinkId; expiresAt: number }> {
  const db = writerOf<ComplianceDataModel>(ctx)
  const token = randomToken(24)
  const expiresAt = now + days * 86_400_000
  const linkId = await db.insert("staffing_compliance_packageLinks", { packageId, tokenHash: await sha256Hex(token), expiresAt, createdByName: byName, downloads: 0 })
  await db.patch("staffing_compliance_packages", packageId, { linkId })
  return { token, linkId, expiresAt }
}

/** The public URL of a link token (SITE_URL, else relative). */
export const packageLinkUrl = (token: string) => `${(process.env.SITE_URL ?? "").replace(/\/+$/, "")}/d/${token}`
export const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10)
