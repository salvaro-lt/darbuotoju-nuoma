// Tool gateway: every assistant tool (convex/aiConfig.ts) for an agent key
// (`dsk_…`), used by n8n through /api/v1/mcp and /api/v1/tools/<tool>
// (lib/tool-gateway.ts).
//
// The key is resolved by system-core (`system.context`): an agent capped by its
// owner's current permissions; `humanOnly` permissions always deny it. Each call
// goes through `executeAiTool` (zod validation, `authorizeJob`, audit
// `ai.tool.run`). Approval is a chat-runner feature, so writes run directly here,
// within the key's permissions. Network-bound read tools finish in their
// `followUpAction`; queued writes (mail replies, n8n operations) are drained right
// after the call, best effort (the crons drain them anyway).
import { executeAiTool, type AiTool } from "@digimuza/system-core/ai"
import { decide, toActorRef, type ActorRef } from "@digimuza/system-core/convex"
import { makeFunctionReference } from "convex/server"
import { v } from "convex/values"
import { z } from "zod"
import type { Id } from "./_generated/dataModel"
import { action, internalMutation, query } from "./_generated/server"
import { aiOptions } from "./aiConfig"
import { system } from "./system"

/** Display-only tools: nothing to do outside the chat. */
const HIDDEN = new Set(["ai.show_card"])

/** MCP / OpenAI function names: `^[a-zA-Z0-9_-]{1,128}$`, so `staffing.list_workers` → `staffing_list_workers`. */
export const toolName = (id: string): string => id.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 128)

function allTools(): AiTool[] {
  const byId = new Map<string, AiTool>()
  for (const agent of aiOptions.agents) for (const tool of agent.tools as AiTool[]) if (!HIDDEN.has(tool.id) && !byId.has(tool.id)) byId.set(tool.id, tool)
  return [...byId.values()]
}

let index: Map<string, AiTool> | null = null
/** A tool by its id (`mail.reply_to_email`) or its exposed name (`mail_reply_to_email`). */
export function findTool(nameOrId: string): AiTool | undefined {
  if (!index) {
    index = new Map()
    for (const tool of allTools()) {
      index.set(tool.id, tool)
      index.set(toolName(tool.id), tool)
    }
  }
  return index.get(nameOrId.trim())
}

function withoutDollarKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutDollarKeys)
  if (!value || typeof value !== "object") return value
  return Object.fromEntries(
    Object.entries(value)
      .filter(([k]) => !k.startsWith("$"))
      .map(([k, val]) => [k, withoutDollarKeys(val)]),
  )
}

/** The tool's input as JSON schema (an object schema, as MCP requires). */
export function inputSchemaOf(tool: AiTool): Record<string, unknown> {
  let schema: Record<string, unknown> = {}
  try {
    schema = withoutDollarKeys(z.toJSONSchema(tool.input, { io: "input", unrepresentable: "any" })) as Record<string, unknown>
  } catch {
    schema = {}
  }
  if (schema.type !== "object") return { type: "object", properties: {}, additionalProperties: true }
  return schema
}

export interface GatewayTool {
  /** Exposed name (MCP / function-call safe). */
  name: string
  /** Assistant tool id. */
  id: string
  description: string
  inputSchema: Record<string, unknown>
  /** Changes data (an approval card in the assistant; runs directly here). */
  write: boolean
}

export type GatewayError = { ok: false; code: string; message: string }
export type ListToolsResult = { ok: true; tools: GatewayTool[] } | GatewayError
export type CallToolResult = { ok: true; result: unknown } | GatewayError

const unauthenticated: GatewayError = { ok: false, code: "UNAUTHENTICATED", message: "Invalid or revoked API key." }

async function agentFor(ctx: Parameters<typeof system.context>[0], apiKey: string) {
  try {
    const { sys, actor } = await system.context(ctx, { apiKey })
    return actor && actor.kind === "agent" ? { sys, actor } : null
  } catch {
    return null
  }
}

/** The tools this key may run right now. */
export const listTools = query({
  args: { apiKey: v.string() },
  handler: async (ctx, a): Promise<ListToolsResult> => {
    const agent = await agentFor(ctx, a.apiKey)
    if (!agent) return unauthenticated
    const tools: GatewayTool[] = []
    for (const tool of allTools()) {
      if (!(await decide(agent.sys, agent.actor, tool.permission)).allowed) continue
      tools.push({ name: toolName(tool.id), id: tool.id, description: tool.description, inputSchema: inputSchemaOf(tool), write: !!tool.requiresApproval })
    }
    return { ok: true, tools }
  },
})

type Executed = CallToolResult & { followUpAction?: string; actorRef?: ActorRef; operationId?: string }

/** Runs the tool's handler as the key's agent (validation, authorization, audit). */
export const _execute = internalMutation({
  // JSON: arguments may have field names Convex values reject (non-ASCII, `$…`), e.g. n8n node names.
  args: { apiKey: v.string(), tool: v.string(), argsJson: v.string(), toolCallId: v.string() },
  handler: async (ctx, a): Promise<Executed> => {
    const agent = await agentFor(ctx, a.apiKey)
    if (!agent) return unauthenticated
    const tool = findTool(a.tool)
    if (!tool) return { ok: false, code: "NOT_FOUND", message: `Unknown tool ${a.tool}.` }
    let args: unknown
    try {
      args = JSON.parse(a.argsJson)
    } catch {
      return { ok: false, code: "VALIDATION", message: "The arguments must be JSON." }
    }
    const actorRef = toActorRef(agent.actor)
    // The audit keeps only the toolCallId (not the arguments), so any field names are fine there.
    const res = await executeAiTool({ db: ctx.db, sys: agent.sys, actorRef, tool, args: args ?? {}, toolCallId: a.toolCallId })
    if (!res.ok) return { ok: false, code: res.code, message: res.message }
    return { ok: true, result: res.result ?? null, followUpAction: tool.followUpAction, actorRef, operationId: agent.sys.operationId }
  },
})

const executeRef = makeFunctionReference<"mutation", { apiKey: string; tool: string; argsJson: string; toolCallId: string }, Executed>("toolGateway:_execute")
const drainReplyRef = makeFunctionReference<"action", { outboxId: Id<"mailOutbox"> }, { sent: number; failed: number }>("replies:_drainOne")
// Built by the n8n module (convex/n8n.ts); a missing function is swallowed.
const drainN8nOpRef = makeFunctionReference<"action", { opId: string }, unknown>("n8n:_drainOne")

const isRecord = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x)
const ERROR_CODES = new Set(["NOT_FOUND", "VALIDATION", "FORBIDDEN", "CONFLICT", "UNAVAILABLE"])

/** Runs one tool for the key: handler → follow-up action → drains what it queued. */
export const callTool = action({
  /** The tool's arguments as JSON (an object); default `{}`. */
  args: { apiKey: v.string(), tool: v.string(), argsJson: v.optional(v.string()) },
  handler: async (ctx, a): Promise<CallToolResult> => {
    const toolCallId = `gw_${crypto.randomUUID()}`
    const res = await ctx.runMutation(executeRef, { apiKey: a.apiKey, tool: a.tool, argsJson: a.argsJson ?? "{}", toolCallId })
    if (!res.ok) return { ok: false, code: res.code, message: res.message }
    let result: unknown = res.result
    if (res.followUpAction) {
      try {
        const out = await ctx.runAction(makeFunctionReference<"action">(res.followUpAction), { input: result ?? null, actor: res.actorRef, operationId: res.operationId })
        result = out === undefined ? null : JSON.parse(JSON.stringify(out))
      } catch (e) {
        console.warn("tool_gateway_follow_up_failed", { tool: a.tool, errorName: e instanceof Error ? e.name : typeof e })
        return { ok: false, code: "UNAVAILABLE", message: "The tool failed." }
      }
      // Follow-up actions report failures as `{ error: <code>, reason }` (n8n:_toolRead).
      if (isRecord(result) && typeof result.error === "string" && ERROR_CODES.has(result.error)) {
        return { ok: false, code: result.error, message: typeof result.reason === "string" ? result.reason : result.error }
      }
    }
    if (isRecord(result) && typeof result.outboxId === "string") {
      try {
        const d = await ctx.runAction(drainReplyRef, { outboxId: result.outboxId as Id<"mailOutbox"> })
        if (d.sent > 0) result = { ...result, sent: true }
      } catch {
        // Stays queued: replies:_drain (cron) retries.
      }
    }
    if (isRecord(result) && typeof result.opId === "string") {
      try {
        await ctx.runAction(drainN8nOpRef, { opId: result.opId })
      } catch {
        // Not deployed yet, or failed: the n8n cron drains it.
      }
    }
    return { ok: true, result }
  },
})
