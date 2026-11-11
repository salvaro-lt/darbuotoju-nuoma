import { convexTest } from "convex-test"
import { svixSignature } from "@digimuza/system-core/automations"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { api, internal } from "./_generated/api"
import type { Id } from "./_generated/dataModel"
import { n8nIngestConsumer } from "./model/n8nConsumer"
import schema from "./schema"
import { system } from "./system"
import { modules } from "./test.setup"

// The n8n ingest consumer: an inbox linked to an n8n webhook workflow forwards
// every received email (signed, retried). Resend and n8n are faked with a fetch stub.

type T = ReturnType<typeof setup>
type User = ReturnType<T["withIdentity"]>
const setup = () => convexTest(schema, modules)

const ISSUER = "https://api.workos.com/user_management/client_TEST123"
const person = (name: string) => ({ subject: `user_${name}`, issuer: ISSUER, email: `${name}@acme.test`, email_verified: true })
const SECRET = "whsec_c2VjcmV0LXNpZ25pbmcta2V5LWZvci10ZXN0cw=="
const N8N = "https://n8n.test"
const HOOK_SECRET = "hook-secret-for-tests"
const N8N_ENV = { N8N_URL: N8N, N8N_API_KEY: "n8n-key", N8N_MCP_URL: `${N8N}/mcp-server/http`, N8N_MCP_TOKEN: "mcp-token", N8N_WEBHOOK_SECRET: HOOK_SECRET }

interface FakeWorkflow {
  id: string
  name: string
  active: boolean
  tags: { id: string; name: string }[]
  nodes: { name: string; type: string; typeVersion: number; position: number[]; parameters: Record<string, unknown> }[]
  connections: Record<string, unknown>
  updatedAt: string
}
const TAG = { id: "tag1", name: "dr-nuoma" }
const hookWorkflow = (id: string, name: string, path: string, over: Partial<FakeWorkflow> = {}): FakeWorkflow => ({
  id,
  name,
  active: true,
  tags: [TAG],
  nodes: [{ name: "Hook", type: "n8n-nodes-base.webhook", typeVersion: 2.1, position: [0, 0], parameters: { httpMethod: "POST", path, options: {} } }],
  connections: {},
  updatedAt: "2026-11-11T09:00:00.000Z",
  ...over,
})

const headersOf = (h: HeadersInit | undefined) => {
  const out: Record<string, string> = {}
  new Headers(h).forEach((value, key) => (out[key] = value))
  return out
}

let sent: { text?: string }[] = []
let received: Record<string, unknown> = {}
let attachments: Record<string, { id: string; filename: string; download_url: string }[]> = {}
let workflows: FakeWorkflow[] = []
let hooks: { url: string; headers: Record<string, string>; body: string }[] = []
let hookStatuses: number[] = []

beforeEach(() => {
  sent = []
  received = {}
  attachments = {}
  workflows = []
  hooks = []
  hookStatuses = []
  Object.assign(process.env, N8N_ENV, { RESEND_RECEIVING_API_KEY: "re_test", RESEND_WEBHOOK_SECRET: SECRET })
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    const u = String(url)
    const method = init?.method ?? "GET"
    const list = /^https:\/\/api\.resend\.com\/emails\/receiving\/([^/?]+)\/attachments/.exec(u)
    if (list) return Response.json({ object: "list", data: attachments[list[1]!] ?? [] })
    const m = /^https:\/\/api\.resend\.com\/emails\/receiving\/([^?/]+)/.exec(u)
    if (m) return received[m[1]!] ? Response.json(received[m[1]!]) : new Response("{}", { status: 404 })
    if (u.startsWith(`${N8N}/api/v1/workflows?`)) {
      // The fake returns every workflow, tagged or not: the client must filter.
      return Response.json({ data: workflows, nextCursor: null })
    }
    const one = new RegExp(`^${N8N}/api/v1/workflows/([^/?]+)`).exec(u)
    if (one && method === "GET") {
      const w = workflows.find((x) => x.id === one[1])
      return w ? Response.json(w) : Response.json({ message: "Not Found" }, { status: 404 })
    }
    if (u.startsWith(`${N8N}/webhook/`)) {
      hooks.push({ url: u, headers: headersOf(init?.headers), body: String(init?.body) })
      const status = hookStatuses.shift() ?? 200
      return new Response(status < 300 ? '{"message":"Workflow was started"}' : "secret-echo-should-not-be-stored", { status })
    }
    if (u.startsWith(N8N)) throw new Error(`unexpected n8n call ${method} ${u}`)
    if (!u.startsWith("https://api.resend.com/")) throw new Error(`unexpected fetch ${u}`)
    sent.push(JSON.parse(String(init?.body)))
    return Response.json({})
  })
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  for (const k of [...Object.keys(N8N_ENV), "RESEND_RECEIVING_API_KEY", "RESEND_WEBHOOK_SECRET"]) delete process.env[k]
})

async function join(t: T, superUser: User, name: string, roleId: string) {
  const p = person(name)
  await superUser.action(api.system.createInvite, { email: p.email, roleIds: [roleId] })
  const token = new URL(sent.at(-1)!.text!.match(/https:\/\/app\.test\/invite\?token=\S+/)![0]).searchParams.get("token")!
  const as = t.withIdentity(p)
  await as.mutation(api.system.completeSignIn, { inviteToken: token })
  return as
}

async function bootstrap(t: T) {
  await t.mutation(internal.system.registerSystem, {})
  const superUser = t.withIdentity(person("super"))
  await superUser.mutation(api.system.completeSignIn, {})
  for (const moduleId of ["ingest", "n8n"]) await superUser.mutation(api.system.setModuleEnabled, { moduleId, enabled: true })
  const role = async (name: string, subroleIds: string[]) => ((await superUser.mutation(api.system.createRole, { name, subroleIds })) as { roleId: string }).roleId
  const admin = await join(t, superUser, "adam", await role("Administracija", ["ingest:admin", "n8n:admin"]))
  const clerk = await join(t, superUser, "cleo", await role("Dėžutės", ["ingest:editor"]))
  await admin.mutation(api.ingest.setManagedDomain, { domain: "abc123.resend.app" })
  const inbox = await admin.mutation(api.ingest.createInbox, { name: "Užklausos", localPart: "uzklausos" })
  return { superUser, admin, clerk, inbox }
}

let msg = 0
async function receive(t: T, email: { id: string; to: string[]; subject: string; text?: string; html?: string; attachments?: { id: string; filename: string; content_type: string; size: number }[] }) {
  received[email.id] = {
    id: email.id,
    from: "jonas@example.com",
    to: email.to,
    subject: email.subject,
    text: email.text ?? null,
    html: email.html ?? null,
    headers: { from: "Jonas Jonaitis <jonas@example.com>" },
    attachments: email.attachments ?? [],
  }
  const event = {
    type: "email.received",
    created_at: new Date().toISOString(),
    data: { email_id: email.id, from: "jonas@example.com", to: email.to, subject: email.subject, message_id: `<${email.id}@example.com>` },
  }
  const raw = JSON.stringify(event)
  const id = `msg_${++msg}`
  const ts = String(Math.floor(Date.now() / 1000))
  await t.mutation(api.ingest.receiveResendWebhook, { svixId: id, svixTimestamp: ts, svixSignature: await svixSignature(SECRET, id, ts, raw), raw })
  await t.finishAllScheduledFunctions(vi.runAllTimers)
}

const deliveries = (t: T) => t.run(async (ctx) => ctx.db.query("n8nDeliveries").collect())
const emailRow = (t: T, resendEmailId: string) =>
  t.run(async (ctx) =>
    (await ctx.db.query("ingestEmails").collect()).find((e) => e.resendEmailId === resendEmailId),
  )

async function hmac(secret: string, body: string) {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"])
  return `sha256=${Buffer.from(await crypto.subtle.sign("HMAC", key, enc.encode(body))).toString("hex")}`
}

async function linked(t: T, admin: User, inboxId: string, workflowId: string) {
  await t.action(internal.n8n._syncWorkflows, {})
  await admin.mutation(api.ingest.linkInbox, { inboxId, consumer: "n8n", refId: workflowId, linked: true })
}

describe("n8n: email → webhook workflow", () => {
  test("an email in a linked inbox is accepted, POSTed signed with the exact body, and reported sent", async () => {
    const t = setup()
    const { admin, inbox } = await bootstrap(t)
    workflows = [hookWorkflow("wf1", "dr-nuoma – Užklausa iš laiško", "dr-nuoma-laiskas")]
    await linked(t, admin, inbox.inboxId, "wf1")
    expect((await admin.query(api.ingest.getInbox, { inboxId: inbox.inboxId })).linked).toEqual([
      { consumer: "n8n", id: "wf1", name: "dr-nuoma – Užklausa iš laiško", enabled: true, href: `${N8N}/workflow/wf1` },
    ])
    attachments.em_1 = [{ id: "att_1", filename: "brezinys.pdf", download_url: "https://cdn.test/em_1/att_1" }]

    await receive(t, {
      id: "em_1",
      to: [inbox.address],
      subject: "Iškaba parduotuvei",
      text: "Sveiki, reikia iškabos 2x1 m.",
      html: "<p>Sveiki</p>",
      attachments: [{ id: "att_1", filename: "brezinys.pdf", content_type: "application/pdf", size: 1234 }],
    })

    const [d] = await deliveries(t)
    expect(d).toMatchObject({ workflowId: "wf1", resendEmailId: "em_1", status: "sent", attempts: 1, httpStatus: 200 })
    const email = (await emailRow(t, "em_1"))!
    expect(email.deliveries.find((x) => x.consumer === "n8n")).toMatchObject({ refId: "wf1", outcome: "accepted", runId: d!._id })

    expect(hooks).toHaveLength(1)
    const hook = hooks[0]!
    expect(hook.url).toBe(`${N8N}/webhook/dr-nuoma-laiskas`)
    expect(JSON.parse(hook.body)).toEqual({
      event: "email.received",
      deliveryId: d!._id,
      email: {
        id: email._id,
        resendEmailId: "em_1",
        inbox: { address: inbox.address, name: "Užklausos" },
        from: "jonas@example.com",
        fromName: "Jonas Jonaitis",
        to: [inbox.address],
        subject: "Iškaba parduotuvei",
        text: "Sveiki, reikia iškabos 2x1 m.",
        html: "<p>Sveiki</p>",
        messageId: email.messageId ?? null,
        receivedAt: new Date(email.receivedAt).toISOString(),
        attachments: [{ name: "brezinys.pdf", type: "application/pdf", size: 1234, url: "https://cdn.test/em_1/att_1" }],
      },
    })
    expect(hook.headers["content-type"]).toBe("application/json")
    expect(hook.headers["x-webhook-secret"]).toBe(HOOK_SECRET)
    expect(hook.headers["x-webhook-delivery"]).toBe(d!._id)
    expect(hook.headers["x-webhook-signature"]).toBe(await hmac(HOOK_SECRET, hook.body))

    const view = await admin.query(api.ingest.getEmail, { emailId: email._id })
    expect(view.deliveries.find((x) => x.consumer === "n8n")).toMatchObject({ status: "sent", href: `${N8N}/workflow/wf1/executions` })

    // The same email again (Resend retried the webhook): no second delivery row.
    await t.run(async (ctx) => {
      const { sys } = await system.context(ctx)
      const out = await n8nIngestConsumer().deliver({ db: ctx.db, sys, scheduler: ctx.scheduler }, {
        emailId: email._id,
        resendEmailId: "em_1",
        inbox: { id: email.inboxId, address: inbox.address, name: "Užklausos" },
      } as never)
      expect(out.map((o) => o.outcome)).toEqual(["duplicate"])
    })
    expect(await deliveries(t)).toHaveLength(1)
  })

  test("a 500 is retried with backoff; after 4 attempts the delivery is failed and status() says so (no response body kept)", async () => {
    const t = setup()
    const { admin, inbox } = await bootstrap(t)
    workflows = [hookWorkflow("wf1", "dr-nuoma – Užklausa", "dr-nuoma-laiskas")]
    await linked(t, admin, inbox.inboxId, "wf1")
    hookStatuses = [500, 500, 500, 500]

    await receive(t, { id: "em_2", to: [inbox.address], subject: "Kaina", text: "Kiek kainuoja?" })

    expect(hooks).toHaveLength(4)
    const [d] = await deliveries(t)
    expect(d).toMatchObject({ status: "failed", attempts: 4, httpStatus: 500, error: "http_500" })
    expect(JSON.stringify(d)).not.toContain("secret-echo")
    const email = (await emailRow(t, "em_2"))!
    const view = await admin.query(api.ingest.getEmail, { emailId: email._id })
    expect(view.deliveries.find((x) => x.consumer === "n8n")).toMatchObject({ outcome: "accepted", status: "failed" })
  })

  test("a retry that succeeds ends sent", async () => {
    const t = setup()
    const { admin, inbox } = await bootstrap(t)
    workflows = [hookWorkflow("wf1", "dr-nuoma – Užklausa", "dr-nuoma-laiskas")]
    await linked(t, admin, inbox.inboxId, "wf1")
    hookStatuses = [502, 200]
    await receive(t, { id: "em_3", to: [inbox.address], subject: "Sveiki", text: "…" })
    expect(hooks).toHaveLength(2)
    expect((await deliveries(t))[0]).toMatchObject({ status: "sent", attempts: 2, httpStatus: 200 })
  })

  test("an inactive workflow is skipped: no delivery row, no POST", async () => {
    const t = setup()
    const { admin, inbox } = await bootstrap(t)
    workflows = [hookWorkflow("wf1", "dr-nuoma – Užklausa", "dr-nuoma-laiskas")]
    await linked(t, admin, inbox.inboxId, "wf1")
    workflows[0]!.active = false
    await t.action(internal.n8n._syncWorkflows, {})

    await receive(t, { id: "em_4", to: [inbox.address], subject: "Sveiki", text: "…" })

    expect(hooks).toHaveLength(0)
    expect(await deliveries(t)).toHaveLength(0)
    const email = (await emailRow(t, "em_4"))!
    expect(email.deliveries.find((x) => x.consumer === "n8n")).toMatchObject({ refId: "wf1", outcome: "skipped" })
  })

  test("untagged workflows are never cached, listed or linkable; linking needs n8n:workflow:manage", async () => {
    const t = setup()
    const { admin, clerk, inbox } = await bootstrap(t)
    workflows = [hookWorkflow("wf1", "dr-nuoma – Užklausa", "dr-nuoma-laiskas"), hookWorkflow("other", "Someone else's flow", "their-hook", { tags: [{ id: "t9", name: "crm" }] })]
    const sync = await t.action(internal.n8n._syncWorkflows, {})
    expect(sync).toMatchObject({ upserted: 1, removed: 0 })
    expect((await admin.query(api.n8n.listWorkflowsCached, {})).map((w) => w.workflowId)).toEqual(["wf1"])
    const targets = await admin.query(api.ingest.listLinkTargets, {})
    expect(targets.find((x) => x.consumer === "n8n")?.items).toEqual([{ id: "wf1", name: "dr-nuoma – Užklausa", enabled: true }])

    await expect(admin.mutation(api.ingest.linkInbox, { inboxId: inbox.inboxId, consumer: "n8n", refId: "other", linked: true })).rejects.toThrow()
    await expect(clerk.mutation(api.ingest.linkInbox, { inboxId: inbox.inboxId, consumer: "n8n", refId: "wf1", linked: true })).rejects.toThrow()
    expect(await t.run(async (ctx) => ctx.db.query("n8nInboxLinks").collect())).toHaveLength(0)

    // A workflow that loses its tag drops out of the cache on the next sync.
    workflows[0]!.tags = []
    expect(await t.action(internal.n8n._syncWorkflows, {})).toMatchObject({ upserted: 0, removed: 1 })
  })

  test("only POST webhook workflows are link targets (GET or no method is not)", async () => {
    const t = setup()
    const { admin, inbox } = await bootstrap(t)
    const hook = (id: string, httpMethod?: string) => {
      const w = hookWorkflow(id, `dr-nuoma – ${id}`, `${id}-hook`)
      w.nodes[0]!.parameters = { path: `${id}-hook`, ...(httpMethod ? { httpMethod } : {}) }
      return w
    }
    workflows = [hook("post", "post"), hook("get", "GET"), hook("none")]
    await t.action(internal.n8n._syncWorkflows, {})
    const targets = await admin.query(api.ingest.listLinkTargets, {})
    expect(targets.find((x) => x.consumer === "n8n")?.items.map((i) => i.id)).toEqual(["post"])
    for (const refId of ["get", "none"]) await expect(admin.mutation(api.ingest.linkInbox, { inboxId: inbox.inboxId, consumer: "n8n", refId, linked: true })).rejects.toThrow()
    await admin.mutation(api.ingest.linkInbox, { inboxId: inbox.inboxId, consumer: "n8n", refId: "post", linked: true })
    expect((await t.run(async (ctx) => ctx.db.query("n8nInboxLinks").collect())).map((l) => l.workflowId)).toEqual(["post"])
  })

  test("_linkInbox (setup script) syncs when needed and is idempotent", async () => {
    const t = setup()
    const { inbox } = await bootstrap(t)
    workflows = [hookWorkflow("wf1", "dr-nuoma – Užklausa", "dr-nuoma-laiskas")]
    const first = await t.action(internal.n8n._linkInbox, { address: inbox.address.toUpperCase(), workflowId: "wf1" })
    expect(first).toMatchObject({ address: inbox.address, workflowId: "wf1", created: true })
    const second = await t.action(internal.n8n._linkInbox, { address: inbox.address, workflowId: "wf1" })
    expect(second.created).toBe(false)
    expect(await t.run(async (ctx) => ctx.db.query("n8nInboxLinks").collect())).toHaveLength(1)
    await expect(t.action(internal.n8n._linkInbox, { address: inbox.address, workflowId: "missing" })).rejects.toThrow(/n8n_workflow_not_cached/)
    const ids = (await t.run(async (ctx) => ctx.db.query("n8nInboxLinks").collect())).map((l) => l.inboxId as Id<"ingestInboxes">)
    expect(ids).toEqual([inbox.inboxId])
  })
})
