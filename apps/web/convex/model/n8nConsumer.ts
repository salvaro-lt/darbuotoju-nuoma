// Gavimas (ingest) consumer `n8n`: an inbox links to n8n webhook workflows
// (table n8nInboxLinks); every email received there is recorded in n8nDeliveries
// and POSTed to the workflow's webhook by `n8n:_forward` (convex/n8n.ts), which
// signs it and retries failures. Runs inside ingest's transaction: `deliver` only
// writes rows and schedules; the network call happens in the action.
//
// Ingest has no "failed" delivery outcome: the email shows `accepted`, and the
// consumer's `status()` reports pending / sent / failed from n8nDeliveries.
import { decide, isModuleEnabled, recordAudit, withOperation, forbidden, notFound, validation } from "@digimuza/system-core/convex"
import type { IngestConsumer, IngestDelivery, ReceivedEmail } from "@digimuza/system-core/ingest"
import { makeFunctionReference } from "convex/server"
import { N8N_MODULE_ID, N8nPermissions } from "../../modules/n8n"
import type { Doc, Id } from "../_generated/dataModel"
import { workflowHref } from "./n8nClient"

export const N8N_CONSUMER_ID = "n8n"

export const N8N_AUDIT = {
  inboxLink: "n8n.inbox.link",
  inboxUnlink: "n8n.inbox.unlink",
} as const

// Ingest hands consumers an untyped db (`any`); these are the n8n tables' shapes.
type Db = {
  query(table: string): {
    withIndex(name: string, range: (q: { eq(f: string, v: unknown): unknown }) => unknown): { first(): Promise<unknown>; take(n: number): Promise<unknown[]> }
    take(n: number): Promise<unknown[]>
  }
  insert(table: string, doc: object): Promise<string>
  patch(table: string, id: string, doc: object): Promise<void>
  delete(table: string, id: string): Promise<void>
  get(id: string): Promise<unknown>
  normalizeId(table: string, id: string): string | null
}
const asDb = (db: unknown) => db as Db

export async function cachedWorkflow(db: unknown, workflowId: string): Promise<Doc<"n8nWorkflows"> | null> {
  return (await asDb(db)
    .query("n8nWorkflows")
    .withIndex("by_workflowId", (q) => q.eq("workflowId", workflowId))
    .first()) as Doc<"n8nWorkflows"> | null
}

export async function inboxLinks(db: unknown, inboxId: string): Promise<Doc<"n8nInboxLinks">[]> {
  return (await asDb(db)
    .query("n8nInboxLinks")
    .withIndex("by_inbox", (q) => q.eq("inboxId", inboxId))
    .take(50)) as Doc<"n8nInboxLinks">[]
}

/** Inserts the link unless it exists. Returns whether it was new. */
export async function insertLink(db: unknown, inbox: { id: string; address: string }, workflowId: string, createdBy: string): Promise<boolean> {
  if ((await inboxLinks(db, inbox.id)).some((l) => l.workflowId === workflowId)) return false
  await asDb(db).insert("n8nInboxLinks", { inboxId: inbox.id, address: inbox.address, workflowId, createdAt: Date.now(), createdBy })
  return true
}

/** Only POST webhooks can receive the emails (`_forward` POSTs; n8n's default method is GET). */
const takesPost = (w: Doc<"n8nWorkflows">) => Boolean(w.webhookPath) && (w.webhookMethod ?? "GET").toUpperCase() === "POST"

const actorKey = (a: { kind: "user"; userId: string } | { kind: "agent"; apiKeyId: string }) => (a.kind === "user" ? a.userId : a.apiKeyId)

export interface N8nConsumerOptions {
  /** Module path (relative to `convex/`) of the n8n functions. Default "n8n". */
  functionsModule?: string
}

export function n8nIngestConsumer(options: N8nConsumerOptions = {}): IngestConsumer {
  const forward = makeFunctionReference<"action">(`${options.functionsModule ?? "n8n"}:_forward`)
  return {
    id: N8N_CONSUMER_ID,
    label: "n8n workflow",

    async linked(db, inbox) {
      const out = []
      for (const l of await inboxLinks(db, inbox.id)) {
        const w = await cachedWorkflow(db, l.workflowId)
        out.push({ consumer: N8N_CONSUMER_ID, id: l.workflowId, name: w?.name ?? l.workflowId, enabled: Boolean(w?.active && w.webhookPath), href: workflowHref(l.workflowId) })
      }
      return out
    },

    async candidates(db) {
      const rows = (await asDb(db).query("n8nWorkflows").take(500)) as Doc<"n8nWorkflows">[]
      return rows
        .filter(takesPost)
        .map((w) => ({ id: w.workflowId, name: w.name, enabled: w.active }))
        .sort((a, b) => a.name.localeCompare(b.name))
    },

    async link({ db, sys, actor }, refId, inbox, linked) {
      if (!(await decide(sys, actor, N8nPermissions.manage)).allowed) throw withOperation(sys, forbidden("n8n_manage_required"))
      if (linked) {
        const w = await cachedWorkflow(db, refId)
        if (!w) throw withOperation(sys, notFound("n8n_workflow_not_found"))
        if (!w.webhookPath) throw withOperation(sys, validation("n8n_workflow_has_no_webhook", ["refId"]))
        if (!takesPost(w)) throw withOperation(sys, validation("n8n_webhook_not_post", ["refId"]))
        if (!(await insertLink(db, inbox, refId, actorKey(actor)))) return
      } else {
        const rows = (await inboxLinks(db, inbox.id)).filter((l) => l.workflowId === refId)
        if (!rows.length) return
        for (const r of rows) await asDb(db).delete("n8nInboxLinks", r._id)
      }
      await recordAudit(sys, actor, {
        action: linked ? N8N_AUDIT.inboxLink : N8N_AUDIT.inboxUnlink,
        targetType: "n8n_workflow",
        targetId: refId,
        changes: { inboxId: inbox.id, address: inbox.address },
      })
    },

    async deliver({ db, sys, scheduler }, email: ReceivedEmail) {
      const links = await inboxLinks(db, email.inbox.id)
      if (!links.length) return []
      const moduleOn = isModuleEnabled(sys, await sys.store.get("modules", N8N_MODULE_ID))
      const out: IngestDelivery[] = []
      for (const l of links) {
        const at = Date.now()
        const w = await cachedWorkflow(db, l.workflowId)
        const base = { consumer: N8N_CONSUMER_ID, refId: l.workflowId, name: w?.name ?? l.workflowId, at }
        if (!moduleOn || !w || !w.active || !w.webhookPath) {
          out.push({ ...base, outcome: "skipped" })
          continue
        }
        const dup = (await asDb(db)
          .query("n8nDeliveries")
          .withIndex("by_email", (q) => (q.eq("emailId", email.emailId) as { eq(f: string, v: unknown): unknown }).eq("workflowId", l.workflowId))
          .first()) as Doc<"n8nDeliveries"> | null
        if (dup) {
          out.push({ ...base, runId: dup._id, outcome: "duplicate" })
          continue
        }
        const deliveryId = (await asDb(db).insert("n8nDeliveries", {
          emailId: email.emailId,
          resendEmailId: email.resendEmailId,
          workflowId: l.workflowId,
          status: "pending",
          attempts: 0,
          createdAt: at,
          updatedAt: at,
        })) as Id<"n8nDeliveries">
        await scheduler.runAfter(0, forward, { deliveryId })
        out.push({ ...base, runId: deliveryId, outcome: "accepted" })
      }
      return out
    },

    async status(db, deliveries) {
      return Promise.all(
        deliveries.map(async (d) => {
          if (d.consumer !== N8N_CONSUMER_ID) return { status: null, href: null }
          if (!d.runId) return { status: null, href: workflowHref(d.refId) }
          const id = asDb(db).normalizeId("n8nDeliveries", d.runId)
          const row = id ? ((await asDb(db).get(id)) as Doc<"n8nDeliveries"> | null) : null
          return { status: row?.status ?? null, href: workflowHref(d.refId, "/executions") }
        }),
      )
    },
  }
}
