// Tables of the app-only `n8n` module (modules/n8n.ts), spread into convex/schema.ts.
import { actorRefValidator } from "@digimuza/system-core/ai"
import { defineTable } from "convex/server"
import { v } from "convex/values"

export const N8N_OP_KINDS = ["create_workflow", "update_workflow", "set_active", "execute_workflow"] as const
export type N8nOpKind = (typeof N8N_OP_KINDS)[number]

export const n8nTables = {
  /** Cache of the n8n workflows tagged N8N_TAG (modules/n8n.ts; convex/n8n.ts `_syncWorkflows`, every 5 min and after each op). */
  n8nWorkflows: defineTable({
    workflowId: v.string(),
    name: v.string(),
    active: v.boolean(),
    tags: v.array(v.string()),
    /** Production path of the first Webhook trigger (`/webhook/<path>`), when the workflow has one. */
    webhookPath: v.optional(v.string()),
    webhookMethod: v.optional(v.string()),
    /** n8n's `updatedAt` (ms). */
    updatedAt: v.number(),
    syncedAt: v.number(),
  }).index("by_workflowId", ["workflowId"]),

  /** Gavimas inbox → n8n workflow: every email received there is POSTed to the workflow's webhook. */
  n8nInboxLinks: defineTable({
    inboxId: v.id("ingestInboxes"),
    address: v.string(),
    workflowId: v.string(),
    createdAt: v.number(),
    /** User / API key id, or "system". */
    createdBy: v.string(),
  })
    .index("by_inbox", ["inboxId"])
    .index("by_address", ["address"])
    .index("by_workflow", ["workflowId"]),

  /** One received email handed to one workflow (`runId` of the ingest delivery). */
  n8nDeliveries: defineTable({
    emailId: v.id("ingestEmails"),
    resendEmailId: v.string(),
    workflowId: v.string(),
    status: v.union(v.literal("pending"), v.literal("sent"), v.literal("failed")),
    attempts: v.number(),
    httpStatus: v.optional(v.number()),
    error: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_email", ["emailId", "workflowId"])
    .index("by_status", ["status"]),

  /** Outbox of approved n8n writes from the assistant (tool handlers cannot fetch); drained by `n8n:_drain`. */
  n8nOps: defineTable({
    kind: v.union(...N8N_OP_KINDS.map((k) => v.literal(k))),
    /** The tool's validated arguments as a JSON string (n8n field names may not be valid Convex field names). */
    args: v.string(),
    status: v.union(v.literal("pending"), v.literal("running"), v.literal("done"), v.literal("failed")),
    result: v.optional(v.any()),
    error: v.optional(v.string()),
    /** Who asked (system-core ActorRef); re-authorized when the drain runs the op. */
    actorRef: actorRefValidator,
    attempts: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_status", ["status"]),
}
