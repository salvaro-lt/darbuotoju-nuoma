// The signing half, in the spirit of DocuSeal: a template is a PDF with
// fields per signer role; sending it makes a submission (a frozen copy) with
// one signing link per signer; signers open the link without an account, fill
// their fields and sign; when the last one signs, the module builds the signed
// PDF with a certificate page and files it into the archive.
//
// Public signing functions take no session: the link's token proves the
// signer. Only its SHA-256 is stored; the token itself travels in the email.
import { internalActionGeneric, internalMutationGeneric, internalQueryGeneric, makeFunctionReference, mutationGeneric, queryGeneric } from "convex/server"
import { v } from "convex/values"
import { isFeatureEnabled, randomToken, recordAudit, sha256Hex, type ConvexSystem } from "@digimuza/system-core/convex"
import { canSeeDocument, viewerFor } from "./access"
import { DocumentsFlags, DocumentsPermissions } from "./manifest"
import { fieldProblems, MAX_ROLES, valueProblems, type PageSize, type SigningField, type SigningValue, type SubmissionStatus, type SubmitterStatus } from "./signing"
import { buildSignedPdfBytes } from "./stamp"
import {
  actorArgs,
  actorId,
  base64ToHex,
  cleanText,
  dbOf,
  displayName,
  EMAIL,
  fail,
  getDoc,
  opts,
  sha256OfBytes,
  type Db,
  type DocumentId,
  type SigningEventKind,
  type StorageId,
  type SubmissionDoc,
  type SubmissionId,
  type SubmitterDoc,
  type SubmitterId,
  type TemplateDoc,
  type TemplateId,
} from "./shared"
import { pageSizeValidator, signingFieldValidator } from "./tables"

// ---------------------------------------------------------------- public shapes

export interface TemplateView {
  id: TemplateId
  name: string
  fileName: string
  pages: PageSize[]
  roles: string[]
  fields: SigningField[]
  documentId: string | null
  archived: boolean
  createdAt: number
  updatedAt: number
  submissions: number
}
export interface TemplateDetail extends TemplateView {
  fileUrl: string | null
}
export interface SubmitterView {
  id: SubmitterId
  role: number
  roleName: string
  name: string
  email: string
  status: SubmitterStatus
  sentAt: number | null
  openedAt: number | null
  completedAt: number | null
  declineReason: string | null
}
export interface SubmissionView {
  id: SubmissionId
  templateId: TemplateId
  name: string
  status: SubmissionStatus
  ordered: boolean
  createdAt: number
  createdByName: string
  completedAt: number | null
  expiresAt: number | null
  documentId: string | null
  submitters: SubmitterView[]
}
export interface SigningEventView {
  at: number
  kind: SigningEventKind
  submitterName: string | null
  detail: string | null
}
export interface SubmissionDetail extends SubmissionView {
  fileUrl: string | null
  signedUrl: string | null
  sha256: string
  signedSha256: string | null
  finalizeError: string | null
  fields: SigningField[]
  roles: string[]
  pages: PageSize[]
  values: Record<string, SigningValue>
  events: SigningEventView[]
}
/** What the public signing page renders. */
export type SigningSession =
  | { state: "not_found" | "unavailable" }
  | {
      state: "ready" | "waiting" | "completed" | "declined" | "cancelled" | "expired"
      submissionName: string
      senderName: string
      message: string | null
      signerName: string
      signerEmail: string
      roleName: string
      role: number
      locale: "lt" | "en"
      fileUrl: string | null
      pages: PageSize[]
      fields: SigningField[]
      /** Values already given: this signer's, and earlier signers' (read-only). */
      values: Record<string, SigningValue>
      /** The final PDF, once every signer is done and it is built. */
      signedUrl: string | null
      allDone: boolean
    }

export interface SigningMail {
  to: string
  subject: string
  text: string
}

export interface SigningOptions {
  /** Builds the public signing link, e.g. `${SITE_URL}/sign/${token}`. */
  signingUrl: (token: string) => string
  /** Sends one email (an action context: `fetch` works). Without it, links are only shown to the sender. */
  deliver?: (mail: SigningMail) => Promise<void>
  /** A TrueType font with Lithuanian letters for the signed PDF (URL or loader). Without it, Helvetica and transliteration. */
  font?: string | (() => Promise<Uint8Array | null>)
  /** Default validity of signing links, in days. Default 30. */
  defaultExpiryDays?: number
}

// ---------------------------------------------------------------- helpers

const MAX_SUBMITTERS = 10
const MAX_MESSAGE = 2000

const MAIL = {
  lt: {
    inviteSubject: (name: string) => `Pasirašykite: ${name}`,
    invite: (o: { sender: string; name: string; message: string | null; url: string; expires: string | null }) =>
      [
        `${o.sender} kviečia jus pasirašyti dokumentą „${o.name}“.`,
        o.message ? `\n${o.message}\n` : "",
        `Peržiūrėti ir pasirašyti: ${o.url}`,
        o.expires ? `\nNuoroda galioja iki ${o.expires}.` : "",
        "\nNuoroda asmeninė: neperduokite jos kitiems.",
      ].join("\n"),
    doneSubject: (name: string) => `Pasirašyta: ${name}`,
    done: (o: { name: string; url: string }) => `Visi pasirašė dokumentą „${o.name}“.\n\nAtsisiųsti pasirašytą PDF: ${o.url}`,
  },
  en: {
    inviteSubject: (name: string) => `Please sign: ${name}`,
    invite: (o: { sender: string; name: string; message: string | null; url: string; expires: string | null }) =>
      [
        `${o.sender} invited you to sign "${o.name}".`,
        o.message ? `\n${o.message}\n` : "",
        `Review and sign: ${o.url}`,
        o.expires ? `\nThe link is valid until ${o.expires}.` : "",
        "\nThis link is personal: do not forward it.",
      ].join("\n"),
    doneSubject: (name: string) => `Signed: ${name}`,
    done: (o: { name: string; url: string }) => `Everyone has signed "${o.name}".\n\nDownload the signed PDF: ${o.url}`,
  },
}

async function event(db: Db, submissionId: SubmissionId, kind: SigningEventKind, submitterId?: SubmitterId, detail?: string) {
  await db.insert("docSigningEvents", { submissionId, kind, at: Date.now(), ...(submitterId ? { submitterId } : {}), ...(detail ? { detail: detail.slice(0, 500) } : {}) })
}

async function submittersOf(db: Db, submissionId: SubmissionId): Promise<SubmitterDoc[]> {
  return db
    .query("docSubmitters")
    .withIndex("by_submission", (q) => q.eq("submissionId", submissionId))
    .collect()
}

const isExpired = (s: SubmissionDoc) => s.status === "pending" && s.expiresAt !== undefined && s.expiresAt < Date.now()
const effectiveStatus = (s: SubmissionDoc): SubmissionStatus => (isExpired(s) ? "expired" : s.status)

function submitterView(s: SubmitterDoc, roles: string[]): SubmitterView {
  return {
    id: s._id,
    role: s.role,
    roleName: roles[s.role] ?? `#${s.role + 1}`,
    name: s.name,
    email: s.email,
    status: s.status,
    sentAt: s.sentAt ?? null,
    openedAt: s.openedAt ?? null,
    completedAt: s.completedAt ?? null,
    declineReason: s.declineReason ?? null,
  }
}

async function submissionView(db: Db, s: SubmissionDoc): Promise<SubmissionView> {
  const subs = (await submittersOf(db, s._id)).sort((a, b) => a.role - b.role)
  return {
    id: s._id,
    templateId: s.templateId,
    name: s.name,
    status: effectiveStatus(s),
    ordered: s.ordered,
    createdAt: s._creationTime,
    createdByName: s.createdByName,
    completedAt: s.completedAt ?? null,
    expiresAt: s.expiresAt ?? null,
    documentId: s.documentId ?? null,
    submitters: subs.map((x) => submitterView(x, s.roles)),
  }
}

function cleanRoles(roles: string[], op: string): string[] {
  const out = roles.map((r) => r.trim())
  if (out.length === 0 || out.length > MAX_ROLES || out.some((r) => !r || r.length > 60) || new Set(out).size !== out.length) fail("VALIDATION", "invalid_roles", op, ["roles"])
  return out
}

function cleanPages(pages: PageSize[], op: string): PageSize[] {
  if (pages.length === 0 || pages.length > 500 || pages.some((p) => !(p.width > 0 && p.height > 0 && p.width < 20_000 && p.height < 20_000))) fail("VALIDATION", "invalid_pages", op, ["pages"])
  return pages
}

/** A fresh token for a signer; returns the token (for the link) and stores its hash. */
async function issueToken(db: Db, submitterId: SubmitterId): Promise<string> {
  const token = randomToken(24)
  await db.patch("docSubmitters", submitterId, { tokenHash: await sha256Hex(token) })
  return token
}

// ---------------------------------------------------------------- the functions

export function defineSigning(system: ConvexSystem, options: SigningOptions & { functionsModule: string }) {
  const ref = (name: string) => makeFunctionReference<"query" | "mutation" | "action">(`${options.functionsModule}:${name}`)
  const expiryDays = options.defaultExpiryDays ?? 30

  async function guard(ctx: Parameters<ConvexSystem["requirePermission"]>[0], permission: string, a: { apiKey?: string | undefined; operationId?: string | undefined }) {
    const res = await system.requirePermission(ctx, permission, opts(a))
    if (!(await isFeatureEnabled(res.sys, DocumentsFlags.signing))) fail("FORBIDDEN", "flag_off", res.sys.operationId)
    return res
  }

  /**
   * Templates made from an archive document follow that document's access: a template
   * (and its submissions) is hidden when its source document is hidden from the viewer.
   */
  async function templateAccess(db: Db, res: Caller) {
    const viewer = await viewerFor(res.sys, res.actor)
    if (viewer.all) return () => Promise.resolve(true)
    const tags = new Map((await db.query("docTags").collect()).map((t) => [t._id as string, t]))
    return async (t: Pick<TemplateDoc, "documentId"> | null) => {
      const source = t?.documentId ? await getDoc(db, "docDocuments", t.documentId) : null
      return !source || canSeeDocument(viewer, source, tags)
    }
  }

  type Caller = { sys: Parameters<typeof viewerFor>[0]; actor: Parameters<typeof viewerFor>[1] }

  /** The template, if it exists and the caller may see its source document (hidden ones are "not found"). */
  async function requireTemplate(db: Db, id: string, op: string, caller: Caller): Promise<TemplateDoc> {
    const t = await getDoc(db, "docTemplates", id)
    if (!t || !(await (await templateAccess(db, caller))(t))) fail("NOT_FOUND", "template_not_found", op)
    return t
  }

  /** A submission's template must be visible to the caller (see `templateAccess`). */
  async function requireVisibleSubmission(db: Db, s: SubmissionDoc, op: string, caller: Caller) {
    if (!(await (await templateAccess(db, caller))(await getDoc(db, "docTemplates", s.templateId)))) fail("NOT_FOUND", "submission_not_found", op)
  }

  /** The signer behind a token, if the module and signing are on. */
  async function bySigningToken(ctx: Parameters<ConvexSystem["context"]>[0], token: string) {
    const { sys } = await system.context(ctx)
    if (!(await isFeatureEnabled(sys, DocumentsFlags.signing))) return { sys, state: "unavailable" as const }
    if (!/^[A-Za-z0-9_-]{16,100}$/.test(token)) return { sys, state: "not_found" as const }
    const db = dbOf(ctx)
    const hash = await sha256Hex(token)
    const s = await db
      .query("docSubmitters")
      .withIndex("by_token", (q) => q.eq("tokenHash", hash))
      .unique()
      .then(
        async (x) =>
          x ??
          // Links in the "everyone signed" email: view and download only.
          db
            .query("docSubmitters")
            .withIndex("by_download_token", (q) => q.eq("downloadTokenHash", hash))
            .unique(),
      )
    if (!s) return { sys, state: "not_found" as const }
    const submission = await getDoc(db, "docSubmissions", s.submissionId)
    if (!submission) return { sys, state: "not_found" as const }
    return { sys, state: "found" as const, db, submitter: s, submission }
  }

  async function scheduleInvite(ctx: { scheduler: { runAfter(ms: number, fn: never, args: never): Promise<unknown> } }, submitterId: SubmitterId, token: string) {
    await ctx.scheduler.runAfter(0, ref("_deliverInvite") as never, { submitterId, token } as never)
  }

  return {
    // ------------------------------------------------------------ templates

    listTemplates: queryGeneric({
      args: { ...actorArgs, archived: v.optional(v.boolean()) },
      handler: async (ctx, a): Promise<TemplateView[]> => {
        const res = await guard(ctx, DocumentsPermissions.signingRead, a)
        const db = dbOf(ctx)
        const visible = await templateAccess(db, res)
        const all = await db
          .query("docTemplates")
          .withIndex("by_archived", (q) => q.eq("archived", a.archived ?? false))
          .order("desc")
          .take(500)
        const rows = (await Promise.all(all.map(async (t) => ((await visible(t)) ? t : null)))).filter((t) => t !== null)
        return Promise.all(
          rows.map(async (t) => ({
            id: t._id,
            name: t.name,
            fileName: t.fileName,
            pages: t.pages,
            roles: t.roles,
            fields: t.fields,
            documentId: t.documentId ?? null,
            archived: t.archived,
            createdAt: t._creationTime,
            updatedAt: t.updatedAt,
            submissions: (
              await db
                .query("docSubmissions")
                .withIndex("by_template", (q) => q.eq("templateId", t._id))
                .take(1000)
            ).length,
          })),
        )
      },
    }),

    getTemplate: queryGeneric({
      args: { ...actorArgs, templateId: v.string() },
      handler: async (ctx, a): Promise<TemplateDetail | null> => {
        const res = await guard(ctx, DocumentsPermissions.signingRead, a)
        const db = dbOf(ctx)
        const t = await getDoc(db, "docTemplates", a.templateId)
        if (!t || !(await (await templateAccess(db, res))(t))) return null
        const subs = await db
          .query("docSubmissions")
          .withIndex("by_template", (q) => q.eq("templateId", t._id))
          .take(1000)
        return {
          id: t._id,
          name: t.name,
          fileName: t.fileName,
          pages: t.pages,
          roles: t.roles,
          fields: t.fields,
          documentId: t.documentId ?? null,
          archived: t.archived,
          createdAt: t._creationTime,
          updatedAt: t.updatedAt,
          submissions: subs.length,
          fileUrl: await ctx.storage.getUrl(t.storageId),
        }
      },
    }),

    generateTemplateUploadUrl: mutationGeneric({
      args: { ...actorArgs },
      handler: async (ctx, a): Promise<string> => {
        await guard(ctx, DocumentsPermissions.manageTemplates, a)
        return ctx.storage.generateUploadUrl()
      },
    }),

    /** From an uploaded PDF (`storageId`) or an archive document (`documentId`). The browser sends the page sizes it rendered. */
    createTemplate: mutationGeneric({
      args: {
        ...actorArgs,
        name: v.string(),
        storageId: v.optional(v.id("_storage")),
        fileName: v.optional(v.string()),
        documentId: v.optional(v.id("docDocuments")),
        pages: v.array(pageSizeValidator),
        roles: v.optional(v.array(v.string())),
      },
      handler: async (ctx, a): Promise<{ templateId: TemplateId; operationId: string }> => {
        const { sys, actor } = await guard(ctx, DocumentsPermissions.manageTemplates, a)
        const op = sys.operationId
        const db = dbOf(ctx)
        const name = cleanText(a.name, 200, "name", op)!
        let storageId: StorageId
        let fileName: string
        if (a.documentId) {
          const reader = await system.requirePermission(ctx, DocumentsPermissions.read, opts(a))
          const viewer = await viewerFor(reader.sys, reader.actor)
          const d = await getDoc(db, "docDocuments", a.documentId)
          const tags = new Map((await db.query("docTags").collect()).map((t) => [t._id as string, t]))
          if (!d || d.trashed || !canSeeDocument(viewer, d, tags)) fail("NOT_FOUND", "document_not_found", op, ["documentId"])
          storageId = d.storageId
          fileName = d.fileName
        } else if (a.storageId) {
          storageId = a.storageId
          fileName = cleanText(a.fileName, 255, "fileName", op)!
        } else fail("VALIDATION", "missing_file", op, ["storageId"])
        const meta = await db.system.get("_storage", storageId)
        if (!meta) fail("NOT_FOUND", "file_not_found", op, ["storageId"])
        if (meta.contentType && meta.contentType !== "application/pdf") fail("VALIDATION", "not_a_pdf", op, ["storageId"])
        const templateId = await db.insert("docTemplates", {
          name,
          storageId,
          fileName,
          sha256: base64ToHex(meta.sha256),
          pages: cleanPages(a.pages, op),
          roles: cleanRoles(a.roles ?? ["Pasirašantysis"], op),
          fields: [],
          ...(a.documentId ? { documentId: a.documentId } : {}),
          archived: false,
          createdBy: actorId(actor),
          updatedAt: Date.now(),
        })
        await recordAudit(sys, actor, { action: "documents.template.create", targetType: "docTemplates", targetId: templateId, changes: { name, fromDocument: Boolean(a.documentId) } })
        return { templateId, operationId: op }
      },
    }),

    /** Saves the builder: name, roles and the whole field list. */
    updateTemplate: mutationGeneric({
      args: { ...actorArgs, templateId: v.id("docTemplates"), name: v.optional(v.string()), roles: v.optional(v.array(v.string())), fields: v.optional(v.array(signingFieldValidator)) },
      handler: async (ctx, a): Promise<{ operationId: string }> => {
        const { sys, actor } = await guard(ctx, DocumentsPermissions.manageTemplates, a)
        const op = sys.operationId
        const db = dbOf(ctx)
        const t = await requireTemplate(db, a.templateId, op, { sys, actor })
        if (t.archived) fail("CONFLICT", "template_archived", op)
        const patch: Partial<TemplateDoc> = {}
        if (a.name !== undefined) patch.name = cleanText(a.name, 200, "name", op)!
        if (a.roles !== undefined) patch.roles = cleanRoles(a.roles, op)
        const roles = patch.roles ?? t.roles
        const fields = (a.fields ?? t.fields).map((f) => ({ ...f, label: f.label.trim() }))
        const problems = fieldProblems(fields, roles.length, t.pages.length)
        if (problems.length) fail("VALIDATION", "invalid_fields", op, problems.slice(0, 20))
        if (a.fields !== undefined || a.roles !== undefined) patch.fields = fields
        await db.patch("docTemplates", t._id, { ...patch, updatedAt: Date.now() })
        await recordAudit(sys, actor, { action: "documents.template.update", targetType: "docTemplates", targetId: t._id, changes: { fields: Object.keys(patch), count: fields.length } })
        return { operationId: op }
      },
    }),

    setTemplateArchived: mutationGeneric({
      args: { ...actorArgs, templateId: v.id("docTemplates"), archived: v.boolean() },
      handler: async (ctx, a): Promise<{ operationId: string }> => {
        const { sys, actor } = await guard(ctx, DocumentsPermissions.manageTemplates, a)
        const db = dbOf(ctx)
        const t = await requireTemplate(db, a.templateId, sys.operationId, { sys, actor })
        await db.patch("docTemplates", t._id, { archived: a.archived, updatedAt: Date.now() })
        await recordAudit(sys, actor, { action: a.archived ? "documents.template.archive" : "documents.template.restore", targetType: "docTemplates", targetId: t._id })
        return { operationId: sys.operationId }
      },
    }),

    // ------------------------------------------------------------ submissions

    /**
     * Sends a template to its signers: one per role. Returns each active
     * signer's link once (to copy); emails go out in the background.
     */
    sendSubmission: mutationGeneric({
      args: {
        ...actorArgs,
        templateId: v.id("docTemplates"),
        name: v.optional(v.string()),
        submitters: v.array(v.object({ role: v.number(), name: v.string(), email: v.string() })),
        ordered: v.optional(v.boolean()),
        message: v.optional(v.string()),
        expiresInDays: v.optional(v.number()),
        locale: v.optional(v.union(v.literal("lt"), v.literal("en"))),
        sendEmail: v.optional(v.boolean()),
      },
      handler: async (ctx, a): Promise<{ submissionId: SubmissionId; links: { submitterId: SubmitterId; role: number; email: string; url: string }[]; operationId: string }> => {
        const { sys, actor } = await guard(ctx, DocumentsPermissions.signingSend, a)
        const op = sys.operationId
        const db = dbOf(ctx)
        const t = await requireTemplate(db, a.templateId, op, { sys, actor })
        if (t.archived) fail("CONFLICT", "template_archived", op)
        if (!t.fields.some((f) => f.type === "signature" || f.type === "initials")) fail("VALIDATION", "no_signature_field", op, ["fields"])
        const problems = fieldProblems(t.fields, t.roles.length, t.pages.length)
        if (problems.length) fail("VALIDATION", "invalid_fields", op, problems.slice(0, 20))
        if (a.submitters.length === 0 || a.submitters.length > MAX_SUBMITTERS) fail("VALIDATION", "invalid_submitters", op, ["submitters"])
        const bad: string[] = []
        const seen = new Set<number>()
        a.submitters.forEach((s, i) => {
          if (!Number.isInteger(s.role) || s.role < 0 || s.role >= t.roles.length || seen.has(s.role)) bad.push(`submitters.${i}.role`)
          seen.add(s.role)
          if (!EMAIL.test(s.email.trim()) || s.email.length > 254) bad.push(`submitters.${i}.email`)
          if (s.name.trim().length > 120) bad.push(`submitters.${i}.name`)
        })
        // Every role that has fields needs a signer.
        for (const role of new Set(t.fields.map((f) => f.role))) if (!seen.has(role)) bad.push(`roles.${role}`)
        if (bad.length) fail("VALIDATION", "invalid_submitters", op, bad)
        const days = a.expiresInDays ?? expiryDays
        if (!Number.isInteger(days) || days < 0 || days > 365) fail("VALIDATION", "invalid_expiry", op, ["expiresInDays"])
        const message = cleanText(a.message, MAX_MESSAGE, "message", op, false)
        const ordered = a.ordered ?? false
        const submissionId = await db.insert("docSubmissions", {
          templateId: t._id,
          name: cleanText(a.name, 200, "name", op, false) ?? t.name,
          storageId: t.storageId,
          sha256: t.sha256,
          roles: t.roles,
          fields: t.fields,
          status: "pending",
          ordered,
          ...(message ? { message } : {}),
          ...(days > 0 ? { expiresAt: Date.now() + days * 86_400_000 } : {}),
          locale: a.locale ?? "lt",
          createdBy: actorId(actor),
          createdByName: await displayName(sys as never, actor),
        })
        await event(db, submissionId, "created")
        const sorted = [...a.submitters].sort((x, y) => x.role - y.role)
        const links: { submitterId: SubmitterId; role: number; email: string; url: string }[] = []
        for (const [i, s] of sorted.entries()) {
          const active = !ordered || i === 0
          const submitterId = await db.insert("docSubmitters", {
            submissionId,
            role: s.role,
            name: s.name.trim(),
            email: s.email.trim().toLowerCase(),
            tokenHash: await sha256Hex(randomToken(24)),
            status: active ? "pending" : "waiting",
            values: {},
          })
          if (active) {
            const token = await issueToken(db, submitterId)
            links.push({ submitterId, role: s.role, email: s.email.trim().toLowerCase(), url: options.signingUrl(token) })
            if (a.sendEmail ?? true) await scheduleInvite(ctx, submitterId, token)
          }
        }
        await recordAudit(sys, actor, { action: "documents.submission.send", targetType: "docSubmissions", targetId: submissionId, changes: { template: t._id, signers: sorted.length, ordered } })
        return { submissionId, links, operationId: op }
      },
    }),

    listSubmissions: queryGeneric({
      args: { ...actorArgs, status: v.optional(v.string()), templateId: v.optional(v.id("docTemplates")), limit: v.optional(v.number()) },
      handler: async (ctx, a): Promise<SubmissionView[]> => {
        const res = await guard(ctx, DocumentsPermissions.signingRead, a)
        const db = dbOf(ctx)
        const limit = Math.min(Math.max(a.limit ?? 200, 1), 500)
        const templateId = a.templateId
        const rows = templateId
          ? await db
              .query("docSubmissions")
              .withIndex("by_template", (q) => q.eq("templateId", templateId))
              .order("desc")
              .take(limit)
          : await db.query("docSubmissions").order("desc").take(limit)
        const visible = await templateAccess(db, res)
        const shown = (await Promise.all(rows.map(async (s) => ((await visible(await getDoc(db, "docTemplates", s.templateId))) ? s : null)))).filter((s) => s !== null)
        const views = await Promise.all(shown.map((s) => submissionView(db, s)))
        return a.status ? views.filter((s) => s.status === a.status) : views
      },
    }),

    getSubmission: queryGeneric({
      args: { ...actorArgs, submissionId: v.string() },
      handler: async (ctx, a): Promise<SubmissionDetail | null> => {
        const res = await guard(ctx, DocumentsPermissions.signingRead, a)
        const db = dbOf(ctx)
        const s = await getDoc(db, "docSubmissions", a.submissionId)
        if (!s || !(await (await templateAccess(db, res))(await getDoc(db, "docTemplates", s.templateId)))) return null
        const view = await submissionView(db, s)
        const subs = await submittersOf(db, s._id)
        const events = await db
          .query("docSigningEvents")
          .withIndex("by_submission", (q) => q.eq("submissionId", s._id))
          .collect()
        const values: Record<string, SigningValue> = {}
        for (const x of subs) Object.assign(values, x.values)
        return {
          ...view,
          fileUrl: await ctx.storage.getUrl(s.storageId),
          signedUrl: s.signedStorageId ? await ctx.storage.getUrl(s.signedStorageId) : null,
          sha256: s.sha256,
          signedSha256: s.signedSha256 ?? null,
          finalizeError: s.finalizeError ?? null,
          fields: s.fields,
          roles: s.roles,
          pages: (await getDoc(db, "docTemplates", s.templateId))?.pages ?? [],
          values,
          events: events.map((e) => ({ at: e.at, kind: e.kind, submitterName: e.submitterId ? (subs.find((x) => x._id === e.submitterId)?.name || subs.find((x) => x._id === e.submitterId)?.email || null) : null, detail: e.detail ?? null })),
        }
      },
    }),

    cancelSubmission: mutationGeneric({
      args: { ...actorArgs, submissionId: v.id("docSubmissions") },
      handler: async (ctx, a): Promise<{ operationId: string }> => {
        const { sys, actor } = await guard(ctx, DocumentsPermissions.signingSend, a)
        const op = sys.operationId
        const db = dbOf(ctx)
        const s = await getDoc(db, "docSubmissions", a.submissionId)
        if (!s) fail("NOT_FOUND", "submission_not_found", op)
        await requireVisibleSubmission(db, s, op, { sys, actor })
        if (s.status !== "pending") fail("CONFLICT", "not_pending", op)
        await db.patch("docSubmissions", s._id, { status: "cancelled" })
        await event(db, s._id, "cancelled", undefined, await displayName(sys as never, actor))
        await recordAudit(sys, actor, { action: "documents.submission.cancel", targetType: "docSubmissions", targetId: s._id })
        return { operationId: op }
      },
    }),

    /** A new link for one signer (the old one stops working); emailed unless `sendEmail: false`. */
    resendInvite: mutationGeneric({
      args: { ...actorArgs, submitterId: v.id("docSubmitters"), sendEmail: v.optional(v.boolean()) },
      handler: async (ctx, a): Promise<{ url: string; operationId: string }> => {
        const { sys, actor } = await guard(ctx, DocumentsPermissions.signingSend, a)
        const op = sys.operationId
        const db = dbOf(ctx)
        const sub = await getDoc(db, "docSubmitters", a.submitterId)
        if (!sub) fail("NOT_FOUND", "submitter_not_found", op)
        const s = await getDoc(db, "docSubmissions", sub.submissionId)
        if (!s) fail("NOT_FOUND", "submission_not_found", op)
        await requireVisibleSubmission(db, s, op, { sys, actor })
        if (effectiveStatus(s) !== "pending") fail("CONFLICT", "not_pending", op)
        if (sub.status !== "pending" && sub.status !== "opened") fail("CONFLICT", "signer_not_active", op)
        const token = await issueToken(db, sub._id)
        if (a.sendEmail ?? true) await scheduleInvite(ctx, sub._id, token)
        await recordAudit(sys, actor, { action: "documents.submission.resend", targetType: "docSubmissions", targetId: s._id, changes: { submitter: sub._id } })
        return { url: options.signingUrl(token), operationId: op }
      },
    }),

    // ------------------------------------------------------------ public signing (token, no session)

    getSigningSession: queryGeneric({
      args: { token: v.string() },
      handler: async (ctx, a): Promise<SigningSession> => {
        const found = await bySigningToken(ctx, a.token)
        if (found.state !== "found") return { state: found.state }
        const { db, submitter: me, submission: s } = found
        const status = effectiveStatus(s)
        const all = await submittersOf(db, s._id)
        const values: Record<string, SigningValue> = {}
        for (const x of all) if (x._id === me._id || x.status === "completed") Object.assign(values, x.values)
        const state =
          status === "cancelled" || status === "expired" || status === "declined"
            ? status
            : me.status === "completed"
              ? "completed"
              : me.status === "declined"
                ? "declined"
                : me.status === "waiting"
                  ? "waiting"
                  : "ready"
        return {
          state,
          submissionName: s.name,
          senderName: s.createdByName,
          message: s.message ?? null,
          signerName: me.name,
          signerEmail: me.email,
          roleName: s.roles[me.role] ?? "",
          role: me.role,
          locale: s.locale,
          fileUrl: state === "ready" || state === "completed" ? await ctx.storage.getUrl(s.storageId) : null,
          pages: (await getDoc(db, "docTemplates", s.templateId))?.pages ?? [],
          fields: s.fields,
          values,
          signedUrl: me.status === "completed" && s.signedStorageId ? await ctx.storage.getUrl(s.signedStorageId) : null,
          allDone: s.status === "completed",
        }
      },
    }),

    markSigningOpened: mutationGeneric({
      args: { token: v.string(), userAgent: v.optional(v.string()) },
      handler: async (ctx, a): Promise<{ ok: boolean }> => {
        const found = await bySigningToken(ctx, a.token)
        if (found.state !== "found") return { ok: false }
        const { db, submitter: me, submission: s, sys } = found
        if (effectiveStatus(s) !== "pending" || me.status !== "pending") return { ok: true }
        await db.patch("docSubmitters", me._id, { status: "opened", openedAt: Date.now(), ...(a.userAgent ? { userAgent: a.userAgent.slice(0, 300) } : {}) })
        await event(db, s._id, "opened", me._id)
        await recordAudit(sys, null, { action: "documents.signer.open", targetType: "docSubmissions", targetId: s._id, changes: { submitter: me._id } })
        return { ok: true }
      },
    }),

    submitSignature: mutationGeneric({
      args: { token: v.string(), values: v.record(v.string(), v.union(v.string(), v.boolean())), userAgent: v.optional(v.string()) },
      handler: async (ctx, a): Promise<{ allDone: boolean; operationId: string }> => {
        const found = await bySigningToken(ctx, a.token)
        const op = found.sys.operationId
        if (found.state === "unavailable") fail("UNAVAILABLE", "signing_off", op)
        if (found.state !== "found") fail("NOT_FOUND", "link_not_found", op)
        const { db, submitter: me, submission: s, sys } = found
        if (effectiveStatus(s) !== "pending") fail("CONFLICT", `submission_${effectiveStatus(s)}`, op)
        if (me.status !== "pending" && me.status !== "opened") fail("CONFLICT", `signer_${me.status}`, op)
        const values = Object.fromEntries(Object.entries(a.values).filter(([, x]) => x !== "" && x !== false))
        const bad = valueProblems(s.fields, me.role, values)
        if (bad.length) fail("VALIDATION", "invalid_values", op, bad)
        if (!s.fields.some((f) => f.role === me.role && (f.type === "signature" || f.type === "initials") && values[f.id])) fail("VALIDATION", "missing_signature", op)
        const now = Date.now()
        await db.patch("docSubmitters", me._id, { status: "completed", values, completedAt: now, openedAt: me.openedAt ?? now, ...(a.userAgent ? { userAgent: a.userAgent.slice(0, 300) } : {}) })
        await event(db, s._id, "completed", me._id)
        await recordAudit(sys, null, { action: "documents.signer.sign", targetType: "docSubmissions", targetId: s._id, changes: { submitter: me._id, fields: Object.keys(values).length } })
        const all = await submittersOf(db, s._id)
        const remaining = all.filter((x) => x._id !== me._id && x.status !== "completed").sort((x, y) => x.role - y.role)
        if (remaining.length === 0) {
          await db.patch("docSubmissions", s._id, { status: "completed", completedAt: now })
          await ctx.scheduler.runAfter(0, ref("_finalizeSubmission") as never, { submissionId: s._id } as never)
          return { allDone: true, operationId: op }
        }
        const next = remaining[0]!
        if (s.ordered && next.status === "waiting") {
          await db.patch("docSubmitters", next._id, { status: "pending" })
          await scheduleInvite(ctx, next._id, await issueToken(db, next._id))
        }
        return { allDone: false, operationId: op }
      },
    }),

    declineSignature: mutationGeneric({
      args: { token: v.string(), reason: v.string() },
      handler: async (ctx, a): Promise<{ operationId: string }> => {
        const found = await bySigningToken(ctx, a.token)
        const op = found.sys.operationId
        if (found.state === "unavailable") fail("UNAVAILABLE", "signing_off", op)
        if (found.state !== "found") fail("NOT_FOUND", "link_not_found", op)
        const { db, submitter: me, submission: s, sys } = found
        if (effectiveStatus(s) !== "pending") fail("CONFLICT", `submission_${effectiveStatus(s)}`, op)
        if (me.status !== "pending" && me.status !== "opened") fail("CONFLICT", `signer_${me.status}`, op)
        const reason = cleanText(a.reason, 1000, "reason", op)!
        await db.patch("docSubmitters", me._id, { status: "declined", declineReason: reason, completedAt: Date.now() })
        await db.patch("docSubmissions", s._id, { status: "declined" })
        await event(db, s._id, "declined", me._id, reason)
        await recordAudit(sys, null, { action: "documents.signer.decline", targetType: "docSubmissions", targetId: s._id, changes: { submitter: me._id } })
        return { operationId: op }
      },
    }),

    // ------------------------------------------------------------ background

    _inviteContext: internalQueryGeneric({
      args: { submitterId: v.id("docSubmitters") },
      handler: async (ctx, a) => {
        const db = dbOf(ctx)
        const sub = await getDoc(db, "docSubmitters", a.submitterId)
        if (!sub) return null
        const s = await getDoc(db, "docSubmissions", sub.submissionId)
        if (!s || s.status !== "pending") return null
        return { email: sub.email, name: s.name, sender: s.createdByName, message: s.message ?? null, expiresAt: s.expiresAt ?? null, locale: s.locale, submissionId: s._id }
      },
    }),

    _deliverInvite: internalActionGeneric({
      args: { submitterId: v.id("docSubmitters"), token: v.string() },
      handler: async (ctx, a): Promise<void> => {
        const c = (await ctx.runQuery(ref("_inviteContext") as never, { submitterId: a.submitterId } as never)) as {
          email: string
          name: string
          sender: string
          message: string | null
          expiresAt: number | null
          locale: "lt" | "en"
        } | null
        if (!c) return
        let ok = true
        let detail: string | undefined
        if (!options.deliver) {
          ok = false
          detail = "no_delivery"
        } else {
          const m = MAIL[c.locale]
          const expires = c.expiresAt ? new Date(c.expiresAt).toISOString().slice(0, 10) : null
          try {
            await options.deliver({ to: c.email, subject: m.inviteSubject(c.name), text: m.invite({ sender: c.sender, name: c.name, message: c.message, url: options.signingUrl(a.token), expires }) })
          } catch (e) {
            ok = false
            detail = e instanceof Error ? e.message.slice(0, 200) : "failed"
          }
        }
        await ctx.runMutation(ref("_recordDelivery") as never, { submitterId: a.submitterId, ok, ...(detail ? { detail } : {}) } as never)
      },
    }),

    _recordDelivery: internalMutationGeneric({
      args: { submitterId: v.id("docSubmitters"), ok: v.boolean(), detail: v.optional(v.string()) },
      handler: async (ctx, a): Promise<void> => {
        const db = dbOf(ctx)
        const sub = await getDoc(db, "docSubmitters", a.submitterId)
        if (!sub) return
        if (a.ok) await db.patch("docSubmitters", sub._id, { sentAt: Date.now() })
        await event(db, sub.submissionId, a.ok ? "sent" : "send_failed", sub._id, a.detail)
      },
    }),

    _finalizeContext: internalQueryGeneric({
      args: { submissionId: v.id("docSubmissions") },
      handler: async (ctx, a) => {
        const db = dbOf(ctx)
        const s = await getDoc(db, "docSubmissions", a.submissionId)
        if (!s || s.status !== "completed" || s.signedStorageId) return null
        const subs = (await submittersOf(db, s._id)).sort((x, y) => x.role - y.role)
        const events = await db
          .query("docSigningEvents")
          .withIndex("by_submission", (q) => q.eq("submissionId", s._id))
          .collect()
        const template = await getDoc(db, "docTemplates", s.templateId)
        const source = template?.documentId ? await getDoc(db, "docDocuments", template.documentId) : null
        return {
          name: s.name,
          storageId: s.storageId as string,
          sha256: s.sha256,
          fields: s.fields,
          roles: s.roles,
          locale: s.locale,
          createdBy: s.createdBy,
          content: source?.content ?? "",
          submitters: subs.map((x) => ({
            id: x._id as string,
            role: x.role,
            name: x.name,
            email: x.email,
            openedAt: x.openedAt ?? null,
            completedAt: x.completedAt ?? null,
            userAgent: x.userAgent ?? null,
            values: x.values,
          })),
          events: events.map((e) => ({ at: e.at, kind: e.kind, submitterId: (e.submitterId as string | undefined) ?? null })),
        }
      },
    }),

    _finalizeSubmission: internalActionGeneric({
      args: { submissionId: v.id("docSubmissions") },
      handler: async (ctx, a): Promise<void> => {
        type C = {
          name: string
          storageId: string
          sha256: string
          fields: SigningField[]
          roles: string[]
          locale: "lt" | "en"
          createdBy: string
          content: string
          submitters: { id: string; role: number; name: string; email: string; openedAt: number | null; completedAt: number | null; userAgent: string | null; values: Record<string, SigningValue> }[]
          events: { at: number; kind: SigningEventKind; submitterId: string | null }[]
        }
        const c = (await ctx.runQuery(ref("_finalizeContext") as never, { submissionId: a.submissionId } as never)) as C | null
        if (!c) return
        try {
          const blob = await ctx.storage.get(c.storageId as StorageId)
          if (!blob) throw new Error("original_missing")
          const font = await loadFont(options.font)
          const pdf = await buildSignedPdfBytes({
            pdf: new Uint8Array(await blob.arrayBuffer()),
            fields: c.fields,
            values: Object.assign({}, ...c.submitters.map((s) => s.values)) as Record<string, SigningValue>,
            font,
            certificate: {
              title: c.name,
              submissionId: a.submissionId,
              originalSha256: c.sha256,
              locale: c.locale === "lt" ? "lt-LT" : "en-GB",
              lang: c.locale,
              signers: c.submitters.map((s) => {
                const sig = c.fields.find((f) => f.role === s.role && f.type === "signature" && typeof s.values[f.id] === "string")
                return { role: c.roles[s.role] ?? "", name: s.name, email: s.email, openedAt: s.openedAt, completedAt: s.completedAt, userAgent: s.userAgent, signature: sig ? (s.values[sig.id] as string) : null }
              }),
              events: c.events
                .filter((e) => e.kind !== "send_failed")
                .map((e) => {
                  const who = c.submitters.find((s) => s.id === e.submitterId)
                  return { at: e.at, kind: e.kind, who: who ? `${who.name || who.email} <${who.email}>` : null }
                }),
            },
          })
          const signedSha256 = await sha256OfBytes(pdf)
          const signedStorageId = await ctx.storage.store(new Blob([pdf as BlobPart], { type: "application/pdf" }))
          const fileName = `${c.name.replace(/[\\/:*?"<>|]+/g, " ").trim().slice(0, 150) || "document"} (signed).pdf`
          const signers = c.submitters.map((s) => `${s.name} ${s.email}`).join(" ")
          const documentId = (await ctx.runMutation(ref("_fileSignedDocument") as never, {
            storageId: signedStorageId,
            title: c.name,
            fileName,
            content: [c.content, signers].filter(Boolean).join("\n\n"),
            submissionId: a.submissionId,
            addedBy: c.createdBy,
          } as never)) as DocumentId
          await ctx.runMutation(ref("_completeFinalize") as never, { submissionId: a.submissionId, signedStorageId, signedSha256, documentId } as never)
        } catch (e) {
          await ctx.runMutation(ref("_failFinalize") as never, { submissionId: a.submissionId, error: e instanceof Error ? e.message.slice(0, 300) : "failed" } as never)
        }
      },
    }),

    _completeFinalize: internalMutationGeneric({
      args: { submissionId: v.id("docSubmissions"), signedStorageId: v.id("_storage"), signedSha256: v.string(), documentId: v.id("docDocuments") },
      handler: async (ctx, a): Promise<void> => {
        const db = dbOf(ctx)
        const { sys } = await system.context(ctx)
        const s = await getDoc(db, "docSubmissions", a.submissionId)
        if (!s) return
        await db.patch("docSubmissions", s._id, { signedStorageId: a.signedStorageId, signedSha256: a.signedSha256, documentId: a.documentId, finalizeError: undefined })
        await event(db, s._id, "finalized", undefined, `sha256:${a.signedSha256}`)
        await recordAudit(sys, "system", { action: "documents.submission.complete", targetType: "docSubmissions", targetId: s._id, changes: { signedSha256: a.signedSha256, document: a.documentId } })
        await ctx.scheduler.runAfter(0, ref("_deliverCompleted") as never, { submissionId: s._id } as never)
      },
    }),

    _failFinalize: internalMutationGeneric({
      args: { submissionId: v.id("docSubmissions"), error: v.string() },
      handler: async (ctx, a): Promise<void> => {
        const db = dbOf(ctx)
        const { sys } = await system.context(ctx)
        await db.patch("docSubmissions", a.submissionId, { finalizeError: a.error })
        await event(db, a.submissionId, "finalize_failed", undefined, a.error)
        await recordAudit(sys, "system", { action: "documents.submission.complete", targetType: "docSubmissions", targetId: a.submissionId, result: "failed", changes: { error: a.error } })
      },
    }),

    /** Retries building the signed PDF after a failure. */
    retryFinalize: mutationGeneric({
      args: { ...actorArgs, submissionId: v.id("docSubmissions") },
      handler: async (ctx, a): Promise<{ operationId: string }> => {
        const { sys, actor } = await guard(ctx, DocumentsPermissions.signingSend, a)
        const db = dbOf(ctx)
        const s = await getDoc(db, "docSubmissions", a.submissionId)
        if (!s) fail("NOT_FOUND", "submission_not_found", sys.operationId)
        await requireVisibleSubmission(db, s, sys.operationId, { sys, actor })
        if (s.status !== "completed" || s.signedStorageId) fail("CONFLICT", "nothing_to_finalize", sys.operationId)
        await ctx.scheduler.runAfter(0, ref("_finalizeSubmission") as never, { submissionId: s._id } as never)
        await recordAudit(sys, actor, { action: "documents.submission.retry", targetType: "docSubmissions", targetId: s._id })
        return { operationId: sys.operationId }
      },
    }),

    /** A download link for every signer (their signing links keep working). */
    _completedLinks: internalMutationGeneric({
      args: { submissionId: v.id("docSubmissions") },
      handler: async (ctx, a): Promise<{ email: string; url: string }[]> => {
        const db = dbOf(ctx)
        const out: { email: string; url: string }[] = []
        for (const s of await submittersOf(db, a.submissionId)) {
          const token = randomToken(24)
          await db.patch("docSubmitters", s._id, { downloadTokenHash: await sha256Hex(token) })
          out.push({ email: s.email, url: options.signingUrl(token) })
        }
        return out
      },
    }),

    _deliverCompleted: internalActionGeneric({
      args: { submissionId: v.id("docSubmissions") },
      handler: async (ctx, a): Promise<void> => {
        if (!options.deliver) return
        const c = (await ctx.runQuery(ref("_inviteContextBySubmission") as never, { submissionId: a.submissionId } as never)) as { name: string; locale: "lt" | "en" } | null
        if (!c) return
        const links = (await ctx.runMutation(ref("_completedLinks") as never, { submissionId: a.submissionId } as never)) as { email: string; url: string }[]
        const m = MAIL[c.locale]
        for (const l of links) await options.deliver({ to: l.email, subject: m.doneSubject(c.name), text: m.done({ name: c.name, url: l.url }) }).catch(() => undefined)
      },
    }),

    _inviteContextBySubmission: internalQueryGeneric({
      args: { submissionId: v.id("docSubmissions") },
      handler: async (ctx, a) => {
        const s = await getDoc(dbOf(ctx), "docSubmissions", a.submissionId)
        return s ? { name: s.name, locale: s.locale } : null
      },
    }),
  }
}

export async function loadFont(font: SigningOptions["font"]): Promise<Uint8Array | null> {
  if (!font) return null
  try {
    if (typeof font === "function") return await font()
    const res = await fetch(font)
    return res.ok ? new Uint8Array(await res.arrayBuffer()) : null
  } catch {
    return null
  }
}
