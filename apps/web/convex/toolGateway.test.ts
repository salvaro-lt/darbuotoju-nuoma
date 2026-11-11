import { convexTest } from "convex-test"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { api, internal } from "./_generated/api"
import schema from "./schema"
import { modules } from "./test.setup"

// Tool gateway (convex/toolGateway.ts): assistant tools for an agent key (n8n).

const ISSUER = "https://api.workos.com/user_management/client_TEST123"
const SUPER = { subject: "user_super", issuer: ISSUER, email: "super@acme.test", email_verified: true }

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
  vi.stubGlobal("fetch", async (url: string) => {
    if (String(url).startsWith("https://api.resend.com/")) return new Response("{}", { status: 200 })
    throw new Error(`unexpected fetch ${url}`)
  })
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

async function setup() {
  const t = convexTest(schema, modules)
  await t.mutation(internal.system.registerSystem, {})
  const superUser = t.withIdentity(SUPER)
  await superUser.mutation(api.system.completeSignIn, {})
  for (const moduleId of ["ai", "staffing", "finance", "ingest"]) await superUser.mutation(api.system.setModuleEnabled, { moduleId, enabled: true })
  /** An agent key owned by the Super user with a role of these subroles. */
  const keyWith = async (subroleIds: string[]) => {
    const { roleId } = (await superUser.mutation(api.system.createRole, { name: `Key ${subroleIds.join(",")}`, subroleIds })) as { roleId: string }
    const res = await t.action(internal.n8nSetup._issueAgentKey, { name: `key-${subroleIds.join("-")}`, roleKeys: [roleId] })
    return res.secret
  }
  return { t, superUser, keyWith }
}

describe("tool gateway", () => {
  test("an invalid or malformed key is UNAUTHENTICATED", async () => {
    const { t } = await setup()
    for (const apiKey of ["dsk_nope_000000000000000000000000000000000000", "not-a-key"]) {
      expect(await t.query(api.toolGateway.listTools, { apiKey })).toMatchObject({ ok: false, code: "UNAUTHENTICATED" })
      expect(await t.action(api.toolGateway.callTool, { apiKey, tool: "staffing.list_workers", argsJson: "{}" })).toMatchObject({ ok: false, code: "UNAUTHENTICATED" })
    }
  })

  test("listTools shows only what the key may run, with MCP-safe names and object schemas", async () => {
    const { t, keyWith } = await setup()
    const viewer = await keyWith(["staffing:viewer"])
    const res = await t.query(api.toolGateway.listTools, { apiKey: viewer })
    if (!res.ok) throw new Error(res.code)
    const ids = res.tools.map((x) => x.id)
    expect(ids).toEqual(expect.arrayContaining(["staffing.list_workers", "staffing.list_projects"]))
    expect(ids).not.toContain("finance.create_invoice")
    expect(ids).not.toContain("mail.reply_to_email")
    expect(ids).not.toContain("ai.show_card")
    for (const tool of res.tools) {
      expect(tool.name).toMatch(/^[a-zA-Z0-9_-]{1,128}$/)
      expect(tool.inputSchema.type).toBe("object")
      expect(JSON.stringify(tool.inputSchema)).not.toMatch(/"\$/)
    }
    expect(res.tools.find((x) => x.id === "staffing.list_workers")).toMatchObject({ name: "staffing_list_workers", write: false })

    const accountant = await keyWith(["finance:accountant", "ingest:editor"])
    const accRes = await t.query(api.toolGateway.listTools, { apiKey: accountant })
    if (!accRes.ok) throw new Error(accRes.code)
    expect(accRes.tools.find((x) => x.id === "finance.create_invoice")).toMatchObject({ name: "finance_create_invoice", write: true })
    expect(accRes.tools.map((x) => x.id)).toContain("mail.reply_to_email")
  })

  test("a read tool runs, by id or by underscored name; unknown tool is NOT_FOUND", async () => {
    const { t, keyWith } = await setup()
    const apiKey = await keyWith(["staffing:viewer"])
    const byId = await t.action(api.toolGateway.callTool, { apiKey, tool: "staffing.list_workers", argsJson: "{}" })
    expect(byId.ok).toBe(true)
    const byName = await t.action(api.toolGateway.callTool, { apiKey, tool: "staffing_list_projects", argsJson: "{}" })
    expect(byName.ok).toBe(true)
    expect(await t.action(api.toolGateway.callTool, { apiKey, tool: "staffing.nope", argsJson: "{}" })).toMatchObject({ ok: false, code: "NOT_FOUND" })
  })

  test("a write tool the key lacks is FORBIDDEN; with permission it runs directly (no approval)", async () => {
    const { t, keyWith } = await setup()
    const viewer = await keyWith(["staffing:viewer"])
    const invoice = JSON.stringify({ number: "A-1", customer: "UAB Klientas", amountEur: 12.5 })
    const denied = await t.action(api.toolGateway.callTool, { apiKey: viewer, tool: "finance_create_invoice", argsJson: invoice })
    expect(denied).toMatchObject({ ok: false, code: "FORBIDDEN" })
    expect(await t.run((ctx) => ctx.db.query("invoices").collect())).toHaveLength(0)

    const accountant = await keyWith(["finance:accountant"])
    const res = await t.action(api.toolGateway.callTool, { apiKey: accountant, tool: "finance_create_invoice", argsJson: invoice })
    expect(res).toMatchObject({ ok: true, result: { number: "A-1", invoiceId: expect.any(String) } })
    const invoices = await t.run((ctx) => ctx.db.query("invoices").collect())
    expect(invoices.map((i) => i.number)).toEqual(["A-1"])

    // Audited as the agent.
    const audits = await t.run((ctx) => ctx.db.query("auditEvents").collect())
    expect(audits.some((e) => e.action === "ai.tool.run" && e.targetId === "finance.create_invoice" && e.result === "success")).toBe(true)
  })

  test("invalid arguments are VALIDATION", async () => {
    const { t, keyWith } = await setup()
    const accountant = await keyWith(["finance:accountant"])
    expect(await t.action(api.toolGateway.callTool, { apiKey: accountant, tool: "finance.create_invoice", argsJson: JSON.stringify({ number: "" }) })).toMatchObject({ ok: false, code: "VALIDATION" })
  })
})

describe("tool gateway: n8n tools", () => {
  const N8N_ENV = { N8N_URL: "https://n8n.test", N8N_API_KEY: "n8n-key" }
  afterEach(() => {
    for (const k of Object.keys(N8N_ENV)) delete process.env[k]
  })
  async function n8nKey() {
    const s = await setup()
    await s.superUser.mutation(api.system.setModuleEnabled, { moduleId: "n8n", enabled: true })
    return { ...s, apiKey: await s.keyWith(["n8n:admin"]) }
  }

  test("arguments with non-ASCII / $ field names pass (sent as JSON)", async () => {
    const { t, apiKey } = await n8nKey()
    await t.run((ctx) => ctx.db.insert("n8nWorkflows", { workflowId: "wf1", name: "dr-nuoma – Užklausa", active: true, tags: ["dr-nuoma"], webhookPath: "x", webhookMethod: "POST", updatedAt: 0, syncedAt: 0 }))
    const args = { workflowId: "wf1", inputs: { type: "webhook", webhookData: { method: "POST", body: { "Laiškas iš Gavimo": 1, $kaina: 2 } } } }
    const res = await t.action(api.toolGateway.callTool, { apiKey, tool: "n8n_execute_workflow", argsJson: JSON.stringify(args) })
    expect(res).toMatchObject({ ok: true, result: { queued: true, opId: expect.any(String) } })
    const [op] = await t.run((ctx) => ctx.db.query("n8nOps").collect())
    expect(JSON.parse(op!.args).inputs.webhookData.body).toEqual({ "Laiškas iš Gavimo": 1, $kaina: 2 })
    expect(await t.action(api.toolGateway.callTool, { apiKey, tool: "n8n_execute_workflow", argsJson: "{nope" })).toMatchObject({ ok: false, code: "VALIDATION" })
  })

  test("a follow-up error is ok:false with its code (untagged or unknown workflow → NOT_FOUND)", async () => {
    const { t, apiKey } = await n8nKey()
    Object.assign(process.env, N8N_ENV)
    // n8n has the workflow, but without the app's tag; any other id is a 404.
    vi.stubGlobal("fetch", async (url: string) =>
      String(url).includes("/workflows/theirs") ? Response.json({ id: "theirs", name: "Kitų", active: true, nodes: [], connections: {}, tags: [] }) : Response.json({ message: "Not Found" }, { status: 404 }),
    )
    const untagged = await t.action(api.toolGateway.callTool, { apiKey, tool: "n8n_get_workflow", argsJson: JSON.stringify({ workflowId: "theirs" }) })
    expect(untagged).toEqual({ ok: false, code: "NOT_FOUND", message: "n8n_workflow_not_found" })
    expect(await t.action(api.toolGateway.callTool, { apiKey, tool: "n8n_get_workflow", argsJson: JSON.stringify({ workflowId: "nope" }) })).toMatchObject({ ok: false, code: "NOT_FOUND" })
  })
})
