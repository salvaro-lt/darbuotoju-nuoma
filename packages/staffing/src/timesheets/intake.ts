// DIG-111: client timesheets by email. Clients send PDF exports from their
// project systems; every client a different layout.
//
// A Gavimas (ingest) inbox, e.g. `tabeliai@…`, is linked to the consumer
// `timesheets` (Gavimas → inbox → "Kas skaito šią dėžutę" → Tabeliai). Every
// email received there with a PDF becomes an intake row; `_processIntake`
// matches it to a client / project (project code in subject, file name or
// text; else sender domain vs. client contacts), downloads the PDF from
// Resend, files a client sheet with `review: "pending"`, starts the AI reader
// and notifies the coordinators. The same path runs for "Importuoti iš gautų
// laiškų" (an email already in Gavimas, picked by hand).
//
// Without RESEND_RECEIVING_API_KEY the PDF cannot be downloaded and without
// OPENAI_API_KEY it cannot be read: the sheet is still filed (pending review,
// with the reason) and rows can be entered by hand.
//
//   // convex/automationsConfig.ts
//   export const ingestConsumers = [..., timesheetsIngestConsumer()]
import { internalActionGeneric, internalMutationGeneric, makeFunctionReference, mutationGeneric, queryGeneric } from "convex/server"
import { v } from "convex/values"
import { decide, forbidden, isModuleEnabled, notifyIfInstalled, recordAudit, withOperation, type Actor, type ConvexSystem } from "@digimuza/system-core/convex"
import { resendApiKey, RESEND_API, type IngestConsumer, type IngestDelivery, type ReceivedEmail } from "@digimuza/system-core/ingest"
import { addDays, todayIso } from "../pure"
import { actorArgs, actorId, fail, opts, type DbCtxLike } from "../shared"
import { STAFFING_TIMESHEETS_MODULE_ID, StaffingTimesheetsPermissions as P } from "./manifest"
import { tsReader } from "./operations"
import { isPdfAttachment, lastCompletedPeriodEnd, matchIntake, periodStart, weekStartOf, type TimesheetCadence } from "./pure"
import { tsWriter } from "./reads"
import type { IntakeStatus } from "./tables"

export const TIMESHEETS_CONSUMER_ID = "timesheets"
/** The one thing an inbox links to: "read client timesheets from here". */
const REF_ID = "client-sheets"
const REF_NAME = "Klientų tabeliai (PDF → sutikrinimas)"
const MAX_PDF = 15 * 1024 * 1024

type Attachment = { id?: string; name: string; type?: string; size?: number }

// Ingest hands consumers an untyped db; these are the intake tables' shapes.
type RawDb = {
  query(table: string): {
    withIndex(name: string, range: (q: { eq(f: string, v: unknown): unknown }) => unknown): { first(): Promise<unknown>; take(n: number): Promise<unknown[]> }
  }
  insert(table: string, doc: object): Promise<string>
  delete(table: string, id: string): Promise<void>
  normalizeId(table: string, id: string): string | null
  get(id: string): Promise<unknown>
}
const raw = (db: unknown) => db as RawDb

async function inboxLinks(db: unknown, inboxId: string) {
  return (await raw(db)
    .query("staffing_timesheets_inboxLinks")
    .withIndex("by_inbox", (q) => q.eq("inboxId", inboxId))
    .take(10)) as { _id: string; inboxId: string }[]
}

export interface TimesheetsConsumerOptions {
  /** Module path (relative to `convex/`) of the timesheets functions. Default "timesheets". */
  functionsModule?: string
}

/** Gavimas consumer: received PDFs in linked inboxes become client sheets to review. */
export function timesheetsIngestConsumer(options: TimesheetsConsumerOptions = {}): IngestConsumer {
  const processRef = makeFunctionReference<"action">(`${options.functionsModule ?? "timesheets"}:_processIntake`)
  return {
    id: TIMESHEETS_CONSUMER_ID,
    label: "Tabeliai",
    async linked(db, inbox) {
      return (await inboxLinks(db, inbox.id)).length ? [{ consumer: TIMESHEETS_CONSUMER_ID, id: REF_ID, name: REF_NAME, enabled: true, href: "/app/timesheets" }] : []
    },
    async candidates() {
      return [{ id: REF_ID, name: REF_NAME, enabled: true }]
    },
    async link({ db, sys, actor }, refId, inbox, linked) {
      if (!(await decide(sys, actor, P.clientManage)).allowed) throw withOperation(sys, forbidden("timesheets_client_manage_required"))
      if (refId !== REF_ID) return
      const rows = await inboxLinks(db, inbox.id)
      if (linked && !rows.length) await raw(db).insert("staffing_timesheets_inboxLinks", { inboxId: inbox.id, address: inbox.address, createdAt: Date.now(), createdBy: actor.kind === "user" ? actor.userId : actor.apiKeyId })
      else if (!linked) for (const r of rows) await raw(db).delete("staffing_timesheets_inboxLinks", r._id)
      else return
      await recordAudit(sys, actor, { action: linked ? "staffing-timesheets.inbox.link" : "staffing-timesheets.inbox.unlink", targetType: "ingest_inbox", targetId: inbox.id, changes: { address: inbox.address } })
    },
    async deliver({ db, sys, scheduler }, email: ReceivedEmail): Promise<IngestDelivery[]> {
      if (!(await inboxLinks(db, email.inbox.id)).length) return []
      const at = Date.now()
      const base = { consumer: TIMESHEETS_CONSUMER_ID, refId: REF_ID, name: REF_NAME, at }
      if (!isModuleEnabled(sys, await sys.store.get("modules", STAFFING_TIMESHEETS_MODULE_ID))) return [{ ...base, outcome: "skipped" }]
      const dup = (await raw(db)
        .query("staffing_timesheets_intake")
        .withIndex("by_email", (q) => q.eq("emailKey", email.resendEmailId))
        .first()) as { _id: string } | null
      if (dup) return [{ ...base, runId: dup._id, outcome: "duplicate" }]
      const attachments = email.attachments.slice(0, 20).map((x) => ({ ...(x.id ? { id: x.id } : {}), name: x.name, ...(x.type ? { type: x.type } : {}), ...(x.size !== undefined ? { size: x.size } : {}) }))
      const id = await raw(db).insert("staffing_timesheets_intake", intakeDoc({ emailKey: email.resendEmailId, inboxAddress: email.inbox.address, from: email.from, fromName: email.fromName, subject: email.subject, text: email.text, receivedAt: email.receivedAt, attachments }, "ingest"))
      await scheduler.runAfter(0, processRef, { intakeId: id })
      return [{ ...base, runId: id, outcome: "accepted" }]
    },
    async status(db, deliveries) {
      return Promise.all(
        deliveries.map(async (d) => {
          if (d.consumer !== TIMESHEETS_CONSUMER_ID || !d.runId) return { status: null, href: null }
          const id = raw(db).normalizeId("staffing_timesheets_intake", d.runId)
          const row = id ? ((await raw(db).get(id)) as { status: IntakeStatus; sheetId?: string } | null) : null
          return { status: row?.status ?? null, href: row?.sheetId ? `/app/timesheets/sheets/${row.sheetId}` : "/app/timesheets" }
        }),
      )
    },
  }
}

function intakeDoc(e: { emailKey: string; inboxAddress: string; from: string; fromName?: string | undefined; subject: string; text?: string | undefined; receivedAt: number; attachments: Attachment[] }, createdBy: string) {
  return {
    emailKey: e.emailKey,
    inboxAddress: e.inboxAddress,
    from: e.from,
    ...(e.fromName ? { fromName: e.fromName } : {}),
    subject: e.subject.slice(0, 500),
    ...(e.text?.trim() ? { text: e.text.slice(0, 20_000) } : {}),
    receivedAt: e.receivedAt,
    attachments: e.attachments,
    status: "queued" as const,
    createdAt: Date.now(),
    createdBy,
  }
}

export interface IntakeRow {
  id: string
  from: string
  fromName: string | null
  subject: string
  receivedAt: number
  pdfs: string[]
  status: IntakeStatus
  project: { id: string; code: string; name: string } | null
  clientName: string | null
  matchedBy: "project_code" | "sender_domain" | "manual" | null
  sheetId: string | null
  error: string | null
}

export interface ReceivedPdfEmail {
  emailId: string
  inbox: string
  from: string
  subject: string
  receivedAt: number
  pdfs: string[]
  /** Already taken in (intake row exists). */
  intakeId: string | null
}

/** Ingest's received email as stored (`ingestEmails`). */
type IngestEmailDoc = { _id: string; resendEmailId: string; inboxId: string; from: string; fromName?: string; subject: string; text?: string; receivedAt: number; attachments: Attachment[] }

export function defineTimesheetsIntake(system: ConvexSystem, deps: { ref: (name: string) => never }) {
  const { ref } = deps

  async function guessPeriod(ctx: DbCtxLike, projectId: string): Promise<{ from: string; to: string }> {
    const db = tsReader(ctx)
    const p = await db.get("staffing_projects", projectId as never)
    const s = await db
      .query("staffing_timesheets_settings")
      .withIndex("by_project", (q) => q.eq("projectId", projectId as never))
      .first()
    const cadence: TimesheetCadence = s?.cadence ?? "weekly"
    const today = todayIso()
    const end = p ? lastCompletedPeriodEnd(cadence, p.startDate, today) : null
    if (end) return { from: periodStart(cadence, end), to: end }
    const monday = weekStartOf(today)
    return { from: addDays(monday, -7), to: addDays(monday, -1) }
  }

  async function intakeView(ctx: DbCtxLike, r: { _id: string } & Record<string, unknown>): Promise<IntakeRow> {
    const row = r as unknown as { _id: string; from: string; fromName?: string; subject: string; receivedAt: number; attachments: Attachment[]; status: IntakeStatus; projectId?: string; clientId?: string; matchedBy?: IntakeRow["matchedBy"]; sheetId?: string; error?: string }
    const db = tsReader(ctx)
    const p = row.projectId ? await db.get("staffing_projects", row.projectId as never) : null
    const c = row.clientId ? await db.get("staffing_clients", row.clientId as never) : p ? await db.get("staffing_clients", p.clientId) : null
    return {
      id: row._id,
      from: row.from,
      fromName: row.fromName ?? null,
      subject: row.subject,
      receivedAt: row.receivedAt,
      pdfs: row.attachments.filter(isPdfAttachment).map((x) => x.name),
      status: row.status,
      project: p ? { id: p._id, code: p.code, name: p.name } : null,
      clientName: c?.name ?? null,
      matchedBy: row.matchedBy ?? null,
      sheetId: row.sheetId ?? null,
      error: row.error ?? null,
    }
  }

  async function queueIntake(ctx: DbCtxLike & { scheduler: { runAfter(ms: number, fn: never, args: never): Promise<unknown> } }, e: IngestEmailDoc, inboxAddress: string, actor: Actor) {
    const db = tsWriter(ctx)
    const existing = await db
      .query("staffing_timesheets_intake")
      .withIndex("by_email", (q) => q.eq("emailKey", e.resendEmailId))
      .first()
    if (existing) return { id: existing._id, existing: true }
    const id = await db.insert("staffing_timesheets_intake", intakeDoc({ emailKey: e.resendEmailId, inboxAddress, from: e.from, fromName: e.fromName, subject: e.subject, text: e.text, receivedAt: e.receivedAt, attachments: e.attachments.slice(0, 20) }, actorId(actor)))
    await ctx.scheduler.runAfter(0, ref("_processIntake"), { intakeId: id } as never)
    return { id, existing: false }
  }

  /** Resend keeps received attachments; the documents archive downloads them the same way. */
  async function downloadPdf(resendEmailId: string, want: Attachment): Promise<{ bytes: Uint8Array; name: string } | { error: string }> {
    const key = resendApiKey()
    if (!key) return { error: "resend_not_configured" }
    try {
      const res = await fetch(`${RESEND_API}/emails/receiving/${encodeURIComponent(resendEmailId)}/attachments?limit=100`, { headers: { Authorization: `Bearer ${key}` } })
      if (!res.ok) return { error: `attachments_http_${res.status}` }
      const body = (await res.json()) as { data?: { id?: string; filename?: string; size?: number; download_url?: string }[] }
      const hit = (body.data ?? []).find((x) => (want.id && x.id === want.id) || x.filename === want.name)
      if (!hit?.download_url) return { error: "attachment_missing" }
      if ((hit.size ?? 0) > MAX_PDF) return { error: "attachment_too_large" }
      const file = await fetch(hit.download_url)
      if (!file.ok) return { error: `download_http_${file.status}` }
      const bytes = new Uint8Array(await file.arrayBuffer())
      if (bytes.byteLength > MAX_PDF) return { error: "attachment_too_large" }
      return { bytes, name: hit.filename || want.name }
    } catch {
      return { error: "network" }
    }
  }

  return {
    /** Client timesheets received by email (newest first). */
    listIntake: queryGeneric({
      args: { ...actorArgs },
      handler: async (ctx, a): Promise<{ rows: IntakeRow[]; inboxes: string[] }> => {
        await system.requirePermission(ctx, P.read, opts(a))
        const db = tsReader(ctx)
        const rows = await db.query("staffing_timesheets_intake").withIndex("by_created").order("desc").take(25)
        const links = await db.query("staffing_timesheets_inboxLinks").take(20)
        return { rows: await Promise.all(rows.map((r) => intakeView(ctx, r))), inboxes: links.map((l) => l.address) }
      },
    }),

    /** Recent emails in Gavimas inboxes with a PDF attached, for "Importuoti iš gautų laiškų". */
    listReceivedPdfEmails: queryGeneric({
      args: { ...actorArgs },
      handler: async (ctx, a): Promise<ReceivedPdfEmail[]> => {
        await system.requirePermission(ctx, P.clientManage, opts(a))
        const db = raw(ctx.db)
        let emails: IngestEmailDoc[] = []
        try {
          emails = (await (db.query("ingestEmails") as unknown as { withIndex(n: string): { order(o: "desc"): { take(n: number): Promise<unknown[]> } } }).withIndex("by_received").order("desc").take(100)) as IngestEmailDoc[]
        } catch {
          return [] // the app has no Gavimas tables
        }
        const out: ReceivedPdfEmail[] = []
        for (const e of emails) {
          const pdfs = e.attachments.filter(isPdfAttachment).map((x) => x.name)
          if (!pdfs.length) continue
          const inbox = (await db.get(e.inboxId)) as { address?: string } | null
          const intake = (await db
            .query("staffing_timesheets_intake")
            .withIndex("by_email", (q) => q.eq("emailKey", e.resendEmailId))
            .first()) as { _id: string } | null
          out.push({ emailId: e._id, inbox: inbox?.address ?? "", from: e.from, subject: e.subject, receivedAt: e.receivedAt, pdfs, intakeId: intake?._id ?? null })
          if (out.length >= 30) break
        }
        return out
      },
    }),

    /** Takes a received email in as a client timesheet (same path as a linked inbox). */
    importReceivedEmail: mutationGeneric({
      args: { ...actorArgs, emailId: v.string() },
      handler: async (ctx, a) => {
        const { sys, actor } = await system.requirePermission(ctx, P.clientManage, opts(a))
        const op = sys.operationId
        const db = raw(ctx.db)
        const id = db.normalizeId("ingestEmails", a.emailId)
        const e = id ? ((await db.get(id)) as IngestEmailDoc | null) : null
        if (!e) fail("NOT_FOUND", "email_not_found", op)
        if (!e.attachments.some(isPdfAttachment)) fail("VALIDATION", "no_pdf", op)
        const inbox = (await db.get(e.inboxId)) as { address?: string } | null
        const r = await queueIntake(ctx, e, inbox?.address ?? "", actor)
        await recordAudit(sys, actor, { action: "staffing-timesheets.intake.import", targetType: "staffing_timesheets_intake", targetId: r.id, changes: { existing: r.existing } })
        return { id: r.id, existing: r.existing, operationId: op }
      },
    }),

    /** Picks the project of an email that matched no project (or the wrong one) and files it again. */
    assignIntake: mutationGeneric({
      args: { ...actorArgs, intakeId: v.id("staffing_timesheets_intake"), projectId: v.id("staffing_projects") },
      handler: async (ctx, a) => {
        const { sys, actor } = await system.requirePermission(ctx, P.clientManage, opts(a))
        const op = sys.operationId
        const db = tsWriter(ctx)
        const row = await db.get("staffing_timesheets_intake", a.intakeId)
        if (!row) fail("NOT_FOUND", "intake_not_found", op)
        if (row.sheetId && (await db.get("staffing_timesheets_clientSheets", row.sheetId))) fail("CONFLICT", "already_imported", op)
        const p = await db.get("staffing_projects", a.projectId)
        if (!p) fail("NOT_FOUND", "project_not_found", op)
        await db.patch("staffing_timesheets_intake", row._id, { projectId: p._id, clientId: p.clientId, matchedBy: "manual", status: "queued", error: undefined, sheetId: undefined })
        await ctx.scheduler.runAfter(0, ref("_processIntake"), { intakeId: row._id } as never)
        await recordAudit(sys, actor, { action: "staffing-timesheets.intake.assign", targetType: "staffing_timesheets_intake", targetId: row._id, changes: { projectId: p._id } })
        return { operationId: op }
      },
    }),

    /** "Peržiūrėta": a sheet that came in by email was checked by a person. */
    confirmSheetReview: mutationGeneric({
      args: { ...actorArgs, sheetId: v.id("staffing_timesheets_clientSheets") },
      handler: async (ctx, a) => {
        const { sys, actor } = await system.requirePermission(ctx, P.clientManage, opts(a))
        const db = tsWriter(ctx)
        const s = await db.get("staffing_timesheets_clientSheets", a.sheetId)
        if (!s) fail("NOT_FOUND", "sheet_not_found", sys.operationId)
        await db.patch("staffing_timesheets_clientSheets", s._id, { review: "confirmed" })
        await recordAudit(sys, actor, { action: "staffing-timesheets.clientSheet.review", targetType: "staffing_timesheets_clientSheets", targetId: s._id })
        return { operationId: sys.operationId }
      },
    }),

    /** Step 1: match client / project; marks `no_pdf` / `no_match`. */
    _matchIntake: internalMutationGeneric({
      args: { intakeId: v.id("staffing_timesheets_intake") },
      handler: async (ctx, a): Promise<{ go: false } | { go: true; emailKey: string; pdf: Attachment }> => {
        const db = tsWriter(ctx)
        const row = await db.get("staffing_timesheets_intake", a.intakeId)
        if (!row || row.status !== "queued") return { go: false }
        const pdf = row.attachments.find(isPdfAttachment)
        if (!pdf) {
          await db.patch("staffing_timesheets_intake", row._id, { status: "no_pdf" })
          return { go: false }
        }
        if (!row.projectId) {
          const clients = await db.query("staffing_clients").withIndex("by_name").collect()
          const projects = await db.query("staffing_projects").withIndex("by_code").collect()
          const m = matchIntake(
            { from: row.from, subject: row.subject, ...(row.text ? { text: row.text } : {}), fileNames: row.attachments.map((x) => x.name) },
            clients.map((c) => ({ id: c._id, emails: c.contacts.map((x) => x.email ?? "").filter(Boolean) })),
            projects.map((p) => ({ id: p._id, code: p.code, clientId: p.clientId, status: p.status })),
          )
          if (!m.projectId) {
            await db.patch("staffing_timesheets_intake", row._id, { status: "no_match", ...(m.clientId ? { clientId: m.clientId as never } : {}), ...(m.by ? { matchedBy: m.by } : {}) })
            return { go: false }
          }
          await db.patch("staffing_timesheets_intake", row._id, { projectId: m.projectId as never, clientId: m.clientId as never, matchedBy: m.by! })
        }
        return { go: true, emailKey: row.emailKey, pdf }
      },
    }),

    /** Step 2: file the client sheet (pending review), start the AI reader, notify. */
    _intakeCreateSheet: internalMutationGeneric({
      args: { intakeId: v.id("staffing_timesheets_intake"), fileStorageId: v.optional(v.id("_storage")), fileName: v.string(), error: v.optional(v.string()) },
      handler: async (ctx, a): Promise<void> => {
        const db = tsWriter(ctx)
        const row = await db.get("staffing_timesheets_intake", a.intakeId)
        if (!row?.projectId || row.status !== "queued") return
        const p = await db.get("staffing_projects", row.projectId)
        if (!p) return
        const period = await guessPeriod(ctx, p._id)
        const sheetId = await db.insert("staffing_timesheets_clientSheets", {
          projectId: p._id,
          periodFrom: period.from,
          periodTo: period.to,
          source: "pdf",
          status: a.fileStorageId ? "parsing" : "failed",
          ...(a.fileStorageId ? { fileStorageId: a.fileStorageId } : {}),
          fileName: a.fileName.slice(0, 200),
          rows: [],
          nameMap: [],
          ...(a.error ? { error: a.error } : {}),
          receivedAt: row.receivedAt,
          createdBy: "email",
          review: "pending",
          email: { from: row.from, subject: row.subject, receivedAt: row.receivedAt },
        })
        if (a.fileStorageId) await ctx.scheduler.runAfter(0, ref("_parseWithAi"), { sheetId } as never)
        await db.patch("staffing_timesheets_intake", row._id, { status: "imported", sheetId, ...(a.error ? { error: a.error } : {}) })
        const { sys } = await system.context(ctx)
        await notifyIfInstalled(sys, {
          to: { permission: P.clientManage },
          type: "staffing-timesheets.client_sheet_received",
          params: { projectCode: p.code, from: row.from, fileName: a.fileName, rows: 0 },
          href: `/app/timesheets/sheets/${sheetId}`,
          actor: "system",
        })
        await recordAudit(sys, "system", { action: "staffing-timesheets.intake.file", targetType: "staffing_timesheets_clientSheets", targetId: sheetId, changes: { intakeId: row._id, projectId: p._id, matchedBy: row.matchedBy ?? null } })
      },
    }),

    _intakeFailed: internalMutationGeneric({
      args: { intakeId: v.id("staffing_timesheets_intake"), error: v.string() },
      handler: async (ctx, a): Promise<void> => {
        await tsWriter(ctx).patch("staffing_timesheets_intake", a.intakeId, { status: "failed", error: a.error.slice(0, 300) })
      },
    }),

    _processIntake: internalActionGeneric({
      args: { intakeId: v.id("staffing_timesheets_intake") },
      handler: async (ctx, a): Promise<void> => {
        try {
          const m = (await ctx.runMutation(ref("_matchIntake"), { intakeId: a.intakeId } as never)) as { go: false } | { go: true; emailKey: string; pdf: Attachment }
          if (!m.go) return
          const file = await downloadPdf(m.emailKey, m.pdf)
          if ("error" in file) {
            await ctx.runMutation(ref("_intakeCreateSheet"), { intakeId: a.intakeId, fileName: m.pdf.name, error: file.error } as never)
            return
          }
          const storageId = await ctx.storage.store(new Blob([file.bytes as BlobPart], { type: "application/pdf" }))
          await ctx.runMutation(ref("_intakeCreateSheet"), { intakeId: a.intakeId, fileStorageId: storageId, fileName: file.name } as never)
        } catch (e) {
          await ctx.runMutation(ref("_intakeFailed"), { intakeId: a.intakeId, error: e instanceof Error ? e.message : String(e) } as never)
        }
      },
    }),
  }
}
