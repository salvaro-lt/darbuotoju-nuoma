// Assistant tools of the app-only `n8n` module (modules/n8n.ts), for convex/aiConfig.ts.
//
// Tool handlers run inside a mutation (no fetch, no scheduler), so:
//  - reads (n8n:workflow:view) validate and return their input; the follow-up
//    action `n8n:_toolRead` (convex/n8n.ts) calls n8n and returns the result;
//  - writes (n8n:workflow:manage, approval card) validate and queue an n8nOps row;
//    the cron (`n8n:_drain`, every 10 s) or `n8n.get_operation` runs it.
//
// Isolation: only workflows tagged N8N_TAG (modules/n8n.ts) exist here. Writes by id require
// the workflow in the n8nWorkflows cache (tagged only); the drain checks the tag
// again live before touching n8n.
import { defineAiTool } from "@digimuza/system-core/ai"
import { SystemError, toActorRef, type Actor, type ActorRef } from "@digimuza/system-core/convex"
import { z } from "zod"
import { N8nPermissions as P } from "../modules/n8n"
import type { Doc, Id } from "./_generated/dataModel"
import { cleanSettings, isolatedNodes, N8N_NAME_PREFIX, N8N_TAG } from "./model/n8nClient"
import { cachedWorkflow } from "./model/n8nConsumer"
import { N8N_NODE_CATALOG } from "./model/n8nNodes"
import type { N8nOpKind } from "./model/n8nTables"

const READ = "n8n:_toolRead"
const sameActor = (r: ActorRef, a: Actor) => (r.kind === "user" ? a.kind === "user" && a.userId === r.userId : a.kind === "agent" && a.apiKeyId === r.apiKeyId)
const notFound = (reason: string) => new SystemError("NOT_FOUND", undefined, { reason })
const invalid = (reason: string, fields: string[]) => new SystemError("VALIDATION", undefined, { reason, fields })

type Db = {
  insert(table: "n8nOps", doc: object): Promise<Id<"n8nOps">>
  get(id: Id<"n8nOps">): Promise<Doc<"n8nOps"> | null>
  normalizeId(table: "n8nOps", id: string): Id<"n8nOps"> | null
}

const workflowId = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_-]{1,64}$/)
  .describe("n8n workflow id (iš n8n.search_workflows)")

const node = z.looseObject({
  id: z.string().max(64).optional(),
  name: z.string().trim().min(1).max(128),
  type: z
    .string()
    .trim()
    .regex(/^[@a-zA-Z0-9_./-]+$/)
    .max(128)
    .describe("Node type, e.g. n8n-nodes-base.webhook (iš n8n.list_node_types)"),
  typeVersion: z.number().positive(),
  position: z.array(z.number()).length(2).describe("[x, y]"),
  parameters: z.record(z.string(), z.unknown()),
  credentials: z.record(z.string(), z.object({ id: z.string().optional(), name: z.string() })).optional().describe(`e.g. { openAiApi: { name: "${N8N_NAME_PREFIX}9Router" } }`),
  webhookId: z.string().max(64).optional(),
  disabled: z.boolean().optional(),
})
const nodes = z.array(node).min(1).max(100)
// A JSON string is preferred: connections are keyed by node names, and names with
// non-ASCII letters (e.g. "Laiškas") are not valid field names in the chat's stored tool calls.
const connections = z
  .union([z.string().max(200_000), z.record(z.string(), z.unknown())])
  .describe('n8n connections as a JSON string (preferred), e.g. "{\\"Webhook\\":{\\"main\\":[[{\\"node\\":\\"AI Agent\\",\\"type\\":\\"main\\",\\"index\\":0}]]}}"')

/** The connections object (parsed when given as JSON). */
function connectionsOf(raw: string | Record<string, unknown>): Record<string, unknown> {
  if (typeof raw !== "string") return raw
  try {
    const parsed: unknown = JSON.parse(raw)
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>
  } catch {
    // fall through
  }
  throw invalid("connections_not_json_object", ["connections"])
}
const settings = z.record(z.string(), z.unknown()).optional()

/** Unique node names; connections only between existing nodes. Returns the invalid fields. */
function checkGraph(ns: z.infer<typeof nodes>, conns: Record<string, unknown>): void {
  const names = new Set<string>()
  for (const n of ns) {
    if (names.has(n.name)) throw invalid("duplicate_node_name", ["nodes"])
    names.add(n.name)
  }
  for (const [from, outs] of Object.entries(conns)) {
    if (!names.has(from)) throw invalid("connection_from_unknown_node", ["connections"])
    for (const groups of Object.values((outs ?? {}) as Record<string, unknown>))
      for (const group of Array.isArray(groups) ? groups : [])
        for (const c of Array.isArray(group) ? group : []) {
          const to = (c as { node?: unknown })?.node
          if (typeof to !== "string" || !names.has(to)) throw invalid("connection_to_unknown_node", ["connections"])
        }
  }
}

async function queue(db: unknown, actor: Actor, kind: N8nOpKind, args: Record<string, unknown>) {
  const now = Date.now()
  // JSON: n8n objects may have field names Convex values do not allow (node names in connections).
  const opId = await (db as Db).insert("n8nOps", { kind, args: JSON.stringify(args), status: "pending", actorRef: toActorRef(actor), attempts: 0, createdAt: now, updatedAt: now })
  return { queued: true, opId, note: "Patvirtinta ir eilėje. Iškviesk n8n.get_operation su šiuo opId, kad gautum rezultatą." }
}

async function requireCached(db: unknown, id: string) {
  const w = await cachedWorkflow(db, id)
  if (!w) throw notFound("n8n_workflow_not_found")
  return w
}

/* ---------- Read ---------- */

export const n8nSearchWorkflowsTool = defineAiTool({
  id: "n8n.search_workflows",
  description: `Lists the n8n workflows of this app (tag ${N8N_TAG}): id, name, active, webhook trigger, editor URL. Optional name filter.`,
  permission: P.view,
  input: z.object({
    query: z.string().trim().max(100).optional().describe("Part of the name"),
    active: z.boolean().optional().describe("Only active (true) or inactive (false) workflows"),
  }),
  followUpAction: READ,
  handler: async (_ctx, input) => ({ kind: "search_workflows" as const, ...input }),
})

export const n8nGetWorkflowTool = defineAiTool({
  id: "n8n.get_workflow",
  description:
    `One n8n workflow (tag ${N8N_TAG}): nodes with parameters, connections (JSON string connectionsJson), settings and its triggers (webhook URL, method, auth). Use before n8n.update_workflow (pass connectionsJson back as connections).`,
  permission: P.view,
  input: z.object({ workflowId }),
  followUpAction: READ,
  handler: async (_ctx, input) => ({ kind: "get_workflow" as const, workflowId: input.workflowId }),
})

export const n8nListExecutionsTool = defineAiTool({
  id: "n8n.list_executions",
  description: "Latest executions of an n8n workflow (status success/error/running, mode, start/stop time) and the link to the executions list.",
  permission: P.view,
  input: z.object({ workflowId, limit: z.number().int().min(1).max(20).optional().describe("1-20, default 10") }),
  followUpAction: READ,
  handler: async (_ctx, input) => ({ kind: "list_executions" as const, workflowId: input.workflowId, limit: input.limit ?? 10 }),
})

export const n8nListNodeTypesTool = defineAiTool({
  id: "n8n.list_node_types",
  description:
    "Catalogue of n8n node types available on this instance (n8n 2.1.5): type, newest typeVersion, kind (trigger/action/flow/ai/ai-sub), credentials, minimal parameters example and notes. Call it before building a workflow.",
  permission: P.view,
  input: z.object({ query: z.string().trim().max(100).optional().describe("Filter by name, type, kind or purpose, e.g. webhook, ai, http") }),
  handler: async (_ctx, input) => {
    const q = input.query?.toLowerCase()
    const hits = N8N_NODE_CATALOG.filter((n) => !q || [n.name, n.type, n.kind, n.purpose].some((s) => s.toLowerCase().includes(q)))
    return { nodes: hits.length ? hits : N8N_NODE_CATALOG }
  },
})

export const n8nGetOperationTool = defineAiTool({
  id: "n8n.get_operation",
  description: "Result of an approved n8n write (create/update/activate/execute) by opId: runs it now if still queued, then returns status (done/failed/running) and the result (workflow id, name, active, URL or execution status).",
  permission: P.view,
  input: z.object({ opId: z.string().trim().min(1).max(64) }),
  followUpAction: READ,
  handler: async ({ db, actor }, input) => {
    const id = (db as Db).normalizeId("n8nOps", input.opId)
    const op = id ? await (db as Db).get(id) : null
    // Only the caller's own operations.
    if (!op || !sameActor(op.actorRef, actor)) throw notFound("n8n_op_not_found")
    return { kind: "get_operation" as const, opId: op._id }
  },
})

/* ---------- Write (approval) ---------- */

export const n8nCreateWorkflowTool = defineAiTool({
  id: "n8n.create_workflow",
  description:
    `Creates an n8n workflow tagged ${N8N_TAG} (name gets the "${N8N_NAME_PREFIX}" prefix; settings executionOrder v1, available in MCP). Optionally activates it. Shows an approval card; after approval call n8n.get_operation with the returned opId.`,
  permission: P.manage,
  requiresApproval: true,
  input: z.object({
    name: z.string().trim().min(1).max(120),
    nodes,
    connections,
    settings,
    activate: z.boolean().optional().describe("Activate right after creating (default false)"),
  }),
  handler: async ({ db, actor }, input) => {
    const conns = connectionsOf(input.connections)
    checkGraph(input.nodes, conns)
    const name = input.name.startsWith(N8N_NAME_PREFIX) ? input.name : `${N8N_NAME_PREFIX}${input.name}`
    return queue(db, actor, "create_workflow", {
      name,
      nodes: isolatedNodes(input.nodes),
      connections: conns,
      settings: { ...cleanSettings(input.settings), executionOrder: "v1", availableInMCP: true },
      activate: input.activate ?? false,
    })
  },
})

export const n8nUpdateWorkflowTool = defineAiTool({
  id: "n8n.update_workflow",
  description:
    `Changes an n8n workflow (tag ${N8N_TAG}): name, nodes, connections and/or settings. nodes and connections replace the whole lists, so start from n8n.get_workflow. An active workflow publishes the change at once. Shows an approval card; then call n8n.get_operation.`,
  permission: P.manage,
  requiresApproval: true,
  input: z.object({
    workflowId,
    name: z.string().trim().min(1).max(120).optional(),
    nodes: nodes.optional(),
    connections: connections.optional(),
    settings,
  }),
  handler: async ({ db, actor }, input) => {
    await requireCached(db, input.workflowId)
    if (!input.name && !input.nodes && !input.connections && !input.settings) throw invalid("nothing_to_update", ["name", "nodes", "connections", "settings"])
    if (input.nodes || input.connections) {
      if (!input.nodes || !input.connections) throw invalid("nodes_and_connections_together", ["nodes", "connections"])
      checkGraph(input.nodes, connectionsOf(input.connections))
    }
    const name = input.name && !input.name.startsWith(N8N_NAME_PREFIX) ? `${N8N_NAME_PREFIX}${input.name}` : input.name
    return queue(db, actor, "update_workflow", {
      workflowId: input.workflowId,
      ...(name ? { name } : {}),
      ...(input.nodes && input.connections ? { nodes: isolatedNodes(input.nodes), connections: connectionsOf(input.connections) } : {}),
      ...(input.settings ? { settings: cleanSettings(input.settings) } : {}),
    })
  },
})

export const n8nSetWorkflowActiveTool = defineAiTool({
  id: "n8n.set_workflow_active",
  description: `Activates (active: true) or deactivates an n8n workflow (tag ${N8N_TAG}). Shows an approval card; then call n8n.get_operation.`,
  permission: P.manage,
  requiresApproval: true,
  input: z.object({ workflowId, active: z.boolean() }),
  handler: async ({ db, actor }, input) => {
    await requireCached(db, input.workflowId)
    return queue(db, actor, "set_active", { workflowId: input.workflowId, active: input.active })
  },
})

const inputs = z
  .union([
    z.object({ type: z.literal("chat"), chatInput: z.string().max(20_000) }),
    z.object({ type: z.literal("form"), formData: z.record(z.string(), z.unknown()) }),
    z.object({
      type: z.literal("webhook"),
      webhookData: z.object({
        method: z.enum(["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"]).optional(),
        query: z.record(z.string(), z.string()).optional(),
        body: z.record(z.string(), z.unknown()).optional(),
        headers: z.record(z.string(), z.string()).optional(),
      }),
    }),
  ])
  .optional()
  .describe("Inputs by trigger type: chat {type:'chat', chatInput}, form {type:'form', formData}, webhook {type:'webhook', webhookData:{method, query, body, headers}}")

export const n8nExecuteWorkflowTool = defineAiTool({
  id: "n8n.execute_workflow",
  description: `Runs an n8n workflow (tag ${N8N_TAG}) once through the n8n MCP server, with inputs for its trigger. Shows an approval card; then call n8n.get_operation for the execution status.`,
  permission: P.manage,
  requiresApproval: true,
  input: z.object({ workflowId, inputs }),
  handler: async ({ db, actor }, input) => {
    await requireCached(db, input.workflowId)
    return queue(db, actor, "execute_workflow", { workflowId: input.workflowId, ...(input.inputs ? { inputs: input.inputs } : {}) })
  },
})

export const n8nTools = [
  n8nSearchWorkflowsTool,
  n8nGetWorkflowTool,
  n8nListExecutionsTool,
  n8nListNodeTypesTool,
  n8nGetOperationTool,
  n8nCreateWorkflowTool,
  n8nUpdateWorkflowTool,
  n8nSetWorkflowActiveTool,
  n8nExecuteWorkflowTool,
] as const
