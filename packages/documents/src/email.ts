// The email archive: every email received in a Gavimas (ingest) inbox is
// filed into the archive as a PDF document, each attachment as its own
// document linked to it. On for every inbox by default; switched off per
// inbox in Documents → Labels.
//
//   // convex/automationsConfig.ts (where the app lists its ingest consumers)
//   export const ingestConsumers = [automationsIngestConsumer(...), documentsIngestConsumer()]
//
// The consumer reports no linked records on purpose: ingest refuses to delete
// an inbox while something is linked, and the archive reads every inbox.
import { internalActionGeneric, makeFunctionReference, mutationGeneric, queryGeneric } from "convex/server"
import { v } from "convex/values"
import { isModuleEnabled, recordAudit, type ConvexSystem } from "@digimuza/system-core/convex"
import { ingestInboxes, resendApiKey, RESEND_API, type IngestConsumer, type ReceivedEmail } from "@digimuza/system-core/ingest"
import { htmlToText, renderEmailPdf } from "./email-pdf"
import { DOCUMENTS_MODULE_ID, DocumentsPermissions } from "./manifest"
import { actorArgs, fail, opts, type StorageId } from "./shared"

export const DOCUMENTS_CONSUMER_ID = "documents"
const REF_NAME = "Dokumentų archyvas"
const MAX_TEXT = 200_000
/** Inline images below this size are logos and signatures, not documents. */
const MIN_INLINE_IMAGE = 10 * 1024
/** A filing run that has not finished in this long is treated as failed. */
const STALE_MS = 30 * 60 * 1000
/** A failed filing run is tried this many times in all, after 1, 4 and 16 minutes. */
const MAX_ATTEMPTS = 4
const RETRY_MS = 60 * 1000

export interface EmailArchiveOptions {
  /** Module path (relative to `convex/`) where the documents functions are exported. Default "documents". */
  functionsModule?: string
}

export interface EmailArchiveInbox {
  id: string
  name: string
  address: string
  status: string
  /** Received mail is filed into the archive. */
  store: boolean
}
export interface EmailArchiveSettings {
  /** False when the app has no Gavimas (ingest) module tables. */
  available: boolean
  inboxes: EmailArchiveInbox[]
  /** The "El. laiškas" label, once the first email was filed. */
  tag: { id: string; restricted: boolean } | null
}

interface InboxArchiveRow {
  _id: string
  inboxId: string
  store: boolean
}
interface Indexed {
  withIndex(name: string, range: (q: { eq(f: string, v: unknown): unknown }) => unknown): { first(): Promise<unknown> }
}
const rawDb = (db: unknown) => db as { query(t: string): Indexed & { take(n: number): Promise<Record<string, unknown>[]> }; insert(t: string, d: object): Promise<string>; patch(t: string, id: string, d: object): Promise<void> }

async function inboxRow(db: unknown, inboxId: string): Promise<InboxArchiveRow | null> {
  return (await rawDb(db)
    .query("docInboxArchive")
    .withIndex("by_inbox", (q) => q.eq("inboxId", inboxId))
    .first()) as InboxArchiveRow | null
}

/** Gavimas consumer: hands every received email to the archive. */
export function documentsIngestConsumer(options: EmailArchiveOptions = {}): IngestConsumer {
  const mod = options.functionsModule ?? "documents"
  const ref = makeFunctionReference<"action">(`${mod}:_archiveEmail`)
  const addRef = makeFunctionReference<"mutation">(`${mod}:_addEmailInbox`)
  return {
    id: DOCUMENTS_CONSUMER_ID,
    label: "Dokumentai",
    linked: async () => [],
    deliver: async ({ db, sys, scheduler }, email: ReceivedEmail) => {
      const at = Date.now()
      const out = (outcome: "accepted" | "skipped" | "duplicate") => [{ consumer: DOCUMENTS_CONSUMER_ID, refId: email.resendEmailId, name: REF_NAME, outcome, at }]
      if (!isModuleEnabled(sys, await sys.store.get("modules", DOCUMENTS_MODULE_ID))) return []
      const row = await inboxRow(db, email.inbox.id)
      if (row && !row.store) return out("skipped")
      const inboxName = email.inbox.name || email.inbox.address
      // Already filed, or being filed for another inbox (one webhook, several inboxes): only add this inbox's label.
      const db2 = rawDb(db)
      const filed = await db2
        .query("docDocuments")
        .withIndex("by_email", (q) => q.eq("emailKey", email.resendEmailId))
        .first()
      const queued = (await db2
        .query("docEmailQueue")
        .withIndex("by_email", (q) => q.eq("emailKey", email.resendEmailId))
        .first()) as { _id: string; inboxNames: string[]; createdAt: number } | null
      if (filed) {
        await scheduler.runAfter(0, addRef, { emailKey: email.resendEmailId, inboxName })
        return out("duplicate")
      }
      const names = [...new Set([...(queued?.inboxNames ?? []), inboxName])]
      // A queue row younger than STALE_MS means a run is on it; an older one is a run that died: start again.
      if (queued && at - queued.createdAt < STALE_MS) {
        if (names.length !== queued.inboxNames.length) await db2.patch("docEmailQueue", queued._id, { inboxNames: names })
        return out("duplicate")
      }
      if (queued) await db2.patch("docEmailQueue", queued._id, { inboxNames: names, createdAt: at })
      else await db2.insert("docEmailQueue", { emailKey: email.resendEmailId, inboxNames: [inboxName], createdAt: at })
      const text = (email.text.trim() || (email.html ? htmlToText(email.html) : "")).slice(0, MAX_TEXT)
      await scheduler.runAfter(0, ref, {
        resendEmailId: email.resendEmailId,
        inboxName,
        inboxAddress: email.inbox.address,
        from: email.from,
        ...(email.fromName ? { fromName: email.fromName } : {}),
        to: email.to.slice(0, 50),
        subject: email.subject.slice(0, 500),
        text,
        receivedAt: email.receivedAt,
        attachments: email.attachments.slice(0, 50).map((x) => ({
          ...(x.id ? { id: x.id } : {}),
          name: x.name,
          ...(x.type ? { type: x.type } : {}),
          ...(x.size !== undefined ? { size: x.size } : {}),
          ...(x.inline !== undefined ? { inline: x.inline } : {}),
        })),
      })
      return out("accepted")
    },
    status: async (db, deliveries) =>
      Promise.all(
        deliveries.map(async (d) => {
          if (d.consumer !== DOCUMENTS_CONSUMER_ID || d.outcome === "skipped") return { status: null, href: null }
          const doc = (await rawDb(db)
            .query("docDocuments")
            .withIndex("by_email", (q) => q.eq("emailKey", d.refId))
            .first()) as { _id: string } | null
          return doc ? { status: "stored", href: `/app/documents/${doc._id}` } : { status: "pending", href: null }
        }),
      ),
  }
}

interface Attachment {
  id?: string
  name: string
  type?: string
  size?: number
  inline?: boolean
}

export interface EmailArchiveFunctionOptions {
  functionsModule: string
  maxFileSize: number
  font: () => Promise<Uint8Array | null>
}

export function defineEmailArchive(system: ConvexSystem, options: EmailArchiveFunctionOptions) {
  const fileRef = makeFunctionReference<"mutation">(`${options.functionsModule}:_fileEmail`)
  const selfRef = makeFunctionReference<"action">(`${options.functionsModule}:_archiveEmail`)

  /** Downloads the attachments Resend kept for a received email. Errors are reported, never thrown. */
  async function downloadAttachments(resendEmailId: string, wanted: Attachment[]): Promise<{ files: { name: string; type: string; bytes: Uint8Array }[]; error?: string }> {
    const keep = wanted.filter((x) => !(x.inline && (x.type ?? "").startsWith("image/") && (x.size ?? 0) < MIN_INLINE_IMAGE) && (x.size ?? 0) <= options.maxFileSize)
    if (!keep.length) return { files: [] }
    const key = resendApiKey()
    if (!key) return { files: [], error: "attachments_skipped: RESEND_RECEIVING_API_KEY is not set" }
    try {
      const res = await fetch(`${RESEND_API}/emails/receiving/${encodeURIComponent(resendEmailId)}/attachments?limit=100`, { headers: { Authorization: `Bearer ${key}` } })
      if (!res.ok) return { files: [], error: `attachments_list_failed: HTTP ${res.status}` }
      const body = (await res.json()) as { data?: { id?: string; filename?: string; content_type?: string; size?: number; download_url?: string }[] }
      const files: { name: string; type: string; bytes: Uint8Array }[] = []
      const problems: string[] = []
      for (const want of keep) {
        const hit = (body.data ?? []).find((x) => (want.id && x.id === want.id) || (!want.id && x.filename === want.name))
        if (!hit?.download_url) {
          problems.push(`${want.name}: missing`)
          continue
        }
        if ((hit.size ?? 0) > options.maxFileSize) continue
        const file = await fetch(hit.download_url)
        if (!file.ok) {
          problems.push(`${want.name}: HTTP ${file.status}`)
          continue
        }
        const bytes = new Uint8Array(await file.arrayBuffer())
        if (bytes.byteLength > options.maxFileSize) continue
        files.push({ name: hit.filename || want.name, type: hit.content_type || want.type || "application/octet-stream", bytes })
      }
      return problems.length ? { files, error: `attachments_failed: ${problems.join("; ").slice(0, 400)}` } : { files }
    } catch (e) {
      return { files: [], error: `attachments_failed: ${String(e).slice(0, 300)}` }
    }
  }

  const formatDate = (ms: number) => {
    try {
      return new Intl.DateTimeFormat("lt-LT", { dateStyle: "long", timeStyle: "short", timeZone: "Europe/Vilnius" }).format(ms)
    } catch {
      return new Date(ms).toISOString().replace("T", " ").slice(0, 16)
    }
  }

  type ArchiveArgs = {
    resendEmailId: string
    inboxName: string
    inboxAddress: string
    from: string
    fromName?: string | undefined
    to: string[]
    subject: string
    text: string
    receivedAt: number
    attachments: Attachment[]
  }
  type ActionCtx = { storage: { store(b: Blob): Promise<string> }; runMutation(ref: never, args: never): Promise<unknown> }

  async function archive(ctx: ActionCtx, a: ArchiveArgs, stored: StorageId[]): Promise<void> {
    const sender = a.fromName ? `${a.fromName} <${a.from}>` : a.from
    const { files, error } = await downloadAttachments(a.resendEmailId, a.attachments)
    const pdf = await renderEmailPdf({
      subject: a.subject,
      from: sender,
      to: a.to,
      date: formatDate(a.receivedAt),
      inbox: a.inboxName === a.inboxAddress ? a.inboxAddress : `${a.inboxName} <${a.inboxAddress}>`,
      text: a.text,
      attachments: a.attachments.map((x) => x.name),
      font: await options.font(),
    })
    const store = async (blob: Blob) => {
      const id = (await ctx.storage.store(blob)) as StorageId
      stored.push(id)
      return id
    }
    const storageId = await store(new Blob([pdf as BlobPart], { type: "application/pdf" }))
    const attachments: { storageId: StorageId; fileName: string }[] = []
    for (const f of files) attachments.push({ storageId: await store(new Blob([f.bytes as BlobPart], { type: f.type })), fileName: f.name })
    await ctx.runMutation(fileRef as never, {
      emailKey: a.resendEmailId,
      inboxName: a.inboxName,
      subject: a.subject,
      sender: a.fromName || a.from,
      receivedAt: a.receivedAt,
      content: [a.subject, `${sender}`, a.to.join(", "), a.text].filter(Boolean).join("\n"),
      storageId,
      attachments,
      ...(error ? { error } : {}),
    } as never)
  }

  return {
    /** Renders the email PDF, downloads attachments, then files them all (`_fileEmail`). */
    _archiveEmail: internalActionGeneric({
      args: {
        resendEmailId: v.string(),
        inboxName: v.string(),
        inboxAddress: v.string(),
        from: v.string(),
        fromName: v.optional(v.string()),
        to: v.array(v.string()),
        subject: v.string(),
        text: v.string(),
        receivedAt: v.number(),
        attachments: v.array(v.object({ id: v.optional(v.string()), name: v.string(), type: v.optional(v.string()), size: v.optional(v.number()), inline: v.optional(v.boolean()) })),
        /** Retries so far (a failed run tries again with backoff, MAX_ATTEMPTS in all). */
        attempt: v.optional(v.number()),
      },
      handler: async (ctx, a): Promise<void> => {
        const stored: StorageId[] = []
        try {
          await archive(ctx, a, stored)
        } catch (e) {
          // Nothing is filed: drop what this run stored and try again later (Resend keeps the mail for days).
          for (const id of stored) await ctx.storage.delete(id).catch(() => undefined)
          const attempt = (a.attempt ?? 0) + 1
          console.error(`documents: filing email ${a.resendEmailId} failed (attempt ${attempt} of ${MAX_ATTEMPTS})`, e)
          if (attempt >= MAX_ATTEMPTS) throw e
          await ctx.scheduler.runAfter(RETRY_MS * 4 ** (attempt - 1), selfRef as never, { ...a, attempt } as never)
        }
      },
    }),

    /** Inboxes and whether their mail is filed into the archive. */
    getEmailArchive: queryGeneric({
      args: { ...actorArgs },
      handler: async (ctx, a): Promise<EmailArchiveSettings> => {
        await system.requirePermission(ctx, DocumentsPermissions.manageLabels, opts(a))
        const db = rawDb(ctx.db)
        let inboxes: Record<string, unknown>[]
        try {
          inboxes = await db.query("ingestInboxes").take(500)
        } catch {
          return { available: false, inboxes: [], tag: null }
        }
        const rows = (await db.query("docInboxArchive").take(1000)) as unknown as InboxArchiveRow[]
        const off = new Set(rows.filter((r) => !r.store).map((r) => r.inboxId))
        const tag = ((await db.query("docTags").take(1000)) as unknown as { _id: string; system?: string; access?: unknown }[]).find((t) => t.system === "email") ?? null
        const str = (x: unknown) => (typeof x === "string" ? x : "")
        return {
          available: true,
          inboxes: inboxes
            .filter((i) => !i.deleted)
            .map((i) => ({ id: str(i._id), name: str(i.name), address: str(i.address), status: str(i.status), store: !off.has(str(i._id)) }))
            .sort((x, y) => x.name.localeCompare(y.name)),
          tag: tag ? { id: tag._id, restricted: Boolean(tag.access) } : null,
        }
      },
    }),

    /** Switches filing of an inbox's mail on or off (new mail only; filed documents stay). */
    setInboxArchive: mutationGeneric({
      args: { ...actorArgs, inboxId: v.string(), store: v.boolean() },
      handler: async (ctx, a): Promise<{ operationId: string }> => {
        const { sys, actor } = await system.requirePermission(ctx, DocumentsPermissions.manageLabels, opts(a))
        if (!(await ingestInboxes.addressOf(ctx.db, a.inboxId))) fail("NOT_FOUND", "inbox_not_found", sys.operationId)
        const row = await inboxRow(ctx.db, a.inboxId)
        const db = rawDb(ctx.db)
        if (row) await db.patch("docInboxArchive", row._id, { store: a.store, updatedAt: Date.now() })
        else await db.insert("docInboxArchive", { inboxId: a.inboxId, store: a.store, updatedAt: Date.now() })
        await recordAudit(sys, actor, { action: "documents.email.inbox", targetType: "ingestInboxes", targetId: a.inboxId, changes: { store: a.store } })
        return { operationId: sys.operationId }
      },
    }),
  }
}
