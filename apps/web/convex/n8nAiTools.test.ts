import { convexTest } from "convex-test"
import { executeAiTool, type AiTool } from "@digimuza/system-core/ai"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { api, internal } from "./_generated/api"
import type { Id } from "./_generated/dataModel"
import { n8nTools } from "./n8nAiTools"
import schema from "./schema"
import { system } from "./system"
import { modules } from "./test.setup"

// Assistant tools for n8n: reads go through the follow-up action, writes queue an
// n8nOps row (approval) that `_drain` runs against n8n. n8n is a fetch stub.

type T = ReturnType<typeof setup>
type User = ReturnType<T["withIdentity"]>
const setup = () => convexTest(schema, modules)

const ISSUER = "https://api.workos.com/user_management/client_TEST123"
const person = (name: string) => ({ subject: `user_${name}`, issuer: ISSUER, email: `${name}@acme.test`, email_verified: true })
const N8N = "https://n8n.test"
const N8N_ENV = { N8N_URL: N8N, N8N_API_KEY: "n8n-key", N8N_MCP_URL: `${N8N}/mcp-server/http`, N8N_MCP_TOKEN: "mcp-token", N8N_WEBHOOK_SECRET: "s" }

interface FakeWorkflow {
  id: string
  name: string
  active: boolean
  tags: { id: string; name: string }[]
  nodes: Record<string, unknown>[]
  connections: Record<string, unknown>
  settings: Record<string, unknown>
  updatedAt: string
}
const TAG = { id: "tag1", name: "dr-nuoma" }
const flow = (id: string, name: string, tags = [TAG]): FakeWorkflow => ({
  id,
  name,
  active: false,
  tags,
  nodes: [
    { name: "Laiškas", type: "n8n-nodes-base.webhook", typeVersion: 2.1, position: [0, 0], parameters: { httpMethod: "POST", path: `${id}-hook` }, webhookId: "x" },
    { name: "Atsakymas", type: "n8n-nodes-base.set", typeVersion: 3.4, position: [200, 0], parameters: {} },
  ],
  // Keyed by node names with Lithuanian letters: not valid Convex field names.
  connections: { Laiškas: { main: [[{ node: "Atsakymas", type: "main", index: 0 }]] } },
  settings: { executionOrder: "v1", callerPolicy: "workflowsFromSameOwner" },
  updatedAt: "2026-11-11T09:00:00.000Z",
})

const headersOf = (h: HeadersInit | undefined) => {
  const out: Record<string, string> = {}
  new Headers(h).forEach((value, key) => (out[key] = value))
  return out
}

let sent: { text?: string }[] = []
let workflows: FakeWorkflow[] = []
let calls: { method: string; path: string; body?: unknown; headers: Record<string, string> }[] = []
let nextId = 0

beforeEach(() => {
  sent = []
  workflows = []
  calls = []
  Object.assign(process.env, N8N_ENV)
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    const u = new URL(String(url))
    const method = init?.method ?? "GET"
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    if (u.origin === "https://api.resend.com") {
      sent.push(body)
      return Response.json({})
    }
    if (u.origin !== N8N) throw new Error(`unexpected fetch ${url}`)
    calls.push({ method, path: u.pathname + u.search, body, headers: headersOf(init?.headers) })
    const p = u.pathname
    if (p === "/mcp-server/http") {
      const { id, params } = body as { id: number; params: { name: string; arguments: { workflowId: string } } }
      const res =
        params.name === "execute_workflow"
          ? { success: true, executionId: "77" }
          : { workflow: {}, triggerInfo: `Webhook trigger: /webhook/${params.arguments.workflowId}-hook` }
      return new Response(`event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(res) }], structuredContent: res } })}\n\n`, {
        headers: { "content-type": "text/event-stream" },
      })
    }
    if (p === "/api/v1/workflows" && method === "GET") return Response.json({ data: workflows, nextCursor: null })
    if (p === "/api/v1/workflows" && method === "POST") {
      const w = { ...flow(`new${++nextId}`, body.name, []), nodes: body.nodes, connections: body.connections, settings: body.settings }
      workflows.push(w)
      return Response.json(w)
    }
    if (p === "/api/v1/tags" && method === "GET") return Response.json({ data: [TAG], nextCursor: null })
    if (p === "/api/v1/executions") return Response.json({ data: [{ id: "5", finished: true, mode: "webhook", status: "success", startedAt: "2026-11-11T10:00:00.000Z", stoppedAt: "2026-11-11T10:00:01.000Z", workflowId: u.searchParams.get("workflowId") }] })
    const m = /^\/api\/v1\/workflows\/([^/]+)(?:\/(tags|activate|deactivate))?$/.exec(p)
    const w = m ? workflows.find((x) => x.id === m[1]) : undefined
    if (!m || !w) return Response.json({ message: "Not Found" }, { status: 404 })
    if (m[2] === "tags" && method === "PUT") {
      w.tags = (body as { id: string }[]).map((t) => (t.id === TAG.id ? TAG : { id: t.id, name: t.id }))
      return Response.json(w.tags)
    }
    if (m[2] === "activate") return Response.json(Object.assign(w, { active: true }))
    if (m[2] === "deactivate") return Response.json(Object.assign(w, { active: false }))
    if (method === "PUT") {
      const extra = Object.keys(body).filter((k) => !["name", "nodes", "connections", "settings"].includes(k))
      if (extra.length) return Response.json({ message: "request/body must NOT have additional properties" }, { status: 400 })
      return Response.json(Object.assign(w, body))
    }
    return Response.json(w)
  })
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  for (const k of Object.keys(N8N_ENV)) delete process.env[k]
})

async function join(t: T, superUser: User, name: string, subroleIds: string[]) {
  const { roleId } = (await superUser.mutation(api.system.createRole, { name: `Role ${name}`, subroleIds })) as { roleId: string }
  const p = person(name)
  await superUser.action(api.system.createInvite, { email: p.email, roleIds: [roleId] })
  const token = new URL(sent.at(-1)!.text!.match(/https:\/\/app\.test\/invite\?token=\S+/)![0]).searchParams.get("token")!
  await t.withIdentity(p).mutation(api.system.completeSignIn, { inviteToken: token })
  return t.run(async (ctx) => (await ctx.db.query("users").collect()).find((u) => u.email === p.email)!.key)
}

async function bootstrap(t: T) {
  await t.mutation(internal.system.registerSystem, {})
  const superUser = t.withIdentity(person("super"))
  await superUser.mutation(api.system.completeSignIn, {})
  for (const moduleId of ["ai", "n8n"]) await superUser.mutation(api.system.setModuleEnabled, { moduleId, enabled: true })
  const viewer = await join(t, superUser, "vera", ["ai:user", "n8n:viewer"])
  const admin = await join(t, superUser, "adam", ["ai:user", "n8n:admin"])
  return { viewer, admin }
}

const tool = (id: string) => n8nTools.find((x) => x.id === id)! as AiTool
/** One tool call as `userId`, then its follow-up action (as the runner does). */
async function call(t: T, userId: string, id: string, args: unknown) {
  const res = await t.run(async (ctx) => {
    const { sys } = await system.context(ctx)
    return executeAiTool({ db: ctx.db, sys, actorRef: { kind: "user", userId }, tool: tool(id), args, toolCallId: `tc_${id}` })
  })
  if (!res.ok || !tool(id).followUpAction) return res
  return { ok: true as const, result: await t.action(internal.n8n._toolRead, { input: res.result, actor: { kind: "user", userId }, operationId: "op" }) }
}

const NEW_FLOW = {
  name: "Rytinė suvestinė",
  nodes: [
    { name: "Kas rytą", type: "n8n-nodes-base.scheduleTrigger", typeVersion: 1.3, position: [0, 0], parameters: { rule: { interval: [{ field: "cronExpression", expression: "0 8 * * 1-5" }] } } },
    { name: "Hook", type: "n8n-nodes-base.webhook", typeVersion: 2.1, position: [0, 200], parameters: { httpMethod: "POST", path: "rytas" } },
  ],
  // As the model sends it: a JSON string (node names with Lithuanian letters are keys).
  connections: JSON.stringify({ "Kas rytą": { main: [[{ node: "Hook", type: "main", index: 0 }]] } }),
  activate: true,
}

describe("n8n assistant tools", () => {
  test("reads go to n8n and see only tagged workflows; writes require approval and n8n:workflow:manage", async () => {
    const t = setup()
    const { viewer } = await bootstrap(t)
    workflows = [flow("wf1", "dr-nuoma – Užklausa"), flow("theirs", "Kitų workflow", [{ id: "t2", name: "crm" }])]

    const search = await call(t, viewer, "n8n.search_workflows", {})
    expect(search).toMatchObject({ ok: true, result: { workflows: [{ workflowId: "wf1", name: "dr-nuoma – Užklausa", webhook: { path: "wf1-hook", method: "POST" }, url: `${N8N}/workflow/wf1` }] } })
    expect(calls.every((c) => c.path.startsWith("/api/v1/") ? c.headers["x-n8n-api-key"] === "n8n-key" : c.headers.authorization === "Bearer mcp-token")).toBe(true)

    const details = await call(t, viewer, "n8n.get_workflow", { workflowId: "wf1" })
    expect(details).toMatchObject({ ok: true, result: { workflowId: "wf1", nodes: [{ name: "Laiškas", type: "n8n-nodes-base.webhook" }, { name: "Atsakymas" }], triggerInfo: "Webhook trigger: /webhook/wf1-hook" } })
    expect(JSON.parse((details as { result: { connectionsJson: string } }).result.connectionsJson)).toEqual({ Laiškas: { main: [[{ node: "Atsakymas", type: "main", index: 0 }]] } })
    expect(await call(t, viewer, "n8n.get_workflow", { workflowId: "theirs" })).toMatchObject({ ok: true, result: { error: "NOT_FOUND" } })
    expect(await call(t, viewer, "n8n.list_executions", { workflowId: "wf1", limit: 5 })).toMatchObject({ ok: true, result: { executions: [{ id: "5", status: "success" }] } })
    expect(await call(t, viewer, "n8n.list_executions", { workflowId: "theirs" })).toMatchObject({ result: { error: "NOT_FOUND" } })
    const types = await call(t, viewer, "n8n.list_node_types", { query: "webhook" })
    expect((types as { result: { nodes: { type: string }[] } }).result.nodes.map((n) => n.type)).toContain("n8n-nodes-base.webhook")

    expect(await call(t, viewer, "n8n.create_workflow", NEW_FLOW)).toMatchObject({ ok: false, code: "FORBIDDEN" })
    for (const x of n8nTools) expect([x.id, Boolean(x.requiresApproval), x.permission]).toEqual([x.id, /create|update|set_workflow|execute/.test(x.id), x.requiresApproval ? "n8n:workflow:manage" : "n8n:workflow:view"])
    expect(await t.run(async (ctx) => ctx.db.query("n8nOps").collect())).toHaveLength(0)
  })

  test("create_workflow queues an op; _drain creates, tags and activates it; get_operation returns the result", async () => {
    const t = setup()
    const { admin, viewer } = await bootstrap(t)
    const queued = await call(t, admin, "n8n.create_workflow", NEW_FLOW)
    expect(queued).toMatchObject({ ok: true, result: { queued: true } })
    const opId = (queued as { result: { opId: Id<"n8nOps"> } }).result.opId
    expect(calls).toHaveLength(0)

    const op = await t.run(async (ctx) => ctx.db.get(opId))
    expect({ ...op, args: JSON.parse(op!.args as string) }).toMatchObject({ kind: "create_workflow", status: "pending", args: { name: "dr-nuoma – Rytinė suvestinė", settings: { executionOrder: "v1", availableInMCP: true }, activate: true } })

    await t.action(internal.n8n._drain, {})
    const steps = calls.map((c) => `${c.method} ${c.path.split("?")[0]}`)
    expect(steps.slice(0, 5)).toEqual(["POST /api/v1/workflows", "GET /api/v1/tags", "PUT /api/v1/workflows/new1/tags", "GET /api/v1/workflows/new1", "POST /api/v1/workflows/new1/activate"])
    const created = calls[0]!.body as { name: string; nodes: { type: string; webhookId?: string }[]; settings: Record<string, unknown> }
    expect(created.name).toBe("dr-nuoma – Rytinė suvestinė")
    expect(created.nodes.find((n) => n.type === "n8n-nodes-base.webhook")?.webhookId).toMatch(/^[0-9a-f-]{36}$/)
    expect(calls[2]!.body).toEqual([{ id: "tag1" }])
    expect((calls[0]!.body as { connections: unknown }).connections).toEqual({ "Kas rytą": { main: [[{ node: "Hook", type: "main", index: 0 }]] } })
    // The cache was refreshed after the op.
    expect((await t.run(async (ctx) => ctx.db.query("n8nWorkflows").collect())).map((w) => [w.workflowId, w.active, w.webhookPath])).toEqual([["new1", true, "rytas"]])

    const res = await call(t, admin, "n8n.get_operation", { opId })
    expect(res).toMatchObject({ ok: true, result: { opId, status: "done", result: { workflowId: "new1", name: "dr-nuoma – Rytinė suvestinė", active: true, url: `${N8N}/workflow/new1` } } })
    // Someone else's operation is not found.
    expect(await call(t, viewer, "n8n.get_operation", { opId })).toMatchObject({ ok: false, code: "NOT_FOUND" })
  })

  test("get_operation runs a still-pending op at once; update keeps only writable fields", async () => {
    const t = setup()
    const { admin } = await bootstrap(t)
    workflows = [flow("wf1", "dr-nuoma – Užklausa")]
    await t.action(internal.n8n._syncWorkflows, {})
    const queued = await call(t, admin, "n8n.update_workflow", { workflowId: "wf1", name: "Užklausa v2" })
    const opId = (queued as { result: { opId: Id<"n8nOps"> } }).result.opId
    const res = await call(t, admin, "n8n.get_operation", { opId })
    expect(res).toMatchObject({ result: { status: "done", result: { workflowId: "wf1", name: "dr-nuoma – Užklausa v2" } } })
    const put = calls.find((c) => c.method === "PUT" && c.path === "/api/v1/workflows/wf1")!
    expect(Object.keys(put.body as object).sort()).toEqual(["connections", "name", "nodes", "settings"])

    const run = await call(t, admin, "n8n.execute_workflow", { workflowId: "wf1", inputs: { type: "webhook", webhookData: { method: "POST", body: { a: 1 } } } })
    const runOp = (run as { result: { opId: Id<"n8nOps"> } }).result.opId
    expect(await call(t, admin, "n8n.get_operation", { opId: runOp })).toMatchObject({ result: { status: "done", result: { workflowId: "wf1", executionId: "77", status: "success" } } })
    const mcp = calls.filter((c) => c.path === "/mcp-server/http").at(-1)!
    expect(mcp.body).toMatchObject({ method: "tools/call", params: { name: "execute_workflow", arguments: { workflowId: "wf1", inputs: { type: "webhook" } } } })
  })

  test("writes on an untagged workflow are NOT_FOUND (handler and drain)", async () => {
    const t = setup()
    const { admin } = await bootstrap(t)
    workflows = [flow("theirs", "Kitų workflow", [])]
    await t.action(internal.n8n._syncWorkflows, {})
    expect(await call(t, admin, "n8n.update_workflow", { workflowId: "theirs", name: "x" })).toMatchObject({ ok: false, code: "NOT_FOUND" })
    expect(await call(t, admin, "n8n.set_workflow_active", { workflowId: "theirs", active: true })).toMatchObject({ ok: false, code: "NOT_FOUND" })
    expect(await call(t, admin, "n8n.execute_workflow", { workflowId: "theirs" })).toMatchObject({ ok: false, code: "NOT_FOUND" })

    // Even an op that slipped into the outbox is refused live (tag re-checked before any write).
    const opId = await t.run(async (ctx) =>
      ctx.db.insert("n8nOps", { kind: "set_active", args: JSON.stringify({ workflowId: "theirs", active: true }), status: "pending", actorRef: { kind: "user", userId: admin }, attempts: 0, createdAt: Date.now(), updatedAt: Date.now() }),
    )
    await t.action(internal.n8n._drain, {})
    expect(await t.run(async (ctx) => ctx.db.get(opId))).toMatchObject({ status: "failed", error: "n8n_workflow_not_found" })
    expect(calls.some((c) => c.method !== "GET")).toBe(false)
    expect(workflows[0]!.active).toBe(false)
  })

  test("tag isolation: credentials only by the app's prefixed name, no workflow-calling nodes, no cross-workflow settings", async () => {
    const t = setup()
    const { admin } = await bootstrap(t)
    const withNode = (extra: Record<string, unknown>) => ({ ...NEW_FLOW, nodes: [NEW_FLOW.nodes[0], { ...NEW_FLOW.nodes[1], ...extra }] })
    const rejected = [
      withNode({ credentials: { httpHeaderAuth: { name: "Kito kliento raktas" } } }),
      withNode({ credentials: { httpHeaderAuth: { id: "cred9" } } }),
      withNode({ type: "n8n-nodes-base.n8n" }),
      withNode({ type: "n8n-nodes-base.executeWorkflow" }),
    ]
    for (const args of rejected) expect(await call(t, admin, "n8n.create_workflow", args)).toMatchObject({ ok: false, code: "VALIDATION" })
    expect(await t.run(async (ctx) => ctx.db.query("n8nOps").collect())).toHaveLength(0)

    // Allowed: a prefixed credential (its id dropped: n8n resolves it by name); unsafe settings stripped.
    const ok = await call(t, admin, "n8n.create_workflow", {
      ...withNode({ credentials: { httpHeaderAuth: { id: "cred9", name: "dr-nuoma – Webhook" } } }),
      settings: { errorWorkflow: "theirs", callerPolicy: "any", callerIds: "theirs", timezone: "Europe/Vilnius" },
    })
    expect(ok).toMatchObject({ ok: true, result: { queued: true } })
    await t.action(internal.n8n._drain, {})
    const created = calls.find((c) => c.method === "POST" && c.path === "/api/v1/workflows")!.body as { nodes: { credentials?: unknown }[]; settings: Record<string, unknown> }
    expect(created.nodes[1]!.credentials).toEqual({ httpHeaderAuth: { name: "dr-nuoma – Webhook" } })
    expect(created.settings).toEqual({ timezone: "Europe/Vilnius", executionOrder: "v1", availableInMCP: true })

    // The drain checks again: an op that slipped into the outbox is refused before any call.
    calls = []
    const bad = { name: "x", nodes: [{ name: "n", type: "n8n-nodes-base.n8n", typeVersion: 1, position: [0, 0], parameters: {} }], connections: {} }
    const opId = await t.run(async (ctx) =>
      ctx.db.insert("n8nOps", { kind: "create_workflow", args: JSON.stringify(bad), status: "pending", actorRef: { kind: "user", userId: admin }, attempts: 0, createdAt: Date.now(), updatedAt: Date.now() }),
    )
    await t.action(internal.n8n._drain, {})
    expect(await t.run(async (ctx) => ctx.db.get(opId))).toMatchObject({ status: "failed", error: "n8n_node_type_not_allowed" })
    expect(calls.some((c) => c.method !== "GET")).toBe(false)
  })

  test("the drain re-authorizes the op's actor: without n8n:workflow:manage it fails not_authorized, nothing sent", async () => {
    const t = setup()
    const { viewer } = await bootstrap(t)
    workflows = [flow("wf1", "dr-nuoma – Užklausa")]
    await t.action(internal.n8n._syncWorkflows, {})
    calls = []
    const opId = await t.run(async (ctx) =>
      ctx.db.insert("n8nOps", { kind: "set_active", args: JSON.stringify({ workflowId: "wf1", active: true }), status: "pending", actorRef: { kind: "user", userId: viewer }, attempts: 0, createdAt: Date.now(), updatedAt: Date.now() }),
    )
    await t.action(internal.n8n._drain, {})
    expect(await t.run(async (ctx) => ctx.db.get(opId))).toMatchObject({ status: "failed", error: "not_authorized" })
    expect(calls).toHaveLength(0)
  })
})
