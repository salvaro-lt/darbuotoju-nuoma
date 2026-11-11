import { convexTest } from "convex-test"
import { PDFDocument } from "pdf-lib"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { api, internal } from "./_generated/api"
import type { Id } from "./_generated/dataModel"
import schema from "./schema"
import { modules } from "./test.setup"

// Documents access: restricted labels (users / roles), shares, "see all".

type T = ReturnType<typeof setup>
type User = ReturnType<T["withIdentity"]>
const setup = () => convexTest(schema, modules)

const ISSUER = "https://api.workos.com/user_management/client_TEST123"
const person = (name: string) => ({ subject: `user_${name}`, issuer: ISSUER, email: `${name}@acme.test`, email_verified: true })
const SUPER = person("super")

let sent: { text: string }[] = []
beforeEach(() => {
  sent = []
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    if (!String(url).startsWith("https://api.resend.com/")) throw new Error(`unexpected fetch ${url}`)
    sent.push(JSON.parse(String(init.body)))
    return new Response("{}", { status: 200 })
  })
})
afterEach(() => vi.unstubAllGlobals())

const codeOf = async (p: Promise<unknown>) => {
  try {
    await p
    return "OK"
  } catch (e) {
    return (e as { data?: { code?: string } }).data?.code ?? String(e)
  }
}

let pdfSeq = 0
async function pdf(t: T) {
  const doc = await PDFDocument.create()
  doc.addPage([595, 842])
  doc.setTitle(`doc ${++pdfSeq}`)
  const bytes = await doc.save()
  return t.run(async (ctx) => ctx.storage.store(new Blob([bytes as BlobPart], { type: "application/pdf" })))
}

/** Super, plus people holding roles built from documents subroles. */
async function world(t: T) {
  await t.mutation(internal.system.registerSystem, {})
  const superUser = t.withIdentity(SUPER)
  await superUser.mutation(api.system.completeSignIn, {})
  await superUser.mutation(api.system.setModuleEnabled, { moduleId: "documents", enabled: true })
  const role = async (name: string, subroleIds: string[]) => ((await superUser.mutation(api.system.createRole, { name, subroleIds })) as { roleId: string }).roleId
  const editorRole = await role("Redaktoriai", ["documents:editor"])
  const hrRole = await role("Personalas", ["documents:viewer"])
  const adminRole = await role("Dokumentų admin", ["documents:admin"])
  const join = async (name: string, roleIds: string[]): Promise<{ user: User; id: string }> => {
    const p = person(name)
    await superUser.action(api.system.createInvite, { email: p.email, roleIds })
    const token = new URL(sent.at(-1)!.text.match(/https:\/\/app\.test\/invite\?token=\S+/)![0]).searchParams.get("token")!
    const user = t.withIdentity(p)
    await user.mutation(api.system.completeSignIn, { inviteToken: token })
    const opts = await superUser.query(api.documents.getAccessOptions, {})
    return { user, id: opts.users.find((u) => u.email === p.email)!.id }
  }
  return {
    superUser,
    roles: { editorRole, hrRole, adminRole },
    editor: await join("eve", [editorRole]),
    hr: await join("hana", [hrRole]),
    reader: await join("rita", [await role("Skaitytojai", ["documents:viewer"])]),
    docAdmin: await join("adam", [adminRole]),
  }
}

const tag = (u: User, name: string, access?: { userIds: string[]; roleIds: string[] } | null) =>
  u.mutation(api.documents.createLabel, { kind: "tag", name, match: "", algorithm: "none", caseSensitive: false, ...(access !== undefined ? { access } : {}) }).then((r) => r.id as Id<"docTags">)

const ids = async (u: User) => (await u.query(api.documents.listDocuments, {})).documents.map((d) => d.id).sort()

describe("documents: label access", () => {
  test("a restricted label hides its documents and itself from everyone but its grantees and admins", async () => {
    const t = setup()
    const w = await world(t)
    const hrTag = await tag(w.superUser, "Personalo", { userIds: [], roleIds: [w.roles.hrRole] })
    const open = await tag(w.superUser, "Bendri")
    const { documentId: secret } = await w.superUser.mutation(api.documents.createDocument, { storageId: await pdf(t), fileName: "atlyginimai.pdf", content: "Atlyginimai 2026", tagIds: [hrTag, open] })
    const { documentId: plain } = await w.superUser.mutation(api.documents.createDocument, { storageId: await pdf(t), fileName: "tvarka.pdf", content: "Darbo tvarka", tagIds: [open] })

    expect(await ids(w.hr.user)).toEqual([secret, plain].sort())
    expect(await ids(w.docAdmin.user)).toEqual([secret, plain].sort())
    expect(await ids(w.reader.user)).toEqual([plain])
    expect(await ids(w.editor.user)).toEqual([plain])

    // Not found by link, search or a filter on the hidden label; the label itself is not listed.
    expect(await w.reader.user.query(api.documents.getDocument, { documentId: secret })).toBeNull()
    expect((await w.reader.user.query(api.documents.listDocuments, { filters: { search: "Atlyginimai" } })).total).toBe(0)
    expect((await w.reader.user.query(api.documents.listDocuments, { filters: { tagIds: [hrTag] } })).total).toBe(0)
    expect((await w.reader.user.query(api.documents.listDocuments, { filters: { tagIds: [hrTag, open], tagMode: "any" } })).total).toBe(1)
    const readerLabels = await w.reader.user.query(api.documents.getLabels, {})
    expect(readerLabels.tags.map((x) => x.name)).toEqual(["Bendri"])
    expect(readerLabels.tags[0]!.count).toBe(1)
    const hrLabels = await w.hr.user.query(api.documents.getLabels, {})
    expect(hrLabels.tags.find((x) => x.id === hrTag)?.access).toEqual({ userIds: [], roleIds: [w.roles.hrRole] })

    // Writes on a hidden document are "not found".
    expect(await codeOf(w.editor.user.mutation(api.documents.updateDocument, { documentId: secret, title: "x" }))).toBe("NOT_FOUND")
    expect(await codeOf(w.editor.user.mutation(api.documents.addNote, { documentId: secret, body: "x" }))).toBe("NOT_FOUND")
    expect(await codeOf(w.editor.user.mutation(api.documents.bulkEditDocuments, { documentIds: [secret], addTagIds: [open] }))).toBe("NOT_FOUND")

    // Granting a user directly opens it; making the label public opens it to all readers.
    await w.superUser.mutation(api.documents.updateLabel, { kind: "tag", id: hrTag, access: { userIds: [w.editor.id], roleIds: [w.roles.hrRole] } })
    expect(await ids(w.editor.user)).toEqual([secret, plain].sort())
    await w.superUser.mutation(api.documents.updateLabel, { kind: "tag", id: hrTag, access: null })
    expect(await ids(w.reader.user)).toEqual([secret, plain].sort())
  })

  test("a restricted label with no grants is visible to `see all` holders only", async () => {
    const t = setup()
    const w = await world(t)
    const mail = await tag(w.superUser, "Privatu", { userIds: [], roleIds: [] })
    const { documentId } = await w.superUser.mutation(api.documents.createDocument, { storageId: await pdf(t), fileName: "a.pdf", tagIds: [mail] })
    expect(await ids(w.hr.user)).toEqual([])
    expect(await ids(w.docAdmin.user)).toEqual([documentId])
  })

  test("editing labels keeps hidden ones and refuses to add them; the uploader keeps access", async () => {
    const t = setup()
    const w = await world(t)
    const hrTag = await tag(w.superUser, "Personalo", { userIds: [], roleIds: [w.roles.hrRole] })
    const open = await tag(w.superUser, "Bendri")
    // The editor uploads a document; HR restricts it afterwards.
    const { documentId } = await w.editor.user.mutation(api.documents.createDocument, { storageId: await pdf(t), fileName: "a.pdf", tagIds: [open] })
    expect(await codeOf(w.editor.user.mutation(api.documents.updateDocument, { documentId, tagIds: [open, hrTag] }))).toBe("VALIDATION")
    await w.superUser.mutation(api.documents.updateDocument, { documentId, tagIds: [open, hrTag] })
    const asEditor = (await w.editor.user.query(api.documents.getDocument, { documentId }))!
    expect(asEditor.document.tagIds).toEqual([open])
    expect(asEditor.access.restrictedTagIds).toEqual([])
    // Removing the visible label leaves the hidden one in place.
    await w.editor.user.mutation(api.documents.updateDocument, { documentId, tagIds: [] })
    const asSuper = (await w.superUser.query(api.documents.getDocument, { documentId }))!
    expect(asSuper.document.tagIds).toEqual([hrTag])
    expect(asSuper.document.restricted).toBe(true)
    expect(await ids(w.reader.user)).toEqual([])
  })

  test("only label managers set access, and grants must be real users and roles", async () => {
    const t = setup()
    const w = await world(t)
    expect(await codeOf(tag(w.editor.user, "X", { userIds: [], roleIds: [] }))).toBe("FORBIDDEN")
    expect(await codeOf(tag(w.superUser, "Y", { userIds: ["nobody"], roleIds: [] }))).toBe("VALIDATION")
    expect(await codeOf(tag(w.superUser, "Z", { userIds: [], roleIds: ["no_role"] }))).toBe("VALIDATION")
    expect(await codeOf(w.reader.user.query(api.documents.getAccessOptions, {}))).toBe("FORBIDDEN")
    const opts = await w.editor.user.query(api.documents.getAccessOptions, {})
    expect(opts.roles.map((r) => r.name)).toEqual(expect.arrayContaining(["Personalas", "Redaktoriai"]))
  })
})

describe("documents: sharing", () => {
  test("a shared document is visible only to its roles and users (plus uploader and admins)", async () => {
    const t = setup()
    const w = await world(t)
    const { documentId } = await w.superUser.mutation(api.documents.createDocument, { storageId: await pdf(t), fileName: "sutartis.pdf" })
    expect(await ids(w.reader.user)).toEqual([documentId])
    await w.editor.user.mutation(api.documents.shareDocument, { documentId, userIds: [], roleIds: [w.roles.hrRole] })
    expect(await ids(w.hr.user)).toEqual([documentId])
    expect(await ids(w.reader.user)).toEqual([])
    // The editor shared it away from themselves; admins still see it.
    expect(await ids(w.editor.user)).toEqual([])
    expect(await ids(w.docAdmin.user)).toEqual([documentId])

    await w.superUser.mutation(api.documents.shareDocument, { documentId, userIds: [w.reader.id], roleIds: [w.roles.hrRole] })
    const asReader = (await w.reader.user.query(api.documents.getDocument, { documentId }))!
    expect(asReader.fileUrl).toBeTruthy()
    expect(asReader.access).toMatchObject({ sharedUserIds: [w.reader.id], sharedRoleIds: [w.roles.hrRole] })

    // Viewers cannot share; unsharing (empty lists) opens it to all readers again.
    expect(await codeOf(w.hr.user.mutation(api.documents.shareDocument, { documentId, userIds: [], roleIds: [] }))).toBe("FORBIDDEN")
    await w.superUser.mutation(api.documents.shareDocument, { documentId, userIds: [], roleIds: [] })
    expect(await ids(w.editor.user)).toEqual([documentId])
    const audit = (await w.superUser.query(api.system.listAudit, { actionPrefix: "documents.document.share" })) as { items: unknown[] }
    expect(audit.items).toHaveLength(3)
  })
})

describe("documents: access review fixes", () => {
  test("someone who sees a document only through a share cannot change or lift it", async () => {
    const t = setup()
    const w = await world(t)
    const { documentId } = await w.superUser.mutation(api.documents.createDocument, { storageId: await pdf(t), fileName: "a.pdf" })
    await w.superUser.mutation(api.documents.shareDocument, { documentId, userIds: [], roleIds: [w.roles.editorRole] })
    expect(await codeOf(w.editor.user.mutation(api.documents.shareDocument, { documentId, userIds: [], roleIds: [] }))).toBe("FORBIDDEN")
    expect(await ids(w.reader.user)).toEqual([])
  })

  test("a hidden copy is not revealed by uploading the same file; restricted label names are not searchable", async () => {
    const t = setup()
    const w = await world(t)
    const hrTag = await tag(w.superUser, "Atlyginimai", { userIds: [], roleIds: [w.roles.hrRole] })
    const bytes = await PDFDocument.create().then(async (d) => {
      d.addPage([595, 842])
      d.setTitle("same")
      return d.save()
    })
    const put = () => t.run(async (ctx) => ctx.storage.store(new Blob([bytes as BlobPart], { type: "application/pdf" })))
    const { documentId: secret } = await w.superUser.mutation(api.documents.createDocument, { storageId: await put(), fileName: "a.pdf", content: "Darbo sutartis", tagIds: [hrTag] })
    const mine = await w.editor.user.mutation(api.documents.createDocument, { storageId: await put(), fileName: "b.pdf" })
    expect(mine.duplicateOf).toBeNull()
    expect(mine.documentId).not.toBe(secret)
    // HR sees the document, but its restricted label's name is not in the search text.
    expect((await w.hr.user.query(api.documents.listDocuments, { filters: { search: "sutartis" } })).total).toBe(1)
    expect((await w.hr.user.query(api.documents.listDocuments, { filters: { search: "Atlyginimai" } })).total).toBe(0)
  })

  test("signing templates made from a hidden document are hidden too", async () => {
    const t = setup()
    const w = await world(t)
    const hrTag = await tag(w.superUser, "Personalo", { userIds: [], roleIds: [w.roles.hrRole] })
    const { documentId } = await w.superUser.mutation(api.documents.createDocument, { storageId: await pdf(t), fileName: "sutartis.pdf", tagIds: [hrTag] })
    const { templateId } = await w.superUser.mutation(api.documents.createTemplate, { name: "Sutartis", documentId, pages: [{ width: 595, height: 842 }], roles: ["Darbuotojas"] })
    expect((await w.editor.user.query(api.documents.listTemplates, {})).map((x) => x.id)).toEqual([])
    expect(await w.editor.user.query(api.documents.getTemplate, { templateId })).toBeNull()
    expect((await w.superUser.query(api.documents.listTemplates, {})).map((x) => x.id)).toEqual([templateId])
    // Writes by id are "not found" too: an editor cannot send the hidden document for signing.
    expect(await codeOf(w.editor.user.mutation(api.documents.sendSubmission, { templateId, sendEmail: false, submitters: [{ role: 0, name: "A", email: "a@acme.test" }] }))).toBe("NOT_FOUND")
  })

  test("new functions refuse anonymous callers and a disabled module", async () => {
    const t = setup()
    const w = await world(t)
    const { documentId } = await w.superUser.mutation(api.documents.createDocument, { storageId: await pdf(t), fileName: "a.pdf" })
    expect(await codeOf(t.mutation(api.documents.shareDocument, { documentId, userIds: [], roleIds: [] }))).toBe("UNAUTHENTICATED")
    expect(await codeOf(t.query(api.documents.getAccessOptions, {}))).toBe("UNAUTHENTICATED")
    await w.superUser.mutation(api.system.setModuleEnabled, { moduleId: "documents", enabled: false })
    expect(await codeOf(w.editor.user.mutation(api.documents.shareDocument, { documentId, userIds: [], roleIds: [] }))).toBe("FORBIDDEN")
    expect(await codeOf(w.editor.user.query(api.documents.getAccessOptions, {}))).toBe("FORBIDDEN")
  })
})
