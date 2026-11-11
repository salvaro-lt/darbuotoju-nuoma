import { describe, expect, test } from "vitest"
import type { CallToolResult, GatewayTool, ListToolsResult } from "../convex/toolGateway"
import { createToolGatewayRoutes, type ToolGatewayBackend } from "./tool-gateway"

// The HTTP side of the tool gateway with a fake Convex backend: MCP round trip
// (initialize → tools/list → tools/call) and the REST routes.

const KEY = "dsk_abcdefghij_0123456789abcdefghijklmnopqrstuvwxyz"
const TOOLS: GatewayTool[] = [
  { name: "staffing_list_workers", id: "staffing.list_workers", description: "Darbuotojai", inputSchema: { type: "object", properties: { includeInactive: { type: "boolean" } } }, write: false },
  { name: "finance_create_invoice", id: "finance.create_invoice", description: "Sąskaita", inputSchema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] }, write: true },
]

function fakeBackend() {
  const calls: { tool: string; args: unknown }[] = []
  const backend: ToolGatewayBackend = {
    async listTools(apiKey): Promise<ListToolsResult> {
      return apiKey === KEY ? { ok: true, tools: TOOLS } : { ok: false, code: "UNAUTHENTICATED", message: "bad key" }
    },
    async callTool(apiKey, tool, args): Promise<CallToolResult> {
      calls.push({ tool, args })
      if (apiKey !== KEY) return { ok: false, code: "UNAUTHENTICATED", message: "bad key" }
      if (tool === "finance_create_invoice" || tool === "finance.create_invoice") return { ok: false, code: "FORBIDDEN", message: "Not allowed" }
      if (tool === "staffing_list_workers" || tool === "staffing.list_workers") return { ok: true, result: { items: [{ id: "w1" }] } }
      return { ok: false, code: "NOT_FOUND", message: "Unknown tool" }
    },
  }
  return { backend, calls }
}

const HEADERS = { "content-type": "application/json", accept: "application/json, text/event-stream" }

function rpc(routes: ReturnType<typeof createToolGatewayRoutes>, body: unknown, key: string | null = KEY) {
  const headers: Record<string, string> = { ...HEADERS, "mcp-protocol-version": "2025-06-18" }
  if (key) headers.authorization = `Bearer ${key}`
  return routes.mcp.POST(new Request("https://app.test/api/v1/mcp", { method: "POST", headers, body: JSON.stringify(body) }))
}

const params = (tool: string) => ({ params: Promise.resolve({ tool }) })

describe("MCP endpoint", () => {
  test("initialize, tools/list and tools/call round trip", async () => {
    const { backend, calls } = fakeBackend()
    const routes = createToolGatewayRoutes({ backend: () => backend, serverName: "Test duomenys" })

    const init = await rpc(routes, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "n8n", version: "1" } },
    })
    expect(init.status).toBe(200)
    const initBody = await init.json()
    expect(initBody.result.serverInfo.name).toBe("Test duomenys")
    expect(initBody.result.capabilities.tools).toBeDefined()
    expect(initBody.result.instructions).toMatch(/mail_reply_to_email/)

    const list = await (await rpc(routes, { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })).json()
    expect(list.result.tools.map((t: { name: string }) => t.name)).toEqual(["staffing_list_workers", "finance_create_invoice"])
    expect(list.result.tools[1]).toMatchObject({ inputSchema: { type: "object", required: ["name"] }, annotations: { readOnlyHint: false } })

    const call = await (await rpc(routes, { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "staffing_list_workers", arguments: { includeInactive: true } } })).json()
    expect(call.result).toEqual({ content: [{ type: "text", text: '{"items":[{"id":"w1"}]}' }], structuredContent: { items: [{ id: "w1" }] } })
    expect(calls.at(-1)).toEqual({ tool: "staffing_list_workers", args: { includeInactive: true } })

    const denied = await (await rpc(routes, { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "finance_create_invoice", arguments: { name: "J" } } })).json()
    expect(denied.result.isError).toBe(true)
    expect(JSON.parse(denied.result.content[0].text)).toEqual({ code: "FORBIDDEN", message: "Not allowed" })
  })

  test("missing or invalid key → 401 JSON-RPC -32001 with WWW-Authenticate; GET → 405", async () => {
    const { backend } = fakeBackend()
    const routes = createToolGatewayRoutes({ backend: () => backend })
    for (const key of [null, "dsk_wrong_000", "not-a-dsk-key"]) {
      const res = await rpc(routes, { jsonrpc: "2.0", id: 1, method: "tools/list" }, key)
      expect(res.status).toBe(401)
      expect(res.headers.get("www-authenticate")).toMatch(/^Bearer/)
      expect((await res.json()).error.code).toBe(-32001)
    }
    const get = await routes.mcp.GET(new Request("https://app.test/api/v1/mcp", { headers: { authorization: `Bearer ${KEY}` } }))
    expect(get.status).toBe(405)
  })

  test("backend down → 503", async () => {
    const routes = createToolGatewayRoutes({
      backend: () => ({
        listTools: () => Promise.reject(new Error("down")),
        callTool: () => Promise.reject(new Error("down")),
      }),
    })
    expect((await rpc(routes, { jsonrpc: "2.0", id: 1, method: "tools/list" })).status).toBe(503)
  })
})

describe("REST /api/v1/tools", () => {
  test("lists, describes and runs tools; maps error codes to HTTP status", async () => {
    const { backend, calls } = fakeBackend()
    const routes = createToolGatewayRoutes({ backend: () => backend })
    const auth = { authorization: `Bearer ${KEY}` }

    const list = await routes.tools.GET(new Request("https://app.test/api/v1/tools", { headers: auth }))
    expect(list.status).toBe(200)
    expect((await list.json()).tools).toHaveLength(2)

    const one = await routes.tool.GET(new Request("https://app.test/api/v1/tools/staffing.list_workers", { headers: auth }), params("staffing.list_workers"))
    expect(await one.json()).toMatchObject({ name: "staffing_list_workers" })

    const ok = await routes.tool.POST(
      new Request("https://app.test/api/v1/tools/staffing.list_workers", { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: "{}" }),
      params("staffing.list_workers"),
    )
    expect(ok.status).toBe(200)
    expect(await ok.json()).toEqual({ items: [{ id: "w1" }] })

    const empty = await routes.tool.POST(new Request("https://app.test/api/v1/tools/x", { method: "POST", headers: auth }), params("staffing_list_workers"))
    expect(empty.status).toBe(200)
    expect(calls.at(-1)).toEqual({ tool: "staffing_list_workers", args: {} })

    const forbidden = await routes.tool.POST(new Request("https://app.test/x", { method: "POST", headers: auth, body: '{"name":"J"}' }), params("finance_create_invoice"))
    expect(forbidden.status).toBe(403)
    expect(await forbidden.json()).toEqual({ code: "FORBIDDEN", message: "Not allowed" })

    expect((await routes.tool.POST(new Request("https://app.test/x", { method: "POST", headers: auth, body: "{}" }), params("nope"))).status).toBe(404)
    expect((await routes.tool.POST(new Request("https://app.test/x", { method: "POST", headers: auth, body: "[1]" }), params("staffing_list_workers"))).status).toBe(400)
    expect((await routes.tool.POST(new Request("https://app.test/x", { method: "POST", headers: auth, body: "{oops" }), params("staffing_list_workers"))).status).toBe(400)
    expect((await routes.tool.POST(new Request("https://app.test/x", { method: "POST", body: "{}" }), params("staffing_list_workers"))).status).toBe(401)
    expect((await routes.tools.GET(new Request("https://app.test/api/v1/tools", { headers: { authorization: "Bearer dsk_wrong_1" } }))).status).toBe(401)
  })
})
