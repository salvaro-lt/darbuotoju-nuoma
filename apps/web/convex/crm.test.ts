import { convexTest } from "convex-test"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { api, internal } from "./_generated/api"
import type { Id } from "./_generated/dataModel"
import schema from "./schema"
import { modules } from "./test.setup"

type T = ReturnType<typeof setup>
type User = ReturnType<T["withIdentity"]>
const setup = () => convexTest(schema, modules)

const ISSUER = "https://api.workos.com/user_management/client_TEST123"
const SUPER = { subject: "user_super", issuer: ISSUER, email: "super@acme.test", email_verified: true }
const ALICE = { subject: "user_alice", issuer: ISSUER, email: "alice@acme.test", email_verified: true }

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

const error = async (p: Promise<unknown>) => {
  try {
    await p
    return { code: "OK", fields: [] as string[] }
  } catch (e) {
    const data = (e as { data?: { code?: string; fields?: string[] } }).data
    return { code: data?.code ?? String(e), fields: data?.fields ?? [] }
  }
}
const codeOf = async (p: Promise<unknown>) => (await error(p)).code

/** Super signed in, CRM enabled and its standard blueprint installed (as `pnpm deploy:convex` does). */
async function crmApp(t: T) {
  await t.mutation(internal.system.registerSystem, {})
  const superUser = t.withIdentity(SUPER)
  await superUser.mutation(api.system.completeSignIn, {})
  await superUser.mutation(api.system.setModuleEnabled, { moduleId: "crm", enabled: true })
  await t.mutation(internal.crm._applyBlueprint, {})
  return superUser
}

async function inviteWithRole(t: T, superUser: User, subroleIds: string[]) {
  const { roleId } = (await superUser.mutation(api.system.createRole, { name: `Role ${subroleIds.join("+")}`, subroleIds })) as { roleId: string }
  await superUser.action(api.system.createInvite, { email: ALICE.email, roleIds: [roleId] })
  const token = new URL(sent.at(-1)!.text.match(/https:\/\/app\.test\/invite\?token=\S+/)![0]).searchParams.get("token")!
  const alice = t.withIdentity(ALICE)
  await alice.mutation(api.system.completeSignIn, { inviteToken: token })
  return { alice, roleId }
}

describe("crm: install and access", () => {
  test("the blueprint installs once; a second run creates nothing", async () => {
    const t = setup()
    const superUser = await crmApp(t)
    const { objects } = await superUser.query(api.crm.getCrmSchema, {})
    expect(objects.map((o) => o.key)).toEqual(["company", "person", "opportunity", "request"])
    expect(objects[2]!.views.map((v) => v.kind)).toEqual(["kanban", "table"])
    expect(await t.mutation(internal.crm._applyBlueprint, {})).toEqual({ objectsCreated: [], fieldsCreated: [] })
  })

  test("signed out, disabled module and missing permission are denied", async () => {
    const t = setup()
    const superUser = await crmApp(t)
    expect(await codeOf(t.query(api.crm.getCrmSchema, {}))).toBe("UNAUTHENTICATED")
    const { alice } = await inviteWithRole(t, superUser, ["crm:viewer"])
    expect(await codeOf(alice.query(api.crm.listRecords, { objectKey: "company" }))).toBe("OK")
    expect(await codeOf(alice.mutation(api.crm.createRecord, { objectKey: "company", values: { name: "Acme" } }))).toBe("FORBIDDEN")
    await superUser.mutation(api.system.setModuleEnabled, { moduleId: "crm", enabled: false })
    expect(await codeOf(alice.query(api.crm.listRecords, { objectKey: "company" }))).toBe("FORBIDDEN")
  })

  test("a crm:member cannot change the data model; crm:schema:manage is not available to API keys", async () => {
    const t = setup()
    const superUser = await crmApp(t)
    const { alice } = await inviteWithRole(t, superUser, ["crm:member"])
    const { objects } = await alice.query(api.crm.getCrmSchema, {})
    expect(await codeOf(alice.mutation(api.crm.createField, { objectId: objects[0]!.id, label: "Tier", type: "text" }))).toBe("FORBIDDEN")
    const { roleId } = (await superUser.mutation(api.system.createRole, { name: "CRM bot", subroleIds: ["crm:admin"] })) as { roleId: string }
    const key = await superUser.action(api.system.createApiKey, { name: "bot", roleIds: [roleId] })
    expect(await codeOf(t.mutation(api.crm.createRecord, { apiKey: key.secret, objectKey: "company", values: { name: "Bot Co" } }))).toBe("OK")
    expect(await codeOf(t.mutation(api.crm.createField, { apiKey: key.secret, objectId: objects[0]!.id, label: "Tier", type: "text" }))).toBe("FORBIDDEN")
  })
})

describe("crm: records", () => {
  test("values are validated against field definitions", async () => {
    const t = setup()
    const s = await crmApp(t)
    expect(await error(s.mutation(api.crm.createRecord, { objectKey: "company", values: { domain: "acme.lt" } }))).toEqual({ code: "VALIDATION", fields: ["name"] })
    expect(await error(s.mutation(api.crm.createRecord, { objectKey: "company", values: { name: "Acme", employees: "many", nope: 1 } }))).toEqual({ code: "VALIDATION", fields: ["employees", "nope"] })
    expect(await error(s.mutation(api.crm.createRecord, { objectKey: "opportunity", values: { name: "Deal", stage: "dreaming" } }))).toEqual({ code: "VALIDATION", fields: ["stage"] })
    const { recordId } = await s.mutation(api.crm.createRecord, { objectKey: "company", values: { name: " Acme ", domain: "acme.lt", annualRevenue: { amount: 1_000_000 } } })
    const { record } = await s.query(api.crm.getRecord, { recordId })
    expect(record).toMatchObject({ label: "Acme", values: { name: "Acme", domain: "https://acme.lt", annualRevenue: { amount: 1_000_000, currency: "EUR" } } })
    // Partial update; null clears; a required field cannot be cleared.
    await s.mutation(api.crm.updateRecord, { recordId, values: { domain: null } })
    expect((await s.query(api.crm.getRecord, { recordId })).record.values).not.toHaveProperty("domain")
    expect(await error(s.mutation(api.crm.updateRecord, { recordId, values: { name: "" } }))).toEqual({ code: "VALIDATION", fields: ["name"] })
  })

  test("relations resolve labels both ways and must point at the right object", async () => {
    const t = setup()
    const s = await crmApp(t)
    const { recordId: acme } = await s.mutation(api.crm.createRecord, { objectKey: "company", values: { name: "Acme" } })
    const { recordId: jonas } = await s.mutation(api.crm.createRecord, { objectKey: "person", values: { name: "Jonas", email: "jonas@acme.lt", company: acme } })
    expect(await error(s.mutation(api.crm.createRecord, { objectKey: "person", values: { name: "X", company: jonas } }))).toEqual({ code: "VALIDATION", fields: ["company"] })

    const people = await s.query(api.crm.listRecords, { objectKey: "person" })
    expect(people.relationLabels[acme]).toEqual({ label: "Acme", objectKey: "company" })
    const detail = await s.query(api.crm.getRecord, { recordId: acme })
    expect(detail.related).toEqual([{ objectKey: "person", fieldKey: "company", label: "Žmonės", records: [{ id: jonas, label: "Jonas" }] }])

    // Moving Jonas away removes the reverse link; archiving hides him from it.
    const { recordId: beta } = await s.mutation(api.crm.createRecord, { objectKey: "company", values: { name: "Beta" } })
    await s.mutation(api.crm.updateRecord, { recordId: jonas, values: { company: beta } })
    expect((await s.query(api.crm.getRecord, { recordId: acme })).related).toEqual([])
    await s.mutation(api.crm.setRecordsArchived, { recordIds: [jonas], archived: true })
    expect((await s.query(api.crm.getRecord, { recordId: beta })).related).toEqual([])
  })

  test("views filter and sort; search finds text values", async () => {
    const t = setup()
    const s = await crmApp(t)
    for (const [name, stage, amount] of [
      ["Alpha", "new", 100],
      ["Bravo", "won", 300],
      ["Charlie", "proposal", 200],
    ] as const) {
      await s.mutation(api.crm.createRecord, { objectKey: "opportunity", values: { name, stage, amount: { amount } } })
    }
    const { objects } = await s.query(api.crm.getCrmSchema, {})
    const deals = objects.find((o) => o.key === "opportunity")!
    const { viewId } = await s.mutation(api.crm.createView, {
      objectId: deals.id,
      name: "Open, biggest first",
      kind: "table",
      columns: ["name", "amount"],
      filters: [{ fieldKey: "stage", operator: "in", value: ["new", "proposal"] }],
      sort: { fieldKey: "amount", direction: "desc" },
    })
    const res = await s.query(api.crm.listRecords, { objectKey: "opportunity", viewId })
    expect(res.records.map((r) => r.label)).toEqual(["Charlie", "Alpha"])
    // Stage sorts in pipeline order, not alphabetically.
    const byStage = await s.query(api.crm.listRecords, { objectKey: "opportunity", sort: { fieldKey: "stage", direction: "asc" } })
    expect(byStage.records.map((r) => r.label)).toEqual(["Alpha", "Charlie", "Bravo"])
    const found = await s.query(api.crm.listRecords, { objectKey: "opportunity", search: "bravo" })
    expect(found.records.map((r) => r.label)).toEqual(["Bravo"])
    // A kanban view needs a select field to group by.
    expect(await error(s.mutation(api.crm.createView, { objectId: deals.id, name: "K", kind: "kanban", columns: ["name"], groupBy: "amount" }))).toEqual({ code: "VALIDATION", fields: ["groupBy"] })
  })

  test("notes: members add and delete their own; others' need crm:record:delete", async () => {
    const t = setup()
    const s = await crmApp(t)
    const { recordId } = await s.mutation(api.crm.createRecord, { objectKey: "company", values: { name: "Acme" } })
    const { noteId: superNote } = await s.mutation(api.crm.addNote, { recordId, body: "Called them" })
    const { alice } = await inviteWithRole(t, s, ["crm:member"])
    const { noteId } = await alice.mutation(api.crm.addNote, { recordId, body: "Sent offer" })
    const notes = (await alice.query(api.crm.getRecord, { recordId })).notes
    expect(notes.map((n) => [n.body, n.mine])).toEqual([
      ["Sent offer", true],
      ["Called them", false],
    ])
    expect(await codeOf(alice.mutation(api.crm.deleteNote, { noteId: superNote as Id<"crmNotes"> }))).toBe("FORBIDDEN")
    expect(await codeOf(alice.mutation(api.crm.deleteNote, { noteId }))).toBe("OK")
  })
})

describe("crm: data model", () => {
  test("custom objects and fields, behind their flags", async () => {
    const t = setup()
    const s = await crmApp(t)
    const { objectId, key } = await s.mutation(api.crm.createObject, { nameSingular: "Projektas", namePlural: "Projektai", icon: "folder" })
    expect(key).toBe("projektas")
    await s.mutation(api.crm.createField, {
      objectId,
      label: "Būsena",
      type: "select",
      settings: { options: [{ value: "active", label: "Aktyvus", color: "green" }] },
    })
    await s.mutation(api.crm.createField, { objectId, label: "Klientas", type: "relation", settings: { objectKey: "company" } })
    const obj = (await s.query(api.crm.getCrmSchema, {})).objects.find((o) => o.key === "projektas")!
    expect(obj.fields.map((f) => [f.key, f.type])).toEqual([
      ["name", "text"],
      ["busena", "select"],
      ["klientas", "relation"],
    ])
    expect(await codeOf(s.mutation(api.crm.createField, { objectId, label: "Būsena", type: "text" }))).toBe("CONFLICT")
    expect(await error(s.mutation(api.crm.createField, { objectId, label: "Bad", type: "select", settings: { options: [] } }))).toEqual({ code: "VALIDATION", fields: ["options"] })

    await s.mutation(api.system.setFeatureFlag, { flagId: "crm:custom-objects", value: false })
    expect(await codeOf(s.mutation(api.crm.createObject, { nameSingular: "X", namePlural: "Xs" }))).toBe("FORBIDDEN")
    await s.mutation(api.system.setFeatureFlag, { flagId: "crm:custom-fields", value: false })
    expect(await codeOf(s.mutation(api.crm.createField, { objectId, label: "Y", type: "text" }))).toBe("FORBIDDEN")
  })

  test("archiving a field keeps values, drops it from views, and the blueprint never restores it", async () => {
    const t = setup()
    const s = await crmApp(t)
    const deals = (await s.query(api.crm.getCrmSchema, {})).objects.find((o) => o.key === "opportunity")!
    const stage = deals.fields.find((f) => f.key === "stage")!
    const { recordId } = await s.mutation(api.crm.createRecord, { objectKey: "opportunity", values: { name: "Deal", stage: "won" } })
    expect(await codeOf(s.mutation(api.crm.setFieldArchived, { fieldId: deals.fields.find((f) => f.key === "name")!.id, archived: true }))).toBe("CONFLICT")
    await s.mutation(api.crm.setFieldArchived, { fieldId: stage.id, archived: true })

    const after = (await s.query(api.crm.getCrmSchema, {})).objects.find((o) => o.key === "opportunity")!
    expect(after.fields.some((f) => f.key === "stage")).toBe(false)
    // The kanban grouped by stage fell back to a table.
    expect(after.views.map((v) => [v.kind, v.groupBy, v.columns.includes("stage")])).toEqual([
      ["table", null, false],
      ["table", null, false],
    ])
    // Not required any more, not writable, value kept for a restore.
    expect(await codeOf(s.mutation(api.crm.createRecord, { objectKey: "opportunity", values: { name: "Next" } }))).toBe("OK")
    expect(await error(s.mutation(api.crm.updateRecord, { recordId, values: { stage: "new" } }))).toEqual({ code: "VALIDATION", fields: ["stage"] })
    expect(await t.mutation(internal.crm._applyBlueprint, {})).toEqual({ objectsCreated: [], fieldsCreated: [] })
    await s.mutation(api.crm.setFieldArchived, { fieldId: stage.id, archived: false })
    expect((await s.query(api.crm.getRecord, { recordId })).record.values.stage).toBe("won")
  })

  test("renaming a select option updates search; changing the label field relabels records", async () => {
    const t = setup()
    const s = await crmApp(t)
    const companies = (await s.query(api.crm.getCrmSchema, {})).objects.find((o) => o.key === "company")!
    await s.mutation(api.crm.createRecord, { objectKey: "company", values: { name: "Acme", domain: "acme.lt", industry: "it" } })
    const industry = companies.fields.find((f) => f.key === "industry")!
    const options = industry.settings.options!.map((o) => (o.value === "it" ? { ...o, label: "Software" } : o))
    await s.mutation(api.crm.updateField, { fieldId: industry.id, settings: { options } })
    expect((await s.query(api.crm.listRecords, { objectKey: "company", search: "software" })).records).toHaveLength(1)
    await s.mutation(api.crm.updateObject, { objectId: companies.id, labelFieldKey: "domain" })
    expect((await s.query(api.crm.listRecords, { objectKey: "company" })).records[0]!.label).toBe("https://acme.lt")
  })
})
