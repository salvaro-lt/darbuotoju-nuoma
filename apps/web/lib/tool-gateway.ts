// Tool gateway over HTTP for n8n and other automations, with an agent key
// (`Authorization: Bearer dsk_…`):
//
//   POST /api/v1/mcp            MCP (Streamable HTTP, stateless): tools/list, tools/call
//   GET  /api/v1/tools          the tools this key may run
//   GET  /api/v1/tools/<tool>   one tool (name or id) with its JSON schema
//   POST /api/v1/tools/<tool>   run it; JSON body = arguments → 200 JSON result
//
// Convex decides everything (convex/toolGateway.ts): key, permissions, audit.
// Writes run directly, within the key's permissions (no approval card).
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult as McpCallToolResult } from "@modelcontextprotocol/sdk/types.js"
import type { CallToolResult, GatewayTool, ListToolsResult } from "../convex/toolGateway"

export interface ToolGatewayBackend {
  listTools(apiKey: string): Promise<ListToolsResult>
  callTool(apiKey: string, tool: string, args: unknown): Promise<CallToolResult>
}

export interface ToolGatewayOptions {
  backend: () => ToolGatewayBackend
  serverName?: string
  instructions?: string
}

/** Error code → HTTP status (same map as the other /api/v1 routes). */
export const STATUS: Record<string, number> = { UNAUTHENTICATED: 401, FORBIDDEN: 403, NOT_FOUND: 404, VALIDATION: 400, CONFLICT: 409, UNAVAILABLE: 503 }

const CORS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
  "access-control-allow-headers": "authorization, content-type, mcp-protocol-version, mcp-session-id, last-event-id",
  "access-control-expose-headers": "www-authenticate, mcp-session-id, mcp-protocol-version",
  "access-control-max-age": "86400",
}
const NO_STORE = { "cache-control": "no-store" }

const DEFAULT_INSTRUCTIONS = [
  "Įmonės sistemos duomenys ir veiksmai (darbuotojai, projektai, klientai, sąskaitos, dokumentai, gauti laiškai).",
  "Rodomi tik įrankiai, kuriuos leidžia šio API rakto vaidmenys. Keitimai vykdomi iš karto, be patvirtinimo, todėl kviesk juos tik kai tikrai reikia.",
  "Niekada neišgalvok duomenų: jei įrankis jų negrąžina, jų nėra.",
  "Atsakymui į gautą laišką naudok mail_reply_to_email {emailId, text}; jei grąžina skipped, laiškas neišsiųstas (automatinis siuntėjas arba per dažnai).",
].join("\n")

const apiKeyOf = (req: Request): string | null => req.headers.get("authorization")?.match(/^Bearer\s+(dsk_\S+)\s*$/i)?.[1] ?? null

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { ...CORS, ...NO_STORE, ...headers } })
}

const rpcError = (status: number, code: number, message: string, headers: Record<string, string> = {}) => json({ jsonrpc: "2.0", error: { code, message }, id: null }, status, headers)
const mcpUnauthorized = () => rpcError(401, -32001, "Unauthorized", { "www-authenticate": 'Bearer realm="api", error="invalid_token"' })

const isRecord = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x)

/** A tool result as MCP content: JSON text plus structured content (objects only). */
export function toMcpResult(res: CallToolResult): McpCallToolResult {
  if (!res.ok) return { content: [{ type: "text", text: JSON.stringify({ code: res.code, message: res.message }) }], isError: true }
  const result = res.result ?? null
  const out: McpCallToolResult = { content: [{ type: "text", text: JSON.stringify(result) }] }
  if (isRecord(result)) out.structuredContent = result
  return out
}

function buildServer(o: ToolGatewayOptions, backend: ToolGatewayBackend, apiKey: string, tools: GatewayTool[]): McpServer {
  const server = new McpServer(
    { name: o.serverName ?? "Tools", version: "1.0.0" },
    { capabilities: { tools: {} }, instructions: o.instructions ?? DEFAULT_INSTRUCTIONS },
  )
  // Low-level handlers: the inputs are JSON schemas already (some tools use refined zod, not plain shapes).
  server.server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((t) => ({
      name: t.name,
      title: t.id,
      description: t.description,
      inputSchema: t.inputSchema as { type: "object"; [k: string]: unknown },
      annotations: { readOnlyHint: !t.write, destructiveHint: false },
    })),
  }))
  server.server.setRequestHandler(CallToolRequestSchema, async (req): Promise<McpCallToolResult> => {
    try {
      return toMcpResult(await backend.callTool(apiKey, req.params.name, req.params.arguments ?? {}))
    } catch {
      return toMcpResult({ ok: false, code: "UNAVAILABLE", message: "Service unavailable" })
    }
  })
  return server
}

export function createToolGatewayRoutes(o: ToolGatewayOptions) {
  async function list(apiKey: string): Promise<ListToolsResult | null> {
    try {
      return await o.backend().listTools(apiKey)
    } catch {
      return null
    }
  }

  async function mcp(req: Request): Promise<Response> {
    const apiKey = apiKeyOf(req)
    if (!apiKey) return mcpUnauthorized()
    const listed = await list(apiKey)
    if (!listed) return rpcError(503, -32603, "Service unavailable")
    if (!listed.ok) return listed.code === "UNAUTHENTICATED" ? mcpUnauthorized() : rpcError(STATUS[listed.code] ?? 500, -32603, listed.message)
    if (req.method !== "POST") {
      // Stateless server: no standalone SSE stream, no sessions to delete.
      return rpcError(405, -32000, "Method not allowed", { allow: "POST, OPTIONS" })
    }
    const server = buildServer(o, o.backend(), apiKey, listed.tools)
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
    await server.connect(transport)
    const res = await transport.handleRequest(req)
    const headers = new Headers(res.headers)
    for (const [k, val] of Object.entries(CORS)) headers.set(k, val)
    return new Response(res.body, { status: res.status, headers })
  }

  const preflight = () => new Response(null, { status: 204, headers: CORS })
  const restError = (code: string, message: string) => json({ code, message }, STATUS[code] ?? 500)

  async function listTools(req: Request): Promise<Response> {
    const apiKey = apiKeyOf(req)
    if (!apiKey) return restError("UNAUTHENTICATED", "Bearer dsk_… API key required.")
    const listed = await list(apiKey)
    if (!listed) return restError("UNAVAILABLE", "Service unavailable")
    if (!listed.ok) return restError(listed.code, listed.message)
    return json({ tools: listed.tools })
  }

  async function getTool(req: Request, tool: string): Promise<Response> {
    const apiKey = apiKeyOf(req)
    if (!apiKey) return restError("UNAUTHENTICATED", "Bearer dsk_… API key required.")
    const listed = await list(apiKey)
    if (!listed) return restError("UNAVAILABLE", "Service unavailable")
    if (!listed.ok) return restError(listed.code, listed.message)
    const found = listed.tools.find((t) => t.name === tool || t.id === tool)
    return found ? json(found) : restError("NOT_FOUND", `Unknown tool ${tool}.`)
  }

  async function callTool(req: Request, tool: string): Promise<Response> {
    const apiKey = apiKeyOf(req)
    if (!apiKey) return restError("UNAUTHENTICATED", "Bearer dsk_… API key required.")
    const raw = await req.text()
    let args: unknown = {}
    if (raw.trim()) {
      try {
        args = JSON.parse(raw)
      } catch {
        return restError("VALIDATION", "The body must be JSON (the tool's arguments).")
      }
    }
    if (!isRecord(args)) return restError("VALIDATION", "The body must be a JSON object (the tool's arguments).")
    let res: CallToolResult
    try {
      res = await o.backend().callTool(apiKey, tool, args)
    } catch {
      return restError("UNAVAILABLE", "Service unavailable")
    }
    return res.ok ? json(res.result ?? null) : restError(res.code, res.message)
  }

  const toolOf = async (ctx: { params: Promise<{ tool: string }> }) => (await ctx.params).tool

  return {
    mcp: { GET: mcp, POST: mcp, DELETE: mcp, OPTIONS: preflight },
    tools: { GET: listTools, OPTIONS: preflight },
    tool: {
      GET: async (req: Request, ctx: { params: Promise<{ tool: string }> }) => getTool(req, await toolOf(ctx)),
      POST: async (req: Request, ctx: { params: Promise<{ tool: string }> }) => callTool(req, await toolOf(ctx)),
      OPTIONS: preflight,
    },
  }
}
