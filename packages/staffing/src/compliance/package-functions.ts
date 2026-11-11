// Convex functions of the client document package (DIG-113), spread into
// `defineCompliance`. Sending goes through the n8n webhook
// `dr-nuoma-dokumentu-paketas` (attachments as file URLs that Resend fetches);
// the app's mail.ts (Resend) has no attachments.
import { internalActionGeneric, internalMutationGeneric, mutationGeneric, queryGeneric, type FunctionReference } from "convex/server"
import { v } from "convex/values"
import { recordAudit, type ConvexSystem } from "@digimuza/system-core/convex"
import { isUsableCertificateStatus, type CertificateStatus } from "../pure"
import { actorId, actorArgs, fail, opts, writerOf, EMAIL, type ProjectId, type StorageId } from "../shared"
import { StaffingCompliancePermissions as P } from "./manifest"
import { complianceReader, type ComplianceDataModel } from "./operations"
import {
  actorName,
  buildPackageDraft,
  clientRecipients,
  insertPackage,
  isoDay,
  issuePackageLink,
  packageLinkUrl,
  packageSettings,
  renderPackageEmail,
  type PackageCandidate,
  type PackageId,
  type PackageRecipient,
} from "./package-operations"
import {
  CANCELLABLE_PACKAGE_STATUSES,
  DEFAULT_LINK_DAYS,
  defaultPackageLanguage,
  linkState,
  looksLikeToken,
  SENDABLE_PACKAGE_STATUSES,
  sha256Hex,
  type LinkState,
  type MissingReason,
  type PackageDelivery,
  type PackageLanguage,
  type PackageStatus,
  type PackageTrigger,
} from "./pure"
import { packageLanguageValidator, packageRecipientValidator } from "./tables"

export const PACKAGE_WEBHOOK = "dr-nuoma-dokumentu-paketas"

export interface PackageFunctionsOptions {
  ref: (name: string) => unknown
  companyName: string
  /** Attach files up to this many bytes in total (default 15 MB); above it the email links a ZIP. */
  capBytes?: number
  /** Days a download link stays valid (default 14). */
  linkDays?: number
}

export interface PackageGapView {
  workerId: string
  workerName: string
  document: string
  documentEn: string | null
  reason: MissingReason
  expiresAt: string | null
}
export interface PackagePreview {
  complete: boolean
  status: PackageStatus
  missing: PackageGapView[]
  warnings: PackageGapView[]
  fileCount: number
  totalBytes: number
  capBytes: number
  delivery: PackageDelivery
  language: PackageLanguage
  recipients: PackageRecipient[]
  members: { workerId: string; workerName: string; tradeName: string }[]
  subject: string
  text: string
}
export interface PackageComposer {
  project: { id: string; code: string; name: string; clientName: string; clientCountry: string }
  candidates: PackageCandidate[]
  contacts: PackageRecipient[]
  settings: { autoSend: boolean; recipients: PackageRecipient[]; language: PackageLanguage }
  defaultLanguage: PackageLanguage
  capBytes: number
}
export interface PackageLogView {
  id: string
  status: PackageStatus
  trigger: PackageTrigger
  language: PackageLanguage
  recipients: PackageRecipient[]
  members: { workerId: string; workerName: string; tradeName: string; documents: { name: string; status: string; number: string | null; expiresAt: string | null; version: number | null; fileName: string | null }[] }[]
  missing: PackageGapView[]
  warnings: PackageGapView[]
  fileCount: number
  totalBytes: number
  delivery: PackageDelivery
  note: string | null
  subject: string
  text: string
  createdByName: string
  createdAt: number
  approvedByName: string | null
  approvedAt: number | null
  cancelledByName: string | null
  cancelledAt: number | null
  sentAt: number | null
  redirectedTo: string | null
  error: string | null
  link: { expiresAt: number; state: LinkState; downloads: number; lastAccessAt: number | null } | null
  accesses: { kind: "view" | "zip"; at: number }[]
}
export interface WorkerPackageSend {
  packageId: string
  projectId: string
  projectCode: string
  projectName: string
  sentAt: number
  to: string[]
  documents: number
  missing: number
}
export type SharedPackage =
  | { state: Exclude<LinkState, "ok"> }
  | {
      state: "ok"
      language: PackageLanguage
      companyName: string
      project: { code: string; name: string; city: string; country: string; clientName: string }
      sentAt: number | null
      expiresAt: number
      members: { workerName: string; tradeName: string; documents: { name: string; nameEn: string | null; status: string; number: string | null; expiresAt: string | null; fileName: string | null; url: string | null }[] }[]
      missing: PackageGapView[]
    }

const recipientsArg = v.optional(v.array(packageRecipientValidator))
const buildArgs = { projectId: v.id("staffing_projects"), workerIds: v.optional(v.array(v.id("staffing_workers"))), recipients: recipientsArg, language: v.optional(packageLanguageValidator), note: v.optional(v.string()) }
const gapView = (g: { workerId: string; workerName: string; document: string; documentEn?: string | null | undefined; reason: MissingReason; expiresAt?: string | null | undefined }): PackageGapView => ({
  workerId: g.workerId,
  workerName: g.workerName,
  document: g.document,
  documentEn: g.documentEn ?? null,
  reason: g.reason,
  expiresAt: g.expiresAt ?? null,
})

/** Lower-cased, de-duplicated, valid recipients (max 10). */
export function cleanRecipients(list: readonly PackageRecipient[] | undefined, op: string): PackageRecipient[] | undefined {
  if (!list) return undefined
  const out = new Map<string, PackageRecipient>()
  for (const r of list) {
    const email = r.email.trim().toLowerCase()
    if (!EMAIL.test(email) || email.length > 200) fail("VALIDATION", "invalid_recipient", op, ["recipients"])
    const name = r.name?.trim().slice(0, 120)
    if (!out.has(email)) out.set(email, { email, ...(name ? { name } : {}) })
  }
  if (out.size > 10) fail("VALIDATION", "too_many_recipients", op, ["recipients"])
  return [...out.values()]
}

export function definePackageFunctions(system: ConvexSystem, o: PackageFunctionsOptions) {
  const ref = (name: string) => o.ref(name) as FunctionReference<"mutation" | "action", "internal">
  const build = { companyName: o.companyName, ...(o.capBytes ? { capBytes: o.capBytes } : {}) }
  const linkDays = o.linkDays ?? DEFAULT_LINK_DAYS

  type Sched = { scheduler: { runAfter: (ms: number, fn: never, args: never) => Promise<unknown> } }
  const scheduleDelivery = (ctx: unknown, packageId: PackageId) => (ctx as Sched).scheduler.runAfter(0, ref("_deliverPackage") as never, { packageId } as never)

  async function packageOrFail(ctx: { db: unknown }, packageId: PackageId, op: string) {
    const p = await complianceReader(ctx).get("staffing_compliance_packages", packageId)
    if (!p) fail("NOT_FOUND", "package_not_found", op)
    return p
  }

  /** The link behind a public token (only its hash is stored) and its state. */
  async function linkByToken(ctx: { db: unknown }, token: string) {
    if (!looksLikeToken(token)) return { state: "not_found" as LinkState, link: null }
    const tokenHash = await sha256Hex(token)
    const link = await complianceReader(ctx)
      .query("staffing_compliance_packageLinks")
      .withIndex("by_token", (q) => q.eq("tokenHash", tokenHash))
      .first()
    return { state: linkState(link, Date.now()), link }
  }
  /** A stored package's gaps in the email's shape. */
  const evalOf = (p: { missing: Parameters<typeof gapView>[0][]; warnings: Parameters<typeof gapView>[0][]; fileCount: number; totalBytes: number }) => ({ missing: p.missing.map(gapView), warnings: p.warnings.map(gapView), fileCount: p.fileCount, totalBytes: p.totalBytes })

  return {
    /** What the "Siųsti klientui" dialog needs: the team, the client's contacts, the project's settings. */
    getPackageComposer: queryGeneric({
      args: { ...actorArgs, projectId: v.id("staffing_projects") },
      handler: async (ctx, a): Promise<PackageComposer | null> => {
        await system.requirePermission(ctx, P.readinessRead, opts(a))
        const draft = await buildPackageDraft(ctx, { projectId: a.projectId }, build)
        if (!draft) return null
        const settings = await packageSettings(ctx, a.projectId)
        const defaultLanguage = defaultPackageLanguage(draft.project.clientCountry)
        return {
          project: { id: draft.project.id, code: draft.project.code, name: draft.project.name, clientName: draft.project.clientName, clientCountry: draft.project.clientCountry },
          candidates: draft.candidates,
          contacts: await clientRecipients(ctx, draft.project.clientId),
          settings: { autoSend: settings?.autoSend ?? false, recipients: settings?.recipients ?? [], language: settings?.language ?? defaultLanguage },
          defaultLanguage,
          capBytes: draft.capBytes,
        }
      },
    }),

    /** The package as it would be sent now, without storing anything. */
    previewPackage: queryGeneric({
      args: { ...actorArgs, ...buildArgs },
      handler: async (ctx, a): Promise<PackagePreview | null> => {
        await system.requirePermission(ctx, P.readinessRead, opts(a))
        const d = await buildPackageDraft(ctx, { projectId: a.projectId, workerIds: a.workerIds, recipients: a.recipients, language: a.language, note: a.note }, build)
        if (!d) return null
        return {
          complete: d.evaluation.complete,
          status: d.evaluation.complete ? "ready" : "needs_approval",
          missing: d.evaluation.missing.map(gapView),
          warnings: d.evaluation.warnings.map(gapView),
          fileCount: d.evaluation.fileCount,
          totalBytes: d.evaluation.totalBytes,
          capBytes: d.capBytes,
          delivery: d.delivery,
          language: d.language,
          recipients: d.recipients,
          members: d.members.map((m) => ({ workerId: m.workerId, workerName: m.workerName, tradeName: m.tradeName })),
          subject: d.email.subject,
          text: d.email.text,
        }
      },
    }),

    /**
     * Builds and logs a package. Complete → `ready` (sent at once when the
     * project's "siųsti automatiškai" is on); incomplete → `needs_approval`.
     */
    createPackage: mutationGeneric({
      args: { ...actorArgs, ...buildArgs },
      handler: async (ctx, a) => {
        const { sys, actor } = await system.requirePermission(ctx, P.packageSend, opts(a))
        const op = sys.operationId
        const recipients = cleanRecipients(a.recipients, op)
        const note = a.note?.trim().slice(0, 2000)
        const draft = await buildPackageDraft(ctx, { projectId: a.projectId, workerIds: a.workerIds, recipients, language: a.language, note }, build)
        if (!draft) fail("NOT_FOUND", "project_not_found", op)
        if (!draft.members.length) fail("VALIDATION", "no_members", op, ["workerIds"])
        if (!draft.recipients.length) fail("VALIDATION", "no_recipients", op, ["recipients"])
        const settings = await packageSettings(ctx, a.projectId)
        const r = await insertPackage(ctx, draft, { trigger: "ui", createdBy: actorId(actor), createdByName: await actorName(ctx, actor), note, sendIfComplete: settings?.autoSend ?? false })
        if (r.status === "queued") await scheduleDelivery(ctx, r.packageId)
        await recordAudit(sys, actor, {
          action: "staffing-compliance.package.create",
          targetType: "staffing_compliance_packages",
          targetId: r.packageId,
          changes: { projectId: a.projectId, status: r.status, members: draft.members.length, missing: draft.evaluation.missing.length, to: draft.recipients.map((x) => x.email).join(", ") },
        })
        return { ...r, missing: draft.evaluation.missing.length, operationId: op }
      },
    }),

    /** One click on a ready package, "send anyway" on one that needs approval, or a retry. */
    sendPackage: mutationGeneric({
      args: { ...actorArgs, packageId: v.id("staffing_compliance_packages") },
      handler: async (ctx, a) => {
        const { sys, actor } = await system.requirePermission(ctx, P.packageSend, opts(a))
        const op = sys.operationId
        const p = await packageOrFail(ctx, a.packageId, op)
        if (!SENDABLE_PACKAGE_STATUSES.includes(p.status)) fail("CONFLICT", `package_${p.status}`, op)
        const name = await actorName(ctx, actor)
        const now = Date.now()
        await writerOf<ComplianceDataModel>(ctx).patch("staffing_compliance_packages", p._id, { status: "queued", queuedAt: now, approvedByName: name, approvedAt: now })
        await scheduleDelivery(ctx, p._id)
        await recordAudit(sys, actor, { action: p.status === "needs_approval" ? "staffing-compliance.package.approve" : "staffing-compliance.package.send", targetType: "staffing_compliance_packages", targetId: p._id, changes: { from: p.status, missing: p.missing.length } })
        return { operationId: op }
      },
    }),

    cancelPackage: mutationGeneric({
      args: { ...actorArgs, packageId: v.id("staffing_compliance_packages") },
      handler: async (ctx, a) => {
        const { sys, actor } = await system.requirePermission(ctx, P.packageSend, opts(a))
        const op = sys.operationId
        const p = await packageOrFail(ctx, a.packageId, op)
        if (!CANCELLABLE_PACKAGE_STATUSES.includes(p.status)) fail("CONFLICT", `package_${p.status}`, op)
        await writerOf<ComplianceDataModel>(ctx).patch("staffing_compliance_packages", p._id, { status: "cancelled", cancelledByName: await actorName(ctx, actor), cancelledAt: Date.now() })
        await recordAudit(sys, actor, { action: "staffing-compliance.package.cancel", targetType: "staffing_compliance_packages", targetId: p._id, changes: { from: p.status } })
        return { operationId: op }
      },
    }),

    setPackageSettings: mutationGeneric({
      args: { ...actorArgs, projectId: v.id("staffing_projects"), autoSend: v.boolean(), recipients: recipientsArg, language: v.optional(packageLanguageValidator) },
      handler: async (ctx, a) => {
        const { sys, actor } = await system.requirePermission(ctx, P.packageSend, opts(a))
        const op = sys.operationId
        const db = writerOf<ComplianceDataModel>(ctx)
        if (!(await db.get("staffing_projects", a.projectId))) fail("NOT_FOUND", "project_not_found", op)
        const recipients = cleanRecipients(a.recipients, op)
        const fields = { projectId: a.projectId, autoSend: a.autoSend, ...(recipients ? { recipients } : {}), ...(a.language ? { language: a.language } : {}), updatedAt: Date.now() }
        const cur = await packageSettings(ctx, a.projectId)
        if (cur) await db.replace("staffing_compliance_packageSettings", cur._id, fields)
        else await db.insert("staffing_compliance_packageSettings", fields)
        await recordAudit(sys, actor, { action: "staffing-compliance.package.settings", targetType: "staffing_projects", targetId: a.projectId, changes: { autoSend: a.autoSend } })
        return { operationId: op }
      },
    }),

    /** A new public download link (the old ones stay valid until they expire). Returns the URL once. */
    createPackageLink: mutationGeneric({
      args: { ...actorArgs, packageId: v.id("staffing_compliance_packages"), days: v.optional(v.number()) },
      handler: async (ctx, a) => {
        const { sys, actor } = await system.requirePermission(ctx, P.packageSend, opts(a))
        const op = sys.operationId
        const p = await packageOrFail(ctx, a.packageId, op)
        if (p.status === "cancelled") fail("CONFLICT", "package_cancelled", op)
        const days = Math.min(Math.max(Math.round(a.days ?? linkDays), 1), 60)
        const l = await issuePackageLink(ctx, p._id, await actorName(ctx, actor), days)
        await recordAudit(sys, actor, { action: "staffing-compliance.package.link", targetType: "staffing_compliance_packages", targetId: p._id, changes: { days } })
        return { url: packageLinkUrl(l.token), expiresAt: l.expiresAt, operationId: op }
      },
    }),

    revokePackageLinks: mutationGeneric({
      args: { ...actorArgs, packageId: v.id("staffing_compliance_packages") },
      handler: async (ctx, a) => {
        const { sys, actor } = await system.requirePermission(ctx, P.packageSend, opts(a))
        const db = writerOf<ComplianceDataModel>(ctx)
        const now = Date.now()
        for (const l of await db
          .query("staffing_compliance_packageLinks")
          .withIndex("by_package", (q) => q.eq("packageId", a.packageId))
          .collect())
          if (!l.revokedAt) await db.patch("staffing_compliance_packageLinks", l._id, { revokedAt: now })
        await recordAudit(sys, actor, { action: "staffing-compliance.package.revoke", targetType: "staffing_compliance_packages", targetId: a.packageId, changes: {} })
        return { operationId: sys.operationId }
      },
    }),

    /** Send log of a project, newest first. */
    listPackages: queryGeneric({
      args: { ...actorArgs, projectId: v.id("staffing_projects") },
      handler: async (ctx, a): Promise<PackageLogView[]> => {
        await system.requirePermission(ctx, P.readinessRead, opts(a))
        const db = complianceReader(ctx)
        const rows = await db
          .query("staffing_compliance_packages")
          .withIndex("by_project", (q) => q.eq("projectId", a.projectId))
          .order("desc")
          .take(30)
        const now = Date.now()
        const out: PackageLogView[] = []
        for (const p of rows) {
          const link = p.linkId ? await db.get("staffing_compliance_packageLinks", p.linkId) : null
          const accesses = await db
            .query("staffing_compliance_packageDownloads")
            .withIndex("by_package", (q) => q.eq("packageId", p._id))
            .order("desc")
            .take(10)
          out.push({
            id: p._id,
            status: p.status,
            trigger: p.trigger,
            language: p.language,
            recipients: p.recipients,
            members: p.members.map((m) => ({
              workerId: m.workerId,
              workerName: m.workerName,
              tradeName: m.tradeName,
              documents: m.documents.filter((d) => d.status !== "notRequired").map((d) => ({ name: d.name, status: d.status, number: d.number ?? null, expiresAt: d.expiresAt ?? null, version: d.version ?? null, fileName: d.fileName ?? null })),
            })),
            missing: p.missing.map(gapView),
            warnings: p.warnings.map(gapView),
            fileCount: p.fileCount,
            totalBytes: p.totalBytes,
            delivery: p.delivery,
            note: p.note ?? null,
            subject: p.subject,
            text: p.text,
            createdByName: p.createdByName,
            createdAt: p._creationTime,
            approvedByName: p.approvedByName ?? null,
            approvedAt: p.approvedAt ?? null,
            cancelledByName: p.cancelledByName ?? null,
            cancelledAt: p.cancelledAt ?? null,
            sentAt: p.sentAt ?? null,
            redirectedTo: p.redirectedTo ?? null,
            error: p.error ?? null,
            link: link ? { expiresAt: link.expiresAt, state: linkState(link, now), downloads: link.downloads, lastAccessAt: link.lastAccessAt ?? null } : null,
            accesses: accesses.map((x) => ({ kind: x.kind, at: x.at })),
          })
        }
        return out
      },
    }),

    /** "Paskutinį kartą siųsta klientui …" for the worker card. */
    workerPackageSends: queryGeneric({
      args: { ...actorArgs, workerId: v.id("staffing_workers") },
      handler: async (ctx, a): Promise<WorkerPackageSend[]> => {
        await system.requirePermission(ctx, P.readinessRead, opts(a))
        const db = complianceReader(ctx)
        const rows = await db
          .query("staffing_compliance_packageSends")
          .withIndex("by_worker", (q) => q.eq("workerId", a.workerId))
          .order("desc")
          .take(5)
        const out: WorkerPackageSend[] = []
        for (const r of rows) {
          const p = await db.get("staffing_projects", r.projectId)
          out.push({ packageId: r.packageId, projectId: r.projectId, projectCode: p?.code ?? "?", projectName: p?.name ?? "", sentAt: r.sentAt, to: r.to, documents: r.documents, missing: r.missing })
        }
        return out
      },
    }),

    // ---------------------------------------------------------------- public link (no session: the token proves the client)

    getSharedPackage: queryGeneric({
      args: { token: v.string() },
      handler: async (ctx, a): Promise<SharedPackage> => {
        const { state, link } = await linkByToken(ctx, a.token.slice(0, 100))
        if (state !== "ok" || !link) return { state: state === "ok" ? "not_found" : state }
        const db = complianceReader(ctx)
        const p = await db.get("staffing_compliance_packages", link.packageId)
        if (!p || p.status === "cancelled") return { state: "not_found" }
        const project = await db.get("staffing_projects", p.projectId)
        const client = await db.get("staffing_clients", p.clientId)
        const members: Extract<SharedPackage, { state: "ok" }>["members"] = []
        for (const m of p.members) {
          const documents = []
          for (const d of m.documents) {
            if (d.status === "notRequired") continue
            documents.push({ name: d.name, nameEn: d.nameEn ?? null, status: d.status, number: d.number ?? null, expiresAt: d.expiresAt ?? null, fileName: d.fileName ?? null, url: packed(d) ? await ctx.storage.getUrl(d.fileStorageId as StorageId) : null })
          }
          members.push({ workerName: m.workerName, tradeName: p.language === "lt" ? m.tradeName : (m.tradeNameEn ?? m.tradeName), documents })
        }
        return {
          state: "ok",
          language: p.language,
          companyName: o.companyName,
          project: { code: project?.code ?? "", name: project?.name ?? "", city: project?.city ?? "", country: project?.country ?? "", clientName: client?.name ?? "" },
          sentAt: p.sentAt ?? null,
          expiresAt: link.expiresAt,
          members,
          missing: p.missing.map(gapView),
        }
      },
    }),

    /** Logs an opening of the public link (page view or ZIP) and returns the files for the ZIP. */
    openSharedPackage: mutationGeneric({
      args: { token: v.string(), kind: v.union(v.literal("view"), v.literal("zip")), userAgent: v.optional(v.string()) },
      handler: async (ctx, a) => {
        const { state, link } = await linkByToken(ctx, a.token.slice(0, 100))
        if (state !== "ok" || !link) return { state: state === "ok" ? ("not_found" as const) : state, files: [] }
        const db = writerOf<ComplianceDataModel>(ctx)
        const p = await db.get("staffing_compliance_packages", link.packageId)
        if (!p || p.status === "cancelled") return { state: "not_found" as const, files: [] }
        const now = Date.now()
        await db.insert("staffing_compliance_packageDownloads", { linkId: link._id, packageId: p._id, kind: a.kind, at: now, ...(a.userAgent ? { userAgent: a.userAgent.slice(0, 200) } : {}) })
        await db.patch("staffing_compliance_packageLinks", link._id, { lastAccessAt: now, ...(a.kind === "zip" ? { downloads: link.downloads + 1 } : {}) })
        const project = await db.get("staffing_projects", p.projectId)
        const files: { folder: string; name: string; url: string }[] = []
        if (a.kind === "zip")
          for (const m of p.members)
            for (const d of m.documents) {
              if (!packed(d)) continue
              const url = await ctx.storage.getUrl(d.fileStorageId as StorageId)
              if (url) files.push({ folder: m.workerName, name: `${p.language === "lt" ? d.name : (d.nameEn ?? d.name)} - ${d.fileName ?? "document.pdf"}`, url })
            }
        const email = renderPackageEmail(
          { project: { code: project?.code ?? "", name: project?.name ?? "", city: project?.city ?? "", country: project?.country ?? "", startDate: project?.startDate ?? "", endDate: project?.endDate ?? null }, members: p.members, evaluation: evalOf(p), delivery: "attachments", language: p.language, recipients: [] },
          o.companyName,
          { url: "", expiresOn: isoDay(link.expiresAt) },
        )
        return { state: "ok" as const, code: project?.code ?? "package", subject: email.subject, html: email.html, files }
      },
    }),

    // ---------------------------------------------------------------- delivery (n8n)

    /** Cron: packages queued by the assistant (its tools cannot schedule). */
    _drainPackages: internalMutationGeneric({
      args: {},
      handler: async (ctx) => {
        const queued = await complianceReader(ctx)
          .query("staffing_compliance_packages")
          .withIndex("by_status", (q) => q.eq("status", "queued"))
          .take(10)
        for (const p of queued) await scheduleDelivery(ctx, p._id)
        return queued.length
      },
    }),

    /** queued → sending: issues the link, renders the final email, returns what the webhook needs. */
    _claimPackage: internalMutationGeneric({
      args: { packageId: v.id("staffing_compliance_packages") },
      handler: async (ctx, a) => {
        const db = writerOf<ComplianceDataModel>(ctx)
        const p = await db.get("staffing_compliance_packages", a.packageId)
        if (!p || p.status !== "queued") return null
        const project = await db.get("staffing_projects", p.projectId)
        if (!project) return null
        const l = await issuePackageLink(ctx, p._id, p.approvedByName ?? p.createdByName, linkDays)
        const url = packageLinkUrl(l.token)
        const email = renderPackageEmail({ project: { ...project, endDate: project.endDate ?? null }, members: p.members, evaluation: evalOf(p), delivery: p.delivery, language: p.language, recipients: p.recipients, note: p.note }, o.companyName, { url, expiresOn: isoDay(l.expiresAt) })
        await db.patch("staffing_compliance_packages", p._id, { status: "sending", subject: email.subject, text: email.text })
        const attachments: { filename: string; url: string }[] = []
        if (p.delivery === "attachments")
          for (const m of p.members)
            for (const d of m.documents) {
              if (!packed(d)) continue
              const fileUrl = await ctx.storage.getUrl(d.fileStorageId as StorageId)
              if (fileUrl) attachments.push({ filename: `${m.workerName} - ${p.language === "lt" ? d.name : (d.nameEn ?? d.name)} - ${d.fileName ?? "document.pdf"}`.replace(/[\\/:*?"<>|]+/g, "_"), url: fileUrl })
            }
        return { to: p.recipients.map((r) => r.email), language: p.language, subject: email.subject, html: email.html, text: email.text, attachments, linkUrl: url }
      },
    }),

    _deliverPackage: internalActionGeneric({
      args: { packageId: v.id("staffing_compliance_packages") },
      handler: async (ctx, a): Promise<void> => {
        const payload = (await ctx.runMutation(ref("_claimPackage") as FunctionReference<"mutation", "internal">, { packageId: a.packageId })) as {
          to: string[]
          language: PackageLanguage
          subject: string
          html: string
          text: string
          attachments: { filename: string; url: string }[]
          linkUrl: string
        } | null
        if (!payload) return
        const finish = (status: "sent" | "failed" | "not_configured", extra: { error?: string; redirectedTo?: string } = {}) =>
          ctx.runMutation(ref("_finishPackage") as FunctionReference<"mutation", "internal">, { packageId: a.packageId, status, ...extra })
        const base = process.env.N8N_URL
        const secret = process.env.N8N_WEBHOOK_SECRET
        if (!base || !secret) {
          await finish("not_configured", { error: "N8N_URL / N8N_WEBHOOK_SECRET not set" })
          return
        }
        const production = process.env.APP_ENV === "production"
        const redirectTo = production ? undefined : (process.env.SUPER_USER_EMAILS ?? "").split(",")[0]?.trim() || undefined
        if (!production && !redirectTo) {
          await finish("not_configured", { error: "non-production without SUPER_USER_EMAILS: nowhere safe to send" })
          return
        }
        const body = { ...payload, ...(redirectTo ? { redirectTo } : {}) }
        try {
          const res = await fetch(`${base.replace(/\/$/, "")}/webhook/${PACKAGE_WEBHOOK}`, { method: "POST", headers: { "Content-Type": "application/json", "X-Webhook-Secret": secret }, body: JSON.stringify(body), signal: AbortSignal.timeout(60_000) })
          if (!res.ok) await finish("failed", { error: `HTTP ${res.status}` })
          else await finish("sent", redirectTo ? { redirectedTo: redirectTo } : {})
        } catch (e) {
          await finish("failed", { error: e instanceof Error ? e.message.slice(0, 300) : "fetch failed" })
        }
      },
    }),

    _finishPackage: internalMutationGeneric({
      args: { packageId: v.id("staffing_compliance_packages"), status: v.union(v.literal("sent"), v.literal("failed"), v.literal("not_configured")), error: v.optional(v.string()), redirectedTo: v.optional(v.string()) },
      handler: async (ctx, a) => {
        const db = writerOf<ComplianceDataModel>(ctx)
        const p = await db.get("staffing_compliance_packages", a.packageId)
        if (!p || p.status !== "sending") return
        const now = Date.now()
        await db.patch("staffing_compliance_packages", p._id, { status: a.status, ...(a.status === "sent" ? { sentAt: now, error: undefined } : {}), ...(a.error ? { error: a.error } : {}), ...(a.redirectedTo ? { redirectedTo: a.redirectedTo } : {}) })
        if (a.status === "sent") await logSends(ctx, p._id, now)
      },
    }),
  }
}

/** A document that goes into the package: required, usable (valid or expiring) and scanned. Expired scans are not sent. */
const packed = (d: { status: string; fileStorageId?: unknown }): boolean => Boolean(d.fileStorageId) && d.status !== "notRequired" && isUsableCertificateStatus(d.status as CertificateStatus)

/** One `packageSends` row per member of a sent package (worker card history). */
export async function logSends(ctx: { db: unknown }, packageId: PackageId, sentAt: number) {
  const db = writerOf<ComplianceDataModel>(ctx)
  const p = await db.get("staffing_compliance_packages", packageId)
  if (!p) return
  for (const m of p.members)
    await db.insert("staffing_compliance_packageSends", {
      workerId: m.workerId,
      packageId: p._id,
      projectId: p.projectId as ProjectId,
      sentAt,
      to: p.recipients.map((r) => r.email),
      documents: m.documents.filter(packed).length,
      missing: p.missing.filter((g) => g.workerId === m.workerId).length,
    })
}
