// n8n client: the public REST API (`X-N8N-API-KEY`) for workflows, tags and
// executions, and the instance MCP server (`Authorization: Bearer`) for workflow
// details and runs. Pure fetch (default Convex runtime, no "use node").
//
// Isolation: the n8n instance is shared, so only workflows tagged N8N_TAG
// (modules/n8n.ts) exist for this app. Every read or write by id checks the tag first; an
// untagged (or missing) workflow is NOT_FOUND, the same answer either way.
//
// Errors are SystemErrors with a stable reason (`n8n_http_<status>`): never the
// response body, which may echo secrets or credentials.
import { SystemError, type ErrorCode } from "@digimuza/system-core/convex"
import { N8N_NAME_PREFIX, N8N_TAG } from "../../modules/n8n"

export { N8N_NAME_PREFIX, N8N_TAG }
export const WEBHOOK_NODE = "n8n-nodes-base.webhook"
const TIMEOUT_MS = 25_000

export interface N8nConfig {
  url: string
  apiKey: string
  mcpUrl?: string | undefined
  mcpToken?: string | undefined
}

/** From the Convex env (read by name: Convex's env is not enumerable), or null when n8n is not configured. */
export function n8nConfig(): N8nConfig | null {
  const url = process.env.N8N_URL
  const apiKey = process.env.N8N_API_KEY
  if (!url || !apiKey) return null
  return { url: url.replace(/\/+$/, ""), apiKey, mcpUrl: process.env.N8N_MCP_URL || undefined, mcpToken: process.env.N8N_MCP_TOKEN || undefined }
}

/** `https://n8n…/workflow/<id>` (editor link), or null without N8N_URL. */
export function workflowHref(workflowId: string, suffix = ""): string | null {
  const url = process.env.N8N_URL
  return url ? `${url.replace(/\/+$/, "")}/workflow/${encodeURIComponent(workflowId)}${suffix}` : null
}

export const n8nError = (code: ErrorCode, reason: string) => new SystemError(code, undefined, { reason })

export interface N8nNode {
  id?: string
  name: string
  type: string
  typeVersion: number
  position: [number, number] | number[]
  parameters: Record<string, unknown>
  credentials?: Record<string, unknown>
  disabled?: boolean
  webhookId?: string
  [key: string]: unknown
}

export interface N8nWorkflow {
  id: string
  name: string
  active: boolean
  isArchived?: boolean
  nodes: N8nNode[]
  connections: Record<string, unknown>
  settings?: Record<string, unknown>
  tags?: { id: string; name: string }[]
  createdAt?: string
  updatedAt?: string
  [key: string]: unknown
}

export interface N8nExecution {
  id: string
  finished: boolean
  mode: string
  status: string
  startedAt: string | null
  stoppedAt: string | null
  workflowId: string
  data?: unknown
}

export interface WorkflowBody {
  name: string
  nodes: N8nNode[]
  connections: Record<string, unknown>
  settings?: Record<string, unknown> | undefined
}

/**
 * Workflow settings the public API accepts on create / update (PUT rejects unknown
 * keys) and this app may set. Not `errorWorkflow`, `callerPolicy`, `callerIds`:
 * they point at (or let in) workflows outside the app's tag.
 */
const SETTINGS_KEYS = [
  "saveExecutionProgress",
  "saveManualExecutions",
  "saveDataErrorExecution",
  "saveDataSuccessExecution",
  "executionTimeout",
  "timezone",
  "executionOrder",
  "timeSavedPerExecution",
  "availableInMCP",
] as const

/** Node types that reach other workflows or the n8n API itself (outside the tag). */
export const FORBIDDEN_NODE_TYPES = new Set(["n8n-nodes-base.n8n", "n8n-nodes-base.executeWorkflow", "@n8n/n8n-nodes-langchain.toolWorkflow"])

/**
 * Tag isolation for nodes sent to n8n: no forbidden node types; credentials only by
 * name with the app's prefix (N8N_NAME_PREFIX, e.g. "dr-nuoma – 9Router"). Returns the nodes with credential ids
 * dropped (n8n resolves them by name; an id could point at any credential), or throws
 * VALIDATION.
 */
export function isolatedNodes<T extends { type?: unknown; credentials?: unknown }>(nodes: T[]): T[] {
  return nodes.map((n) => {
    if (FORBIDDEN_NODE_TYPES.has(String(n.type))) throw new SystemError("VALIDATION", undefined, { reason: "n8n_node_type_not_allowed", fields: ["nodes"] })
    if (n.credentials === undefined) return n
    if (!n.credentials || typeof n.credentials !== "object" || Array.isArray(n.credentials)) throw new SystemError("VALIDATION", undefined, { reason: "n8n_credentials_invalid", fields: ["nodes"] })
    const credentials: Record<string, { name: string }> = {}
    for (const [k, c] of Object.entries(n.credentials as Record<string, unknown>)) {
      const name = (c as { name?: unknown } | null)?.name
      if (typeof name !== "string" || !name.startsWith(N8N_NAME_PREFIX)) throw new SystemError("VALIDATION", undefined, { reason: "n8n_credential_not_allowed", fields: ["nodes"] })
      credentials[k] = { name }
    }
    return { ...n, credentials }
  })
}

export function cleanSettings(settings: Record<string, unknown> | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const k of SETTINGS_KEYS) if (settings?.[k] !== undefined) out[k] = settings[k]
  return out
}

export const hasTag = (w: { tags?: { name: string }[] | undefined }) => (w.tags ?? []).some((t) => t.name === N8N_TAG)

/** The first enabled Webhook trigger: production path and HTTP method. */
export function webhookOf(w: { nodes?: N8nNode[] | undefined }): { path: string; method: string } | null {
  const node = (w.nodes ?? []).find((n) => n.type === WEBHOOK_NODE && !n.disabled && typeof n.parameters?.path === "string" && n.parameters.path)
  if (!node) return null
  const method = typeof node.parameters.httpMethod === "string" ? node.parameters.httpMethod : "GET"
  return { path: String(node.parameters.path).replace(/^\/+/, ""), method }
}

function signal(): AbortSignal | undefined {
  return typeof AbortSignal !== "undefined" && "timeout" in AbortSignal ? AbortSignal.timeout(TIMEOUT_MS) : undefined
}

const httpError = (status: number) => n8nError(status === 404 ? "NOT_FOUND" : status === 400 ? "VALIDATION" : "UNAVAILABLE", `n8n_http_${status}`)

/** Parses a JSON-RPC response that came as JSON or as SSE (`data:` lines). */
export function parseRpc(text: string, id: number): { result?: unknown; error?: { code?: number; message?: string } } | null {
  const candidates: string[] = []
  const trimmed = text.trim()
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) candidates.push(trimmed)
  else {
    // SSE: events separated by blank lines; one or more `data:` lines per event.
    for (const event of text.split(/\r?\n\r?\n/)) {
      const data = event
        .split(/\r?\n/)
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).replace(/^ /, ""))
        .join("\n")
      if (data) candidates.push(data)
    }
  }
  for (const c of candidates) {
    try {
      const msgs = ([] as unknown[]).concat(JSON.parse(c)) as { id?: number; result?: unknown; error?: { code?: number; message?: string } }[]
      const hit = msgs.find((m) => m && m.id === id)
      if (hit) return hit
    } catch {
      // not JSON: skip
    }
  }
  return null
}

export type N8nClient = ReturnType<typeof createN8nClient>

export function createN8nClient(cfg: N8nConfig, fetchImpl: typeof fetch = (...a) => fetch(...a)) {
  const base = `${cfg.url}/api/v1`

  async function rest<T>(method: string, path: string, body?: unknown): Promise<T> {
    let res: Response
    const sig = signal()
    try {
      res = await fetchImpl(`${base}${path}`, {
        method,
        headers: { "X-N8N-API-KEY": cfg.apiKey, accept: "application/json", ...(body !== undefined ? { "content-type": "application/json" } : {}) },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        ...(sig ? { signal: sig } : {}),
      })
    } catch {
      throw n8nError("UNAVAILABLE", "n8n_unreachable")
    }
    if (!res.ok) throw httpError(res.status)
    const text = await res.text()
    try {
      return (text ? JSON.parse(text) : null) as T
    } catch {
      throw n8nError("UNAVAILABLE", "n8n_bad_response")
    }
  }

  /** Any workflow by id (no tag check: internal use only). */
  const getAny = (id: string) => rest<N8nWorkflow>("GET", `/workflows/${encodeURIComponent(id)}?excludePinnedData=true`)

  /** A workflow tagged N8N_TAG, else NOT_FOUND. */
  async function getWorkflow(id: string): Promise<N8nWorkflow> {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw n8nError("NOT_FOUND", "n8n_workflow_not_found")
    const w = await getAny(id)
    if (!w || !hasTag(w) || w.isArchived) throw n8nError("NOT_FOUND", "n8n_workflow_not_found")
    return w
  }

  async function listWorkflows(opts: { limit?: number; cursor?: string; active?: boolean } = {}): Promise<{ data: N8nWorkflow[]; nextCursor: string | null }> {
    const q = new URLSearchParams({ tags: N8N_TAG, limit: String(Math.min(Math.max(opts.limit ?? 100, 1), 250)), excludePinnedData: "true" })
    if (opts.cursor) q.set("cursor", opts.cursor)
    if (opts.active !== undefined) q.set("active", String(opts.active))
    const page = await rest<{ data?: N8nWorkflow[]; nextCursor?: string | null }>("GET", `/workflows?${q}`)
    // Never trust the server-side filter alone.
    return { data: (page?.data ?? []).filter((w) => hasTag(w) && !w.isArchived), nextCursor: page?.nextCursor ?? null }
  }

  /** Every tagged workflow (follows cursors, at most `max`). */
  async function listAllWorkflows(max = 500): Promise<N8nWorkflow[]> {
    const out: N8nWorkflow[] = []
    let cursor: string | undefined
    do {
      const page = await listWorkflows({ limit: 100, ...(cursor ? { cursor } : {}) })
      out.push(...page.data)
      cursor = page.nextCursor ?? undefined
    } while (cursor && out.length < max)
    return out.slice(0, max)
  }

  /** The tag's id, created when missing. */
  async function ensureTag(name = N8N_TAG): Promise<string> {
    let cursor: string | undefined
    for (let i = 0; i < 20; i++) {
      const q = new URLSearchParams({ limit: "100" })
      if (cursor) q.set("cursor", cursor)
      const page = await rest<{ data?: { id: string; name: string }[]; nextCursor?: string | null }>("GET", `/tags?${q}`)
      const hit = (page?.data ?? []).find((t) => t.name === name)
      if (hit) return hit.id
      cursor = page?.nextCursor ?? undefined
      if (!cursor) break
    }
    return (await rest<{ id: string }>("POST", "/tags", { name })).id
  }

  /** Replaces the workflow's tags (ids). Internal: callers check isolation first. */
  const setWorkflowTags = (id: string, tagIds: string[]) =>
    rest<{ id: string; name: string }[]>(
      "PUT",
      `/workflows/${encodeURIComponent(id)}/tags`,
      tagIds.map((t) => ({ id: t })),
    )

  /** Creates the workflow and tags it N8N_TAG (deleted again when tagging fails, so nothing untagged is left behind). */
  async function createWorkflow(body: WorkflowBody): Promise<N8nWorkflow> {
    const created = await rest<N8nWorkflow>("POST", "/workflows", { name: body.name, nodes: body.nodes, connections: body.connections, settings: cleanSettings(body.settings) })
    try {
      const tagId = await ensureTag()
      const tags = await setWorkflowTags(created.id, [tagId])
      return { ...created, tags }
    } catch (e) {
      await rest("DELETE", `/workflows/${encodeURIComponent(created.id)}`).catch(() => undefined)
      throw e
    }
  }

  /** PUT with only name, nodes, connections, settings (the API rejects read-only fields). Missing fields keep their current value. */
  async function updateWorkflow(id: string, patch: Partial<WorkflowBody>): Promise<N8nWorkflow> {
    const cur = await getWorkflow(id)
    const body = {
      name: patch.name ?? cur.name,
      nodes: patch.nodes ?? cur.nodes,
      connections: patch.connections ?? cur.connections,
      settings: cleanSettings({ ...cleanSettings(cur.settings), ...(patch.settings ?? {}) }),
    }
    const updated = await rest<N8nWorkflow>("PUT", `/workflows/${encodeURIComponent(id)}`, body)
    return { ...updated, tags: updated.tags ?? cur.tags ?? [] }
  }

  async function activate(id: string): Promise<N8nWorkflow> {
    await getWorkflow(id)
    return rest<N8nWorkflow>("POST", `/workflows/${encodeURIComponent(id)}/activate`)
  }

  async function deactivate(id: string): Promise<N8nWorkflow> {
    await getWorkflow(id)
    return rest<N8nWorkflow>("POST", `/workflows/${encodeURIComponent(id)}/deactivate`)
  }

  async function listExecutions(opts: { workflowId: string; limit?: number; includeData?: boolean }): Promise<N8nExecution[]> {
    await getWorkflow(opts.workflowId)
    const q = new URLSearchParams({ workflowId: opts.workflowId, limit: String(Math.min(Math.max(opts.limit ?? 10, 1), 100)) })
    if (opts.includeData) q.set("includeData", "true")
    const page = await rest<{ data?: N8nExecution[] }>("GET", `/executions?${q}`)
    return (page?.data ?? []).filter((e) => e.workflowId === opts.workflowId)
  }

  let rpcId = 0
  async function mcpPost(body: unknown, sessionId?: string): Promise<Response> {
    if (!cfg.mcpUrl || !cfg.mcpToken) throw new SystemError("UNAVAILABLE", undefined, { reason: "n8n_mcp_not_configured", fields: ["N8N_MCP_URL", "N8N_MCP_TOKEN"] })
    const sig = signal()
    try {
      return await fetchImpl(cfg.mcpUrl, {
        method: "POST",
        headers: {
          authorization: `Bearer ${cfg.mcpToken}`,
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          ...(sessionId ? { "mcp-session-id": sessionId } : {}),
        },
        body: JSON.stringify(body),
        ...(sig ? { signal: sig } : {}),
      })
    } catch {
      throw n8nError("UNAVAILABLE", "n8n_mcp_unreachable")
    }
  }

  /**
   * Calls an n8n instance MCP tool. The server is stateless (no session needed);
   * if it ever asks for one, initialize once and retry with `mcp-session-id`.
   * Returns the tool's structured content (or its JSON text content).
   */
  async function mcpCall<T = unknown>(tool: string, args: Record<string, unknown>): Promise<T> {
    const id = ++rpcId
    const call = { jsonrpc: "2.0", id, method: "tools/call", params: { name: tool, arguments: args } }
    let res = await mcpPost(call)
    if (res.status === 400 || res.status === 404) {
      const init = await mcpPost({ jsonrpc: "2.0", id: ++rpcId, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: N8N_TAG, version: "1" } } })
      const session = init.headers.get("mcp-session-id")
      await init.text().catch(() => "")
      if (!init.ok || !session) throw httpError(res.status)
      await mcpPost({ jsonrpc: "2.0", method: "notifications/initialized" }, session).then((r) => r.text().catch(() => ""))
      res = await mcpPost(call, session)
    }
    if (!res.ok) throw httpError(res.status)
    const msg = parseRpc(await res.text(), id)
    if (!msg) throw n8nError("UNAVAILABLE", "n8n_mcp_bad_response")
    if (msg.error) throw n8nError("UNAVAILABLE", `n8n_mcp_error_${msg.error.code ?? "unknown"}`)
    const result = (msg.result ?? {}) as { isError?: boolean; structuredContent?: unknown; content?: { type: string; text?: string }[] }
    if (result.isError) throw n8nError("UNAVAILABLE", "n8n_mcp_tool_error")
    if (result.structuredContent !== undefined) return result.structuredContent as T
    const text = result.content?.find((c) => c.type === "text")?.text
    if (text === undefined) return null as T
    try {
      return JSON.parse(text) as T
    } catch {
      return text as T
    }
  }

  /** MCP `get_workflow_details` (trigger info) for a tagged workflow. */
  async function workflowDetails(id: string): Promise<{ triggerInfo: string | null }> {
    await getWorkflow(id)
    const res = await mcpCall<{ triggerInfo?: unknown }>("get_workflow_details", { workflowId: id })
    return { triggerInfo: typeof res?.triggerInfo === "string" ? res.triggerInfo : null }
  }

  /** MCP `execute_workflow` for a tagged workflow. */
  async function executeWorkflow(id: string, inputs: unknown): Promise<unknown> {
    await getWorkflow(id)
    return mcpCall("execute_workflow", { workflowId: id, ...(inputs !== undefined ? { inputs } : {}) })
  }

  return {
    getWorkflow,
    listWorkflows,
    listAllWorkflows,
    ensureTag,
    setWorkflowTags,
    createWorkflow,
    updateWorkflow,
    activate,
    deactivate,
    listExecutions,
    mcpCall,
    workflowDetails,
    executeWorkflow,
  }
}

/** Client from the Convex env; UNAVAILABLE (naming the keys) when n8n is not configured. */
export function n8nClientFromEnv(): N8nClient {
  const cfg = n8nConfig()
  if (!cfg) throw new SystemError("UNAVAILABLE", undefined, { reason: "n8n_not_configured", fields: ["N8N_URL", "N8N_API_KEY"] })
  return createN8nClient(cfg)
}
