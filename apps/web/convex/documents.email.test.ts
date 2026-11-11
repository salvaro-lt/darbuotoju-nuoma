import { convexTest } from "convex-test"
import { svixSignature } from "@digimuza/system-core/automations"
import { PDFDocument } from "pdf-lib"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { api, internal } from "./_generated/api"
import schema from "./schema"
import { modules } from "./test.setup"

// The email archive: Gavimas (ingest) hands every received email to the documents
// consumer, which files it as a PDF plus one document per attachment. Resend (the
// received email, its attachment list and downloads) is faked.

type T = ReturnType<typeof setup>
type User = ReturnType<T["withIdentity"]>
const setup = () => convexTest(schema, modules)

const ISSUER = "https://api.workos.com/user_management/client_TEST123"
const person = (name: string) => ({ subject: `user_${name}`, issuer: ISSUER, email: `${name}@acme.test`, email_verified: true })
const SECRET = "whsec_c2VjcmV0LXNpZ25pbmcta2V5LWZvci10ZXN0cw=="

let sent: { text?: string }[] = []
let received: Record<string, unknown> = {}
let files: Record<string, { body: Uint8Array; type: string; name: string; id: string }[]> = {}
let attachmentListStatus = 200
beforeEach(() => {
  sent = []
  received = {}
  files = {}
  attachmentListStatus = 200
  process.env.RESEND_RECEIVING_API_KEY = "re_test"
  process.env.RESEND_WEBHOOK_SECRET = SECRET
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    const u = String(url)
    const list = /^https:\/\/api\.resend\.com\/emails\/receiving\/([^/?]+)\/attachments/.exec(u)
    if (list) {
      const data = (files[list[1]!] ?? []).map((f) => ({ id: f.id, filename: f.name, content_type: f.type, size: f.body.byteLength, download_url: `https://cdn.test/${list[1]}/${f.id}` }))
      return new Response(JSON.stringify({ object: "list", has_more: false, data }), { status: attachmentListStatus })
    }
    const cdn = /^https:\/\/cdn\.test\/([^/]+)\/(.+)$/.exec(u)
    if (cdn) {
      const f = files[cdn[1]!]?.find((x) => x.id === cdn[2])
      return f ? new Response(f.body as BodyInit, { status: 200, headers: { "content-type": f.type } }) : new Response("", { status: 404 })
    }
    const m = /^https:\/\/api\.resend\.com\/emails\/receiving\/([^?/]+)/.exec(u)
    if (m) return received[m[1]!] ? new Response(JSON.stringify(received[m[1]!]), { status: 200 }) : new Response("{}", { status: 404 })
    if (!u.startsWith("https://api.resend.com/")) throw new Error(`unexpected fetch ${u}`)
    sent.push(JSON.parse(String(init?.body)))
    return new Response("{}", { status: 200 })
  })
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  for (const k of ["RESEND_RECEIVING_API_KEY", "RESEND_WEBHOOK_SECRET"]) delete process.env[k]
})

async function join(t: T, superUser: User, name: string, roleId: string) {
  const p = person(name)
  await superUser.action(api.system.createInvite, { email: p.email, roleIds: [roleId] })
  const token = new URL(sent.at(-1)!.text!.match(/https:\/\/app\.test\/invite\?token=\S+/)![0]).searchParams.get("token")!
  const as = t.withIdentity(p)
  await as.mutation(api.system.completeSignIn, { inviteToken: token })
  return as
}

async function bootstrap(t: T, { documents = true } = {}) {
  await t.mutation(internal.system.registerSystem, {})
  const superUser = t.withIdentity(person("super"))
  await superUser.mutation(api.system.completeSignIn, {})
  for (const moduleId of ["ingest", ...(documents ? ["documents"] : [])]) await superUser.mutation(api.system.setModuleEnabled, { moduleId, enabled: true })
  const role = async (name: string, subroleIds: string[]) => ((await superUser.mutation(api.system.createRole, { name, subroleIds })) as { roleId: string }).roleId
  const admin = await join(t, superUser, "adam", await role("Administracija", ["documents:admin", "ingest:admin"]))
  const editor = await join(t, superUser, "eve", await role("Redaktoriai", ["documents:editor"]))
  await admin.mutation(api.ingest.setManagedDomain, { domain: "abc123.resend.app" })
  const a = await admin.mutation(api.ingest.createInbox, { name: "Užklausos", localPart: "uzklausos" })
  const b = await admin.mutation(api.ingest.createInbox, { name: "Buhalterija", localPart: "buhalterija" })
  return { superUser, admin, editor, inboxA: a, inboxB: b }
}

let msg = 0
async function receive(t: T, email: { id: string; to: string[]; subject: string; text?: string; html?: string; from?: string; attachments?: { id: string; filename: string; content_type: string; size: number; content_disposition?: string }[] }) {
  received[email.id] = {
    id: email.id,
    from: email.from ?? "jonas@example.com",
    to: email.to,
    subject: email.subject,
    text: email.text ?? null,
    html: email.html ?? null,
    headers: { from: `Jonas Jonaitis <${email.from ?? "jonas@example.com"}>` },
    attachments: email.attachments ?? [],
  }
  const event = { type: "email.received", created_at: new Date().toISOString(), data: { email_id: email.id, from: email.from ?? "jonas@example.com", to: email.to, subject: email.subject } }
  const raw = JSON.stringify(event)
  const id = `msg_${++msg}`
  const ts = String(Math.floor(Date.now() / 1000))
  await t.mutation(api.ingest.receiveResendWebhook, { svixId: id, svixTimestamp: ts, svixSignature: await svixSignature(SECRET, id, ts, raw), raw })
  await t.finishAllScheduledFunctions(vi.runAllTimers)
}

async function invoicePdf() {
  const doc = await PDFDocument.create()
  doc.addPage([595, 842])
  doc.setTitle("SF-77")
  return doc.save()
}

describe("documents: email archive", () => {
  test("every received email is filed as a PDF with its attachments, labelled and restricted to admins", async () => {
    const t = setup()
    const { admin, editor, inboxA } = await bootstrap(t)
    const invoice = await invoicePdf()
    files.em_1 = [
      { id: "att_1", name: "saskaita-SF-77.pdf", type: "application/pdf", body: invoice },
      { id: "att_logo", name: "logo.png", type: "image/png", body: new Uint8Array(200) },
    ]
    await receive(t, {
      id: "em_1",
      to: [inboxA.address],
      subject: "Sąskaita SF-77",
      text: "Sveiki, siunčiame sąskaitą už spalį. Jonas",
      attachments: [
        { id: "att_1", filename: "saskaita-SF-77.pdf", content_type: "application/pdf", size: invoice.byteLength, content_disposition: "attachment" },
        { id: "att_logo", filename: "logo.png", content_type: "image/png", size: 200, content_disposition: "inline" },
      ],
    })

    const list = await admin.query(api.documents.listDocuments, {})
    expect(list.documents.map((d) => d.title).sort()).toEqual(["Sąskaita SF-77", "saskaita-SF-77"])
    const email = list.documents.find((d) => d.title === "Sąskaita SF-77")!
    const attachment = list.documents.find((d) => d.title === "saskaita-SF-77")!
    expect(email).toMatchObject({ fromEmail: true, mimeType: "application/pdf", restricted: true, parentId: null })
    expect(attachment).toMatchObject({ parentId: email.id, mimeType: "application/pdf" })

    const labels = await admin.query(api.documents.getLabels, {})
    const mailTag = labels.tags.find((x) => x.name === "El. laiškas")!
    const inboxTag = labels.tags.find((x) => x.name === "Užklausos")!
    expect(mailTag.access).toEqual({ userIds: [], roleIds: [] })
    expect(inboxTag.access).toBeNull()
    expect(email.tagIds.sort()).toEqual([mailTag.id, inboxTag.id].sort())
    expect(attachment.tagIds.sort()).toEqual([mailTag.id, inboxTag.id].sort())
    const sender = labels.correspondents.find((c) => c.id === email.correspondentId)!
    expect(sender.name).toBe("Jonas Jonaitis")

    const detail = (await admin.query(api.documents.getDocument, { documentId: email.id }))!
    expect(detail.content).toContain("siunčiame sąskaitą")
    expect(detail.attachments.map((x) => x.fileName)).toEqual(["saskaita-SF-77.pdf"])
    expect(detail.processingError).toBeNull()
    const pdfTitle = await t.run(async (ctx) => {
      const blob = await ctx.storage.get((await ctx.db.get(email.id))!.storageId)
      return (await PDFDocument.load(await blob!.arrayBuffer())).getTitle() ?? null
    })
    expect(pdfTitle).toBe("Sąskaita SF-77")
    // Found by the sender and the text.
    expect((await admin.query(api.documents.listDocuments, { filters: { search: "spalį" } })).total).toBe(1)

    // Editors (no "see all") do not see the mail, nor the label; granting their role opens it.
    expect((await editor.query(api.documents.listDocuments, {})).total).toBe(0)
    expect((await editor.query(api.documents.getLabels, {})).tags.map((x) => x.name)).toEqual(["Užklausos"])
    const opts = await admin.query(api.documents.getAccessOptions, {})
    await admin.mutation(api.documents.updateLabel, { kind: "tag", id: mailTag.id, access: { userIds: [], roleIds: [opts.roles.find((r) => r.name === "Redaktoriai")!.id] } })
    expect((await editor.query(api.documents.listDocuments, {})).total).toBe(2)

    // Gavimas shows the delivery and where it went.
    const { items } = await admin.query(api.ingest.listEmails, { inboxId: inboxA.inboxId })
    expect(items[0]!.deliveries).toEqual([expect.objectContaining({ consumer: "documents", outcome: "accepted", status: "stored", href: `/app/documents/${email.id}` })])
  })

  test("the same email in two inboxes is filed once with both inbox labels", async () => {
    const t = setup()
    const { admin, inboxA, inboxB } = await bootstrap(t)
    await receive(t, { id: "em_2", to: [inboxA.address, inboxB.address], subject: "Abiem", text: "Labas" })
    const { documents } = await admin.query(api.documents.listDocuments, {})
    expect(documents).toHaveLength(1)
    const labels = await admin.query(api.documents.getLabels, {})
    const names = documents[0]!.tagIds.map((id) => labels.tags.find((x) => x.id === id)!.name).sort()
    expect(names).toEqual(["Buhalterija", "El. laiškas", "Užklausos"])
  })

  test("an inbox can be switched off; a disabled module files nothing", async () => {
    const t = setup()
    const { admin, editor, inboxA, inboxB } = await bootstrap(t)
    expect(await editor.query(api.documents.getEmailArchive, {}).catch((e: { data?: { code?: string } }) => e.data?.code)).toBe("FORBIDDEN")
    const before = await admin.query(api.documents.getEmailArchive, {})
    expect(before.inboxes.map((i) => [i.name, i.store])).toEqual([
      ["Buhalterija", true],
      ["Užklausos", true],
    ])
    await admin.mutation(api.documents.setInboxArchive, { inboxId: inboxA.inboxId, store: false })
    expect((await admin.query(api.documents.getEmailArchive, {})).inboxes.find((i) => i.id === inboxA.inboxId)!.store).toBe(false)
    await receive(t, { id: "em_3", to: [inboxA.address], subject: "Nesaugoti", text: "x" })
    expect((await admin.query(api.documents.listDocuments, {})).total).toBe(0)
    const { items } = await admin.query(api.ingest.listEmails, { inboxId: inboxA.inboxId })
    expect(items[0]!.deliveries).toEqual([expect.objectContaining({ consumer: "documents", outcome: "skipped" })])
    // Inboxes can still be deleted (the archive does not hold them).
    await admin.mutation(api.ingest.deleteInbox, { inboxId: inboxB.inboxId })

    const t2 = setup()
    const off = await bootstrap(t2, { documents: false })
    await receive(t2, { id: "em_4", to: [off.inboxA.address], subject: "Be modulio", text: "x" })
    const rows = await t2.run(async (ctx) => ctx.db.query("docDocuments").collect())
    expect(rows).toHaveLength(0)
  })

  test("a failed attachment download still files the email, with the error shown; HTML-only mail is readable", async () => {
    const t = setup()
    const { admin, inboxA } = await bootstrap(t)
    attachmentListStatus = 500
    await receive(t, {
      id: "em_5",
      to: [inboxA.address],
      subject: "Su priedu",
      html: "<p>Sveiki,</p><p>priede <b>sutartis</b>.</p>",
      attachments: [{ id: "att_9", filename: "sutartis.pdf", content_type: "application/pdf", size: 1000, content_disposition: "attachment" }],
    })
    const { documents } = await admin.query(api.documents.listDocuments, {})
    expect(documents).toHaveLength(1)
    const detail = (await admin.query(api.documents.getDocument, { documentId: documents[0]!.id }))!
    expect(detail.processingError).toMatch(/attachments_list_failed: HTTP 500/)
    expect(detail.content).toContain("priede sutartis.")
  })
})

describe("documents: email archive review fixes", () => {
  test("a public label someone named \"El. laiškas\" is not taken over by archived mail", async () => {
    const t = setup()
    const { admin, editor, inboxA } = await bootstrap(t)
    await admin.mutation(api.documents.createLabel, { kind: "tag", name: "El. laiškas", match: "", algorithm: "none", caseSensitive: false })
    await receive(t, { id: "em_7", to: [inboxA.address], subject: "Slapta", text: "x" })
    expect((await editor.query(api.documents.listDocuments, {})).total).toBe(0)
    const labels = await admin.query(api.documents.getLabels, {})
    const doc = (await admin.query(api.documents.listDocuments, {})).documents[0]!
    const mail = labels.tags.find((x) => doc.tagIds.includes(x.id) && x.access)!
    expect(mail.name).toBe("El. laiškas (archyvas)")
    expect((await admin.query(api.documents.getEmailArchive, {})).tag).toEqual({ id: mail.id, restricted: true })
  })

  test("the inbox switch is guarded, audited and only takes inboxes", async () => {
    const t = setup()
    const { superUser, admin, inboxA } = await bootstrap(t)
    const code = (p: Promise<unknown>) => p.then(() => "OK").catch((e: { data?: { code?: string } }) => e.data?.code)
    expect(await code(t.mutation(api.documents.setInboxArchive, { inboxId: inboxA.inboxId, store: false }))).toBe("UNAUTHENTICATED")
    const { documentId } = await admin.mutation(api.documents.createDocument, { storageId: await t.run(async (ctx) => ctx.storage.store(new Blob([(await invoicePdf()) as BlobPart]))), fileName: "a.pdf" })
    expect(await code(admin.mutation(api.documents.setInboxArchive, { inboxId: documentId, store: false }))).toBe("NOT_FOUND")
    await admin.mutation(api.documents.setInboxArchive, { inboxId: inboxA.inboxId, store: false })
    const audit = (await superUser.query(api.system.listAudit, { actionPrefix: "documents.email.inbox" })) as { items: unknown[] }
    expect(audit.items).toHaveLength(1)
    await superUser.mutation(api.system.setModuleEnabled, { moduleId: "documents", enabled: false })
    expect(await code(admin.mutation(api.documents.setInboxArchive, { inboxId: inboxA.inboxId, store: true }))).toBe("FORBIDDEN")
  })
})
