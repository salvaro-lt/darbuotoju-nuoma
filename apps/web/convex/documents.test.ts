import { convexTest } from "convex-test"
import { PDFDocument } from "pdf-lib"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { api, internal } from "./_generated/api"
import type { Id } from "./_generated/dataModel"
import schema from "./schema"
import { modules } from "./test.setup"

// The documents module as installed in this app (convex/documents.ts).

type T = ReturnType<typeof setup>
type User = ReturnType<T["withIdentity"]>
const setup = () => convexTest(schema, modules)

const ISSUER = "https://api.workos.com/user_management/client_TEST123"
const SUPER = { subject: "user_super", issuer: ISSUER, email: "super@acme.test", email_verified: true }
const ALICE = { subject: "user_alice", issuer: ISSUER, email: "alice@acme.test", email_verified: true }
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="

let sent: { to: string[]; subject: string; text: string }[] = []
beforeEach(() => {
  sent = []
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    if (!String(url).startsWith("https://api.resend.com/")) throw new Error(`unexpected fetch ${url}`)
    sent.push(JSON.parse(String(init.body)))
    return new Response("{}", { status: 200 })
  })
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

const codeOf = async (p: Promise<unknown>) => {
  try {
    await p
    return "OK"
  } catch (e) {
    return (e as { data?: { code?: string } }).data?.code ?? String(e)
  }
}

async function documentsApp(t: T) {
  await t.mutation(internal.system.registerSystem, {})
  const superUser = t.withIdentity(SUPER)
  await superUser.mutation(api.system.completeSignIn, {})
  await superUser.mutation(api.system.setModuleEnabled, { moduleId: "documents", enabled: true })
  return superUser
}

async function inviteWithRole(t: T, superUser: User, subroleIds: string[]) {
  const { roleId } = (await superUser.mutation(api.system.createRole, { name: `Role ${subroleIds.join("+")}`, subroleIds })) as { roleId: string }
  await superUser.action(api.system.createInvite, { email: ALICE.email, roleIds: [roleId] })
  const token = new URL(sent.at(-1)!.text.match(/https:\/\/app\.test\/invite\?token=\S+/)![0]).searchParams.get("token")!
  const alice = t.withIdentity(ALICE)
  await alice.mutation(api.system.completeSignIn, { inviteToken: token })
  return alice
}

async function pdfBytes(text = "x"): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.addPage([595, 842])
  doc.setTitle(text)
  return doc.save()
}

const store = (t: T, bytes: Uint8Array, type = "application/pdf") => t.run(async (ctx) => ctx.storage.store(new Blob([bytes as BlobPart], { type })))

describe("documents: access", () => {
  test("signed out, disabled module and missing permission are denied", async () => {
    const t = setup()
    const superUser = await documentsApp(t)
    expect(await codeOf(t.query(api.documents.listDocuments, {}))).toBe("UNAUTHENTICATED")
    const alice = await inviteWithRole(t, superUser, ["documents:viewer"])
    expect(await codeOf(alice.query(api.documents.listDocuments, {}))).toBe("OK")
    expect(await codeOf(alice.mutation(api.documents.generateUploadUrl, {}))).toBe("FORBIDDEN")
    expect(await codeOf(alice.mutation(api.documents.createLabel, { kind: "tag", name: "X", match: "", algorithm: "none", caseSensitive: false }))).toBe("FORBIDDEN")
    await superUser.mutation(api.system.setModuleEnabled, { moduleId: "documents", enabled: false })
    expect(await codeOf(alice.query(api.documents.listDocuments, {}))).toBe("FORBIDDEN")
  })
})

describe("documents: archive", () => {
  test("upload applies inbox tags and matching rules; duplicates are refused; search finds the text", async () => {
    const t = setup()
    const admin = await documentsApp(t)
    const { id: inbox } = await admin.mutation(api.documents.createLabel, { kind: "tag", name: "Inbox", isInbox: true, match: "", algorithm: "none", caseSensitive: false })
    const { id: invoices } = await admin.mutation(api.documents.createLabel, { kind: "tag", name: "Sąskaitos", match: '"sąskaita faktūra"', algorithm: "any", caseSensitive: false })
    const { id: telia } = await admin.mutation(api.documents.createLabel, { kind: "correspondent", name: "Telia", match: "telia", algorithm: "any", caseSensitive: false })
    expect(await codeOf(admin.mutation(api.documents.createLabel, { kind: "type", name: "Bad", match: "(", algorithm: "regex", caseSensitive: false }))).toBe("VALIDATION")

    const storageId = await store(t, await pdfBytes("a"))
    const content = "PVM sąskaita faktūra Nr. SF-1024. Pardavėjas UAB Telia Lietuva."
    const res = await admin.mutation(api.documents.createDocument, { storageId, fileName: "telia_2026-10.pdf", content, pageCount: 1 })
    expect(res.asn).toBe(1)
    expect(res.duplicateOf).toBeNull()
    const doc = (await admin.query(api.documents.getDocument, { documentId: res.documentId }))!
    expect(doc.document.title).toBe("telia 2026-10")
    expect(doc.document.tagIds.sort()).toEqual([inbox, invoices].sort())
    expect(doc.document.correspondentId).toBe(telia)
    expect(doc.document.processing).toBe("done")

    const again = await admin.mutation(api.documents.createDocument, { storageId: await store(t, await pdfBytes("a")), fileName: "copy.pdf" })
    expect(again.duplicateOf).toBe(res.documentId)

    const found = await admin.query(api.documents.listDocuments, { filters: { search: "SF-1024" } })
    expect(found.documents.map((d) => d.id)).toEqual([res.documentId])
    const byTag = await admin.query(api.documents.listDocuments, { filters: { tagIds: [invoices], correspondentId: telia } })
    expect(byTag.total).toBe(1)

    const labels = await admin.query(api.documents.getLabels, {})
    expect(labels.tags.find((x) => x.id === invoices)?.count).toBe(1)
  })

  test("edit, bulk edit, custom fields, trash and delete are audited", async () => {
    const t = setup()
    const admin = await documentsApp(t)
    const { id: tag } = await admin.mutation(api.documents.createLabel, { kind: "tag", name: "Svarbu", match: "", algorithm: "none", caseSensitive: false })
    const { id: amount } = await admin.mutation(api.documents.createCustomField, { name: "Suma", type: "monetary" })
    const { documentId } = await admin.mutation(api.documents.createDocument, { storageId: await store(t, await pdfBytes("b")), fileName: "a.pdf", content: "tekstas" })
    await admin.mutation(api.documents.updateDocument, { documentId, title: "Sutartis", documentDate: "2026-10-01", custom: { [amount]: 120.5 } })
    expect(await codeOf(admin.mutation(api.documents.updateDocument, { documentId, custom: { [amount]: "daug" } }))).toBe("VALIDATION")
    await admin.mutation(api.documents.bulkEditDocuments, { documentIds: [documentId], addTagIds: [tag as Id<"docTags">] })
    const d = (await admin.query(api.documents.getDocument, { documentId }))!.document
    expect([d.title, d.documentDate, d.custom[amount], d.tagIds]).toEqual(["Sutartis", "2026-10-01", 120.5, [tag]])

    expect(await codeOf(admin.mutation(api.documents.deleteDocuments, { documentIds: [documentId] }))).toBe("CONFLICT")
    await admin.mutation(api.documents.setDocumentsTrashed, { documentIds: [documentId], trashed: true })
    expect((await admin.query(api.documents.listDocuments, {})).total).toBe(0)
    await admin.mutation(api.documents.deleteDocuments, { documentIds: [documentId] })
    expect(await admin.query(api.documents.getDocument, { documentId })).toBeNull()

    const audit = await admin.query(api.system.listAudit, { actionPrefix: "documents." })
    const actions = (audit as { items: { action: string }[] }).items.map((e) => e.action)
    expect(actions).toEqual(expect.arrayContaining(["documents.document.create", "documents.document.update", "documents.document.bulk_edit", "documents.document.trash", "documents.document.delete"]))
  })

  test("deleting a tag removes it from documents", async () => {
    const t = setup()
    const admin = await documentsApp(t)
    const { id: tag } = await admin.mutation(api.documents.createLabel, { kind: "tag", name: "Laikina", match: "", algorithm: "none", caseSensitive: false })
    const { documentId } = await admin.mutation(api.documents.createDocument, { storageId: await store(t, await pdfBytes("c")), fileName: "a.pdf", tagIds: [tag as Id<"docTags">] })
    await admin.mutation(api.documents.deleteLabel, { kind: "tag", id: tag })
    expect((await admin.query(api.documents.getDocument, { documentId }))!.document.tagIds).toEqual([])
  })
})

describe("documents: signing", () => {
  async function template(t: T, admin: User) {
    const { templateId } = await admin.mutation(api.documents.createTemplate, {
      name: "Paslaugų sutartis",
      storageId: await store(t, await pdfBytes("tpl")),
      fileName: "sutartis.pdf",
      pages: [{ width: 595, height: 842 }],
      roles: ["Tiekėjas", "Klientas"],
    })
    await admin.mutation(api.documents.updateTemplate, {
      templateId,
      fields: [
        { id: "s0", type: "signature", role: 0, label: "", required: true, page: 0, x: 0.1, y: 0.8, w: 0.3, h: 0.08 },
        { id: "s1", type: "signature", role: 1, label: "", required: true, page: 0, x: 0.6, y: 0.8, w: 0.3, h: 0.08 },
        { id: "n1", type: "name", role: 1, label: "Vardas", required: true, page: 0, x: 0.6, y: 0.7, w: 0.3, h: 0.04 },
      ],
    })
    return templateId
  }
  const tokenFrom = (text: string) => text.match(/https:\/\/app\.test\/sign\/(\S+)/)![1]!

  test("ordered signing: invite, open, sign, next signer, signed PDF filed into the archive", async () => {
    const t = setup()
    const admin = await documentsApp(t)
    const templateId = await template(t, admin)
    const { submissionId, links } = await admin.mutation(api.documents.sendSubmission, {
      templateId,
      ordered: true,
      submitters: [
        { role: 0, name: "Tiekėjas UAB", email: "tiekejas@acme.test" },
        { role: 1, name: "Jonas", email: "jonas@client.test" },
      ],
    })
    expect(links).toHaveLength(1)
    await t.finishAllScheduledFunctions(vi.runAllTimers)
    expect(sent.at(-1)!.to).toEqual(["tiekejas@acme.test"])
    const first = tokenFrom(sent.at(-1)!.text)

    const session = await t.query(api.documents.getSigningSession, { token: first })
    expect(session.state).toBe("ready")
    expect(await codeOf(t.mutation(api.documents.submitSignature, { token: first, values: { s1: PNG } }))).toBe("VALIDATION")
    await t.mutation(api.documents.markSigningOpened, { token: first, userAgent: "vitest" })
    expect((await t.mutation(api.documents.submitSignature, { token: first, values: { s0: PNG } })).allDone).toBe(false)
    expect(await codeOf(t.mutation(api.documents.submitSignature, { token: first, values: { s0: PNG } }))).toBe("CONFLICT")

    await t.finishAllScheduledFunctions(vi.runAllTimers)
    expect(sent.at(-1)!.to).toEqual(["jonas@client.test"])
    const second = tokenFrom(sent.at(-1)!.text)
    expect(await codeOf(t.mutation(api.documents.submitSignature, { token: second, values: { s1: PNG } }))).toBe("VALIDATION")
    expect((await t.mutation(api.documents.submitSignature, { token: second, values: { s1: PNG, n1: "Jonas Jonaitis" } })).allDone).toBe(true)

    await t.finishAllScheduledFunctions(vi.runAllTimers)
    const detail = (await admin.query(api.documents.getSubmission, { submissionId }))!
    expect(detail.status).toBe("completed")
    expect(detail.finalizeError).toBeNull()
    expect(detail.signedSha256).toMatch(/^[0-9a-f]{64}$/)
    expect(detail.events.map((e) => e.kind)).toEqual(expect.arrayContaining(["created", "sent", "opened", "completed", "finalized"]))
    const filed = (await admin.query(api.documents.getDocument, { documentId: detail.documentId! }))!
    expect(filed.document.fromSigning).toBe(true)
    expect(filed.sha256).toBe(detail.signedSha256)
    // Everyone gets a download link; it opens the completed session.
    const done = sent.filter((m) => m.subject.startsWith("Pasirašyta"))
    expect(done.map((m) => m.to[0]).sort()).toEqual(["jonas@client.test", "tiekejas@acme.test"])
    const view = await t.query(api.documents.getSigningSession, { token: tokenFrom(done[0]!.text) })
    expect(view.state === "completed" && view.signedUrl).toBeTruthy()
  })

  test("decline ends the submission; cancelled links stop working; unknown tokens reveal nothing", async () => {
    const t = setup()
    const admin = await documentsApp(t)
    const templateId = await template(t, admin)
    const a = await admin.mutation(api.documents.sendSubmission, {
      templateId,
      sendEmail: false,
      submitters: [
        { role: 0, name: "A", email: "a@acme.test" },
        { role: 1, name: "B", email: "b@acme.test" },
      ],
    })
    expect(a.links).toHaveLength(2)
    const tokenA = a.links[0]!.url.split("/sign/")[1]!
    await t.mutation(api.documents.declineSignature, { token: tokenA, reason: "Neteisinga suma" })
    expect((await admin.query(api.documents.getSubmission, { submissionId: a.submissionId }))!.status).toBe("declined")
    const tokenB = a.links[1]!.url.split("/sign/")[1]!
    expect((await t.query(api.documents.getSigningSession, { token: tokenB })).state).toBe("declined")

    const b = await admin.mutation(api.documents.sendSubmission, { templateId, sendEmail: false, submitters: [{ role: 0, name: "A", email: "a@acme.test" }, { role: 1, name: "B", email: "b@acme.test" }] })
    await admin.mutation(api.documents.cancelSubmission, { submissionId: b.submissionId })
    expect(await codeOf(t.mutation(api.documents.submitSignature, { token: b.links[0]!.url.split("/sign/")[1]!, values: { s0: PNG } }))).toBe("CONFLICT")
    expect((await t.query(api.documents.getSigningSession, { token: "nope-nope-nope-nope-nope" })).state).toBe("not_found")
  })

  test("a template needs a signature field and a signer for every role; the signing flag switches it off", async () => {
    const t = setup()
    const admin = await documentsApp(t)
    const templateId = await template(t, admin)
    expect(await codeOf(admin.mutation(api.documents.sendSubmission, { templateId, submitters: [{ role: 0, name: "A", email: "a@acme.test" }] }))).toBe("VALIDATION")
    await admin.mutation(api.system.setFeatureFlag, { flagId: "documents:signing", value: false })
    expect(await codeOf(admin.query(api.documents.listTemplates, {}))).toBe("FORBIDDEN")
  })
})
