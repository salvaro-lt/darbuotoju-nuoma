// Gavimas (ingest) consumer of the purchase invoice queue: a Gavimas inbox
// (e.g. saskaitos@…, where the director's mail rule forwards supplier mail)
// linked to "Pirkimo sąskaitos" hands every received e-mail to the queue.
// Known suppliers' invoices wait for the director's approval; other senders
// wait for review. Runs inside ingest's transaction (no network calls).
import { decide, isModuleEnabled, recordAudit, withOperation, forbidden } from "@digimuza/system-core/convex"
import type { IngestConsumer, IngestDelivery, ReceivedEmail } from "@digimuza/system-core/ingest"
import type { GenericDatabaseWriter } from "convex/server"
import { STAFFING_MODULE_ID } from "../manifest"
import { STAFFING_INVOICING_MODULE_ID, StaffingInvoicingPermissions as P } from "./manifest"
import type { InvoicingDataModel } from "./operations"
import { queuePurchaseEmail } from "./purchases"

export const PURCHASES_CONSUMER_ID = "staffing-invoicing-purchases"
const REF_ID = "purchases"
const REF_NAME = "Pirkimo sąskaitos"

const asDb = (db: unknown) => db as GenericDatabaseWriter<InvoicingDataModel>

async function linksOf(db: unknown, inboxId: string) {
  return asDb(db)
    .query("staffing_invoicing_purchaseInboxes")
    .withIndex("by_inbox", (q) => q.eq("inboxId", inboxId))
    .collect()
}

const actorKey = (a: { kind: "user"; userId: string } | { kind: "agent"; apiKeyId: string }) => (a.kind === "user" ? a.userId : a.apiKeyId)

/** Spread into the app's `ingestConsumers` (convex/automationsConfig.ts). */
export function purchasesIngestConsumer(options: { href?: string } = {}): IngestConsumer {
  const href = options.href ?? "/app/invoicing/purchases"
  return {
    id: PURCHASES_CONSUMER_ID,
    label: REF_NAME,

    async linked(db, inbox) {
      return (await linksOf(db, inbox.id)).length ? [{ consumer: PURCHASES_CONSUMER_ID, id: REF_ID, name: REF_NAME, enabled: true, href }] : []
    },

    async candidates() {
      return [{ id: REF_ID, name: REF_NAME, enabled: true }]
    },

    async link({ db, sys, actor }, _refId, inbox, linked) {
      if (!(await decide(sys, actor, P.costManage)).allowed) throw withOperation(sys, forbidden("purchases_manage_required"))
      const rows = await linksOf(db, inbox.id)
      if (linked && rows.length) return
      if (!linked && !rows.length) return
      if (linked) await asDb(db).insert("staffing_invoicing_purchaseInboxes", { inboxId: inbox.id, address: inbox.address, createdBy: actorKey(actor), createdAt: Date.now() })
      else for (const r of rows) await asDb(db).delete("staffing_invoicing_purchaseInboxes", r._id)
      await recordAudit(sys, actor, { action: linked ? "staffing-invoicing.purchase_inbox.link" : "staffing-invoicing.purchase_inbox.unlink", targetType: "ingest_inbox", targetId: inbox.id, changes: { address: inbox.address } })
    },

    async deliver({ db, sys }, email: ReceivedEmail) {
      if (!(await linksOf(db, email.inbox.id)).length) return []
      const at = Date.now()
      const base = { consumer: PURCHASES_CONSUMER_ID, refId: REF_ID, name: REF_NAME, at }
      for (const m of [STAFFING_MODULE_ID, STAFFING_INVOICING_MODULE_ID]) if (!isModuleEnabled(sys, await sys.store.get("modules", m))) return [{ ...base, outcome: "skipped" } satisfies IngestDelivery]
      const queued = await queuePurchaseEmail(asDb(db), {
        emailId: email.emailId,
        from: email.from,
        ...(email.fromName ? { fromName: email.fromName } : {}),
        subject: email.subject,
        text: email.text,
        attachmentNames: email.attachments.filter((x) => !x.inline).map((x) => x.name),
        receivedAt: email.receivedAt,
      })
      return [{ ...base, ...(queued ? { runId: queued.id } : {}), outcome: queued ? "accepted" : "duplicate" } satisfies IngestDelivery]
    },

    async status(db, deliveries) {
      return Promise.all(
        deliveries.map(async (d) => {
          if (d.consumer !== PURCHASES_CONSUMER_ID || !d.runId) return { status: null, href: null }
          const id = asDb(db).normalizeId("staffing_invoicing_purchases", d.runId)
          const row = id ? await asDb(db).get("staffing_invoicing_purchases", id) : null
          return { status: row?.status ?? null, href }
        }),
      )
    },
  }
}
