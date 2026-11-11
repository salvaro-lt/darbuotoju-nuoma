// The app-only n8n module's functions (modules/n8n.ts). Names are referenced by
// string (`makeFunctionReference("n8n:_forward")`, crons, followUpAction), so
// keep them stable.
//
//   _forward          email → n8n webhook (signed, retried 1/4/16 min, 4 attempts)
//   _syncWorkflows    tagged n8n workflows → n8nWorkflows cache (cron every 5 min, after each op)
//   _drain/_drainOne  approved assistant writes (n8nOps outbox) → n8n REST / MCP (cron every 10 s)
//   _toolRead         follow-up action of the read-only n8n.* assistant tools
//   _linkInbox        operator: link an inbox (by address) to a workflow (scripts/n8n-setup.ts --link)
//   listWorkflowsCached  UI: cached workflows (n8n:workflow:view)
import { actorRefValidator } from "@digimuza/system-core/ai"
import { authorizeJob, SystemError, toSystemError } from "@digimuza/system-core/convex"
import { canonicalAddress, RESEND_API, resendApiKey } from "@digimuza/system-core/ingest"
import { makeFunctionReference } from "convex/server"
import { v } from "convex/values"
import { N8nPermissions } from "../modules/n8n"
import type { Doc, Id } from "./_generated/dataModel"
import { internalAction, internalMutation, internalQuery, query, type ActionCtx } from "./_generated/server"
import { createN8nClient, isolatedNodes, n8nClientFromEnv, n8nConfig, WEBHOOK_NODE, webhookOf, workflowHref, type N8nClient, type N8nWorkflow } from "./model/n8nClient"
import { cachedWorkflow, insertLink } from "./model/n8nConsumer"
import { system } from "./system"

/** A failed forward is tried this many times in all, after 1, 4 and 16 minutes. */
export const FORWARD_MAX_ATTEMPTS = 4
const RETRY_MS = 60_000
/** An op still `running` after this long died mid-way: failed, never re-run (it may have half-applied). */
const OP_STALE_MS = 10 * 60_000
const DRAIN_BATCH = 10
const MAX_TEXT = 200_000
const MAX_HTML = 200_000

// By name, so this file does not depend on a regenerated `_generated/api` (and crons / consumers can use the same refs).
const ref = {
  forward: makeFunctionReference<"action", { deliveryId: Id<"n8nDeliveries"> }>("n8n:_forward"),
  deliveryContext: makeFunctionReference<"query", { deliveryId: Id<"n8nDeliveries"> }, DeliveryContext | null>("n8n:_deliveryContext"),
  recordForward: makeFunctionReference<"mutation", RecordForwardArgs>("n8n:_recordForward"),
  applySync: makeFunctionReference<"mutation", { workflows: CachedWorkflow[] }, { upserted: number; removed: number }>("n8n:_applySync"),
  takeOps: makeFunctionReference<"mutation", { opId?: Id<"n8nOps">; limit: number }, Doc<"n8nOps">[]>("n8n:_takeOps"),
  finishOp: makeFunctionReference<"mutation", { opId: Id<"n8nOps">; ok: boolean; result?: unknown; error?: string }>("n8n:_finishOp"),
  getOp: makeFunctionReference<"query", { opId: Id<"n8nOps"> }, Doc<"n8nOps"> | null>("n8n:_getOp"),
  cached: makeFunctionReference<"query", Record<string, never>, Doc<"n8nWorkflows">[]>("n8n:_cachedWorkflows"),
  insertInboxLink: makeFunctionReference<"mutation", { address: string; workflowId: string }, LinkResult>("n8n:_insertInboxLink"),
  syncWorkflows: makeFunctionReference<"action", Record<string, never>, SyncResult>("n8n:_syncWorkflows"),
}

/**
 * Convex values allow only non-empty, printable-ASCII field names that do not start
 * with "$". n8n data does not follow that (connections are keyed by node names such
 * as "Laiškas iš Gavimo"), so such values travel as JSON strings.
 */
export function convexSafe(x: unknown): boolean {
  if (Array.isArray(x)) return x.every(convexSafe)
  if (x && typeof x === "object") return Object.entries(x).every(([k, v]) => /^[\x20-\x7e]+$/.test(k) && !k.startsWith("$") && convexSafe(v))
  return true
}
export const asConvexValue = (x: unknown): unknown => (convexSafe(x) ? JSON.parse(JSON.stringify(x ?? null)) : { resultJson: JSON.stringify(x ?? null) })

const errorReason = (e: unknown) => {
  const se = toSystemError(e)
  return se ? (se.reason ?? se.code) : "unexpected_error"
}

/* ---------- Email → n8n webhook ---------- */

interface DeliveryContext {
  delivery: Doc<"n8nDeliveries">
  email: Doc<"ingestEmails">
  inbox: { address: string; name: string }
  workflow: { workflowId: string; name: string; active: boolean; webhookPath: string | null } | null
}

export const _deliveryContext = internalQuery({
  args: { deliveryId: v.id("n8nDeliveries") },
  handler: async (ctx, a): Promise<DeliveryContext | null> => {
    const delivery = await ctx.db.get(a.deliveryId)
    if (!delivery) return null
    const email = await ctx.db.get(delivery.emailId)
    if (!email) return null
    const inbox = await ctx.db.get(email.inboxId)
    const w = await cachedWorkflow(ctx.db, delivery.workflowId)
    return {
      delivery,
      email,
      inbox: { address: inbox?.address ?? email.to[0] ?? "", name: inbox?.name ?? "" },
      workflow: w ? { workflowId: w.workflowId, name: w.name, active: w.active, webhookPath: w.webhookPath ?? null } : null,
    }
  },
})

type RecordForwardArgs = { deliveryId: Id<"n8nDeliveries">; status: "pending" | "sent" | "failed"; attempts: number; httpStatus?: number; error?: string }

export const _recordForward = internalMutation({
  args: {
    deliveryId: v.id("n8nDeliveries"),
    status: v.union(v.literal("pending"), v.literal("sent"), v.literal("failed")),
    attempts: v.number(),
    httpStatus: v.optional(v.number()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    await ctx.db.patch(a.deliveryId, { status: a.status, attempts: a.attempts, httpStatus: a.httpStatus, error: a.error, updatedAt: Date.now() })
  },
})

/** Attachment download links Resend issued for a received email. Best effort: none on any failure. */
async function attachmentUrls(resendEmailId: string): Promise<{ id?: string; filename?: string; url: string }[]> {
  const key = resendApiKey()
  if (!key) return []
  try {
    const res = await fetch(`${RESEND_API}/emails/receiving/${encodeURIComponent(resendEmailId)}/attachments?limit=100`, { headers: { Authorization: `Bearer ${key}` } })
    if (!res.ok) return []
    const body = (await res.json()) as { data?: { id?: string; filename?: string; download_url?: string }[] }
    return (body.data ?? []).flatMap((x) => (x.download_url ? [{ ...(x.id ? { id: x.id } : {}), ...(x.filename ? { filename: x.filename } : {}), url: x.download_url }] : []))
  } catch {
    return []
  }
}

/** The JSON n8n receives for one email (`event: email.received`). */
export async function webhookBody(c: DeliveryContext): Promise<string> {
  const { email, delivery } = c
  const links = email.attachments.length ? await attachmentUrls(email.resendEmailId) : []
  return JSON.stringify({
    event: "email.received",
    deliveryId: delivery._id,
    email: {
      id: email._id,
      resendEmailId: email.resendEmailId,
      inbox: { address: c.inbox.address, name: c.inbox.name },
      from: email.from,
      fromName: email.fromName ?? null,
      to: email.to,
      subject: email.subject,
      text: (email.text ?? "").slice(0, MAX_TEXT),
      html: email.html ? email.html.slice(0, MAX_HTML) : null,
      messageId: email.messageId ?? null,
      receivedAt: new Date(email.receivedAt).toISOString(),
      attachments: email.attachments.map((x) => {
        const hit = links.find((l) => (x.id && l.id === x.id) || (!x.id && l.filename === x.name))
        return { name: x.name, type: x.type ?? null, size: x.size ?? null, ...(hit ? { url: hit.url } : {}) }
      }),
    },
  })
}

/** Every public function accepts these (agents pass `apiKey`). */
const actorArgs = { apiKey: v.optional(v.string()), operationId: v.optional(v.string()) }

/** `sha256=<hex HMAC-SHA256(secret, body)>`. */
export async function signBody(secret: string, body: string): Promise<string> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"])
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(body)))
  return `sha256=${[...mac].map((b) => b.toString(16).padStart(2, "0")).join("")}`
}

/**
 * POSTs one delivery to its workflow's production webhook. 2xx → sent; else retried with backoff, then failed.
 * Headers: `X-Webhook-Secret` (N8N_WEBHOOK_SECRET; the same header auth as the mail workflows of
 * n8n/deploy.py), `X-Webhook-Signature` (HMAC of the body) and `X-Webhook-Delivery`.
 */
export const _forward = internalAction({
  args: { deliveryId: v.id("n8nDeliveries") },
  handler: async (ctx, a): Promise<{ status: "sent" | "pending" | "failed" | "gone" }> => {
    const c = await ctx.runQuery(ref.deliveryContext, a)
    if (!c || c.delivery.status !== "pending") return { status: "gone" }
    const attempts = c.delivery.attempts + 1
    const record = async (status: "sent" | "pending" | "failed", extra: { httpStatus?: number; error?: string } = {}) => {
      await ctx.runMutation(ref.recordForward, { deliveryId: a.deliveryId, status, attempts, ...extra })
      return { status }
    }
    // Nothing to retry for: the workflow is gone, inactive or lost its webhook.
    if (!c.workflow || !c.workflow.active || !c.workflow.webhookPath) return record("failed", { error: c.workflow ? "workflow_inactive_or_no_webhook" : "workflow_not_found" })

    const base = process.env.N8N_URL?.replace(/\/+$/, "")
    const secret = process.env.N8N_WEBHOOK_SECRET
    let httpStatus: number | undefined
    let error: string | undefined
    if (!base || !secret) error = "n8n_not_configured"
    else {
      const body = await webhookBody(c)
      try {
        const res = await fetch(`${base}/webhook/${c.workflow.webhookPath.split("/").map(encodeURIComponent).join("/")}`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "X-Webhook-Secret": secret,
            "X-Webhook-Signature": await signBody(secret, body),
            "X-Webhook-Delivery": a.deliveryId,
          },
          body,
          signal: AbortSignal.timeout(30_000),
        })
        httpStatus = res.status
        // The body is never stored: it may echo request data.
        await res.body?.cancel().catch(() => undefined)
        if (res.ok) return record("sent", { httpStatus })
        error = `http_${res.status}`
      } catch {
        error = "unreachable"
      }
    }
    const extra = { ...(httpStatus !== undefined ? { httpStatus } : {}), ...(error ? { error } : {}) }
    if (attempts >= FORWARD_MAX_ATTEMPTS) {
      console.error(`n8n: delivery ${a.deliveryId} failed after ${attempts} attempts (${error})`)
      return record("failed", extra)
    }
    await ctx.scheduler.runAfter(RETRY_MS * 4 ** (attempts - 1), ref.forward, a)
    return record("pending", extra)
  },
})

/* ---------- Workflow cache ---------- */

const cachedValidator = v.object({
  workflowId: v.string(),
  name: v.string(),
  active: v.boolean(),
  tags: v.array(v.string()),
  webhookPath: v.optional(v.string()),
  webhookMethod: v.optional(v.string()),
  updatedAt: v.number(),
})
type CachedWorkflow = { workflowId: string; name: string; active: boolean; tags: string[]; webhookPath?: string; webhookMethod?: string; updatedAt: number }
type SyncResult = { skipped?: string; upserted: number; removed: number; error?: string }

export const toCached = (w: N8nWorkflow): CachedWorkflow => {
  const hook = webhookOf(w)
  const updated = w.updatedAt ? Date.parse(w.updatedAt) : NaN
  return {
    workflowId: w.id,
    name: w.name,
    active: Boolean(w.active),
    tags: (w.tags ?? []).map((t) => t.name),
    ...(hook ? { webhookPath: hook.path, webhookMethod: hook.method } : {}),
    updatedAt: Number.isFinite(updated) ? updated : 0,
  }
}

/** Replaces the cache with `workflows` (the full tagged list). */
export const _applySync = internalMutation({
  args: { workflows: v.array(cachedValidator) },
  handler: async (ctx, a) => {
    const now = Date.now()
    const rows = await ctx.db.query("n8nWorkflows").take(1000)
    const seen = new Set<string>()
    let upserted = 0
    for (const w of a.workflows) {
      seen.add(w.workflowId)
      const row = rows.find((r) => r.workflowId === w.workflowId)
      const doc = { ...w, webhookPath: w.webhookPath, webhookMethod: w.webhookMethod, syncedAt: now }
      if (row) await ctx.db.patch(row._id, doc)
      else await ctx.db.insert("n8nWorkflows", doc)
      upserted++
    }
    let removed = 0
    for (const r of rows)
      if (!seen.has(r.workflowId)) {
        await ctx.db.delete(r._id)
        removed++
      }
    return { upserted, removed }
  },
})

async function syncWith(ctx: Pick<ActionCtx, "runMutation">, client: N8nClient): Promise<SyncResult> {
  const workflows = await client.listAllWorkflows()
  return ctx.runMutation(ref.applySync, { workflows: workflows.map(toCached) })
}

/** Lists the tagged workflows and refreshes the cache (stale rows removed). Never throws. */
export const _syncWorkflows = internalAction({
  args: {},
  handler: async (ctx): Promise<SyncResult> => {
    const cfg = n8nConfig()
    if (!cfg) return { skipped: "n8n_not_configured", upserted: 0, removed: 0 }
    try {
      return await syncWith(ctx, createN8nClient(cfg))
    } catch (e) {
      console.warn(`n8n: workflow sync failed (${errorReason(e)})`)
      return { upserted: 0, removed: 0, error: errorReason(e) }
    }
  },
})

export const _cachedWorkflows = internalQuery({
  args: {},
  handler: async (ctx) => ctx.db.query("n8nWorkflows").take(500),
})

/** Cached n8n workflows (tag N8N_TAG) for the UI. */
export const listWorkflowsCached = query({
  args: { ...actorArgs },
  handler: async (ctx, a) => {
    await system.requirePermission(ctx, N8nPermissions.view, { apiKey: a.apiKey, operationId: a.operationId })
    const rows = await ctx.db.query("n8nWorkflows").take(500)
    return rows
      .map((w) => ({ workflowId: w.workflowId, name: w.name, active: w.active, webhookPath: w.webhookPath ?? null, href: workflowHref(w.workflowId), syncedAt: w.syncedAt }))
      .sort((x, y) => x.name.localeCompare(y.name))
  },
})

/* ---------- Ops outbox (approved assistant writes) ---------- */

/**
 * Marks pending ops running and returns them. Ops left `running` too long are failed (they may have half-applied).
 * Each op's actor is re-authorized first (key revoked, permission lost → failed `not_authorized`, never run).
 */
export const _takeOps = internalMutation({
  args: { opId: v.optional(v.id("n8nOps")), limit: v.number() },
  handler: async (ctx, a): Promise<Doc<"n8nOps">[]> => {
    const now = Date.now()
    const { sys } = await system.context(ctx)
    for (const r of await ctx.db
      .query("n8nOps")
      .withIndex("by_status", (q) => q.eq("status", "running"))
      .take(50))
      if (now - r.updatedAt > OP_STALE_MS) await ctx.db.patch(r._id, { status: "failed", error: "interrupted", updatedAt: now })
    const ops = a.opId
      ? [await ctx.db.get(a.opId)].filter((o): o is Doc<"n8nOps"> => o?.status === "pending")
      : await ctx.db
          .query("n8nOps")
          .withIndex("by_status", (q) => q.eq("status", "pending"))
          .take(a.limit)
    const out: Doc<"n8nOps">[] = []
    for (const op of ops) {
      if (!(await authorizeJob(sys, op.actorRef, N8nPermissions.manage))) {
        await ctx.db.patch(op._id, { status: "failed", error: "not_authorized", updatedAt: now })
        continue
      }
      const patch = { status: "running" as const, attempts: op.attempts + 1, updatedAt: now }
      await ctx.db.patch(op._id, patch)
      out.push({ ...op, ...patch })
    }
    return out
  },
})

export const _finishOp = internalMutation({
  args: { opId: v.id("n8nOps"), ok: v.boolean(), result: v.optional(v.any()), error: v.optional(v.string()) },
  handler: async (ctx, a) => {
    await ctx.db.patch(a.opId, a.ok ? { status: "done", result: a.result ?? null, error: undefined, updatedAt: Date.now() } : { status: "failed", error: a.error ?? "failed", updatedAt: Date.now() })
  },
})

export const _getOp = internalQuery({
  args: { opId: v.id("n8nOps") },
  handler: async (ctx, a) => ctx.db.get(a.opId),
})

const workflowView = (w: N8nWorkflow) => ({ workflowId: w.id, name: w.name, active: Boolean(w.active), url: workflowHref(w.id) })

/** A short, JSON-safe view of an MCP `execute_workflow` result. */
function executionView(res: unknown) {
  const r = (res ?? {}) as Record<string, unknown>
  const pick = (k: string) => (typeof r[k] === "string" || typeof r[k] === "number" || typeof r[k] === "boolean" ? r[k] : undefined)
  const json = JSON.stringify(res ?? null)
  return {
    executionId: pick("executionId") ?? null,
    status: pick("status") ?? (typeof r.success === "boolean" ? (r.success ? "success" : "error") : null),
    ...(r.error ? { error: String(typeof r.error === "object" ? JSON.stringify(r.error) : r.error).slice(0, 500) } : {}),
    output: json.length > 4000 ? `${json.slice(0, 4000)}…` : json,
  }
}

/** Webhook nodes need a stable `webhookId` (n8n registers the production URL by it). */
const withWebhookIds = (nodes: unknown) =>
  Array.isArray(nodes) ? nodes.map((n: { type?: string; webhookId?: string }) => (n?.type === WEBHOOK_NODE && !n.webhookId ? { ...n, webhookId: crypto.randomUUID() } : n)) : nodes

export async function executeOp(client: N8nClient, op: Pick<Doc<"n8nOps">, "kind" | "args">): Promise<unknown> {
  // Stored as JSON (see convexSafe). Tag isolation again before sending (the handler checked it too); the client drops unsafe settings.
  const raw = JSON.parse(op.args) as Record<string, unknown>
  const a = raw.nodes ? { ...raw, nodes: withWebhookIds(isolatedNodes(Array.isArray(raw.nodes) ? raw.nodes : [])) } : raw
  const id = String(a.workflowId ?? "")
  switch (op.kind) {
    case "create_workflow": {
      const created = await client.createWorkflow(a as never)
      return workflowView(a.activate ? await client.activate(created.id) : created)
    }
    case "update_workflow": {
      const { workflowId: _id, ...patch } = a
      return workflowView(await client.updateWorkflow(id, patch as never))
    }
    case "set_active":
      return workflowView(a.active ? await client.activate(id) : await client.deactivate(id))
    case "execute_workflow":
      return { workflowId: id, url: workflowHref(id, "/executions"), ...executionView(await client.executeWorkflow(id, a.inputs)) }
  }
}

/** Takes pending ops (all, or one), runs them against n8n, records the outcome, refreshes the cache. */
async function runOps(ctx: ActionCtx, opId?: Id<"n8nOps">): Promise<number> {
  const ops = await ctx.runMutation(ref.takeOps, { ...(opId ? { opId } : {}), limit: DRAIN_BATCH })
  if (!ops.length) return 0
  let client: N8nClient | null = null
  try {
    client = n8nClientFromEnv()
  } catch {
    client = null
  }
  for (const op of ops) {
    if (!client) {
      await ctx.runMutation(ref.finishOp, { opId: op._id, ok: false, error: "n8n_not_configured" })
      continue
    }
    try {
      const result = await executeOp(client, op)
      await ctx.runMutation(ref.finishOp, { opId: op._id, ok: true, result: asConvexValue(result) })
    } catch (e) {
      await ctx.runMutation(ref.finishOp, { opId: op._id, ok: false, error: errorReason(e) })
    }
  }
  if (client) await syncWith(ctx, client).catch((e) => console.warn(`n8n: workflow sync failed (${errorReason(e)})`))
  return ops.length
}

/** Cron: drains the outbox (≤ 10 ops per run). */
export const _drain = internalAction({
  args: {},
  handler: async (ctx): Promise<{ ran: number }> => ({ ran: await runOps(ctx) }),
})

/** Runs one op now if it is still pending. */
export const _drainOne = internalAction({
  args: { opId: v.id("n8nOps") },
  handler: async (ctx, a): Promise<{ ran: number }> => ({ ran: await runOps(ctx, a.opId) }),
})

const opView = (op: Doc<"n8nOps">) => ({
  opId: op._id,
  kind: op.kind,
  status: op.status,
  ...(op.result !== undefined ? { result: op.result } : {}),
  ...(op.error ? { error: op.error } : {}),
  attempts: op.attempts,
  createdAt: new Date(op.createdAt).toISOString(),
})

/* ---------- Read-only assistant tools (follow-up action) ---------- */

type ToolReadInput =
  | { kind: "search_workflows"; query?: string; active?: boolean }
  | { kind: "get_workflow"; workflowId: string }
  | { kind: "list_executions"; workflowId: string; limit: number }
  | { kind: "get_operation"; opId: Id<"n8nOps"> }

/** Node summary for the model: enough to understand and edit the workflow. */
const nodeView = (n: N8nWorkflow["nodes"][number]) => ({
  name: n.name,
  type: n.type,
  typeVersion: n.typeVersion,
  position: n.position,
  ...(n.disabled ? { disabled: true } : {}),
  ...(n.webhookId ? { webhookId: n.webhookId } : {}),
  parameters: n.parameters,
  // Credential names and ids only (never data).
  ...(n.credentials ? { credentials: n.credentials } : {}),
})

async function toolRead(ctx: ActionCtx, input: ToolReadInput): Promise<unknown> {
  if (input.kind === "get_operation") {
    let op = await ctx.runQuery(ref.getOp, { opId: input.opId })
    if (op?.status === "pending") {
      await runOps(ctx, input.opId)
      op = await ctx.runQuery(ref.getOp, { opId: input.opId })
    }
    if (!op) throw new SystemError("NOT_FOUND", undefined, { reason: "n8n_op_not_found" })
    return opView(op)
  }
  const client = n8nClientFromEnv()
  switch (input.kind) {
    case "search_workflows": {
      const q = input.query?.trim().toLowerCase()
      const list = (await client.listAllWorkflows())
        .filter((w) => (input.active === undefined || Boolean(w.active) === input.active) && (!q || w.name.toLowerCase().includes(q)))
        .slice(0, 50)
      return {
        workflows: list.map((w) => {
          const hook = webhookOf(w)
          return { ...workflowView(w), tags: (w.tags ?? []).map((t) => t.name), webhook: hook, nodes: w.nodes.length, updatedAt: w.updatedAt ?? null }
        }),
      }
    }
    case "get_workflow": {
      const w = await client.getWorkflow(input.workflowId)
      const details = await client.workflowDetails(w.id).catch(() => ({ triggerInfo: null }))
      return {
        ...workflowView(w),
        tags: (w.tags ?? []).map((t) => t.name),
        settings: w.settings ?? {},
        nodes: w.nodes.map(nodeView),
        // Keyed by node names (often non-ASCII): a JSON string. Pass it back parsed as `connections` to n8n.update_workflow.
        connectionsJson: JSON.stringify(w.connections ?? {}),
        triggerInfo: details.triggerInfo,
      }
    }
    case "list_executions": {
      const list = await client.listExecutions({ workflowId: input.workflowId, limit: input.limit })
      return {
        executionsUrl: workflowHref(input.workflowId, "/executions"),
        executions: list.map((e) => ({ id: e.id, status: e.status, mode: e.mode, finished: e.finished, startedAt: e.startedAt, stoppedAt: e.stoppedAt })),
      }
    }
  }
}

/** Finishes a read-only n8n.* tool call (the handler authorized and prepared `input`). Errors come back as `{ error }`. */
export const _toolRead = internalAction({
  args: { input: v.any(), actor: actorRefValidator, operationId: v.string() },
  handler: async (ctx, a): Promise<unknown> => {
    try {
      return asConvexValue(await toolRead(ctx, a.input as ToolReadInput))
    } catch (e) {
      const se = toSystemError(e)
      return { error: se?.code ?? "UNAVAILABLE", reason: se?.reason ?? "n8n_failed", ...(se?.fields ? { fields: se.fields } : {}) }
    }
  },
})

/* ---------- Operator: link an inbox (scripts/n8n-setup.ts --link) ---------- */

type LinkResult = { inboxId: string; address: string; workflowId: string; linked: boolean; created: boolean }

/** Links the inbox at `address` to a cached workflow. Idempotent. NOT_FOUND when the inbox or the cached workflow is missing. */
export const _insertInboxLink = internalMutation({
  args: { address: v.string(), workflowId: v.string() },
  handler: async (ctx, a): Promise<LinkResult> => {
    const address = canonicalAddress(a.address.trim())
    const inbox = await ctx.db
      .query("ingestInboxes")
      .withIndex("by_address", (q) => q.eq("address", address).eq("deleted", false))
      .first()
    if (!inbox) throw new SystemError("NOT_FOUND", "inbox_not_found", { reason: "inbox_not_found" })
    const w = await cachedWorkflow(ctx.db, a.workflowId)
    if (!w) throw new SystemError("NOT_FOUND", "n8n_workflow_not_cached", { reason: "n8n_workflow_not_cached" })
    const created = await insertLink(ctx.db, { id: inbox._id, address: inbox.address }, a.workflowId, "system")
    return { inboxId: inbox._id, address: inbox.address, workflowId: a.workflowId, linked: true, created }
  },
})

async function linkInbox(ctx: ActionCtx, a: { address: string; workflowId: string }): Promise<LinkResult> {
  const cached = await ctx.runQuery(ref.cached, {})
  if (!cached.some((w) => w.workflowId === a.workflowId)) await ctx.runAction(ref.syncWorkflows, {})
  return ctx.runMutation(ref.insertInboxLink, a)
}

/**
 * `npx convex run n8n:_linkInbox '{"address":"laiskai@…","workflowId":"…"}'`:
 * refreshes the workflow cache first when the workflow is not cached yet, then links.
 */
export const _linkInbox = internalAction({
  args: { address: v.string(), workflowId: v.string() },
  handler: (ctx, a): Promise<LinkResult> => linkInbox(ctx, a),
})
