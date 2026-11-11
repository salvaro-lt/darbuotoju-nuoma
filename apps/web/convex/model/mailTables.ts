import { actorRefValidator } from "@digimuza/system-core/ai"
import { defineTable } from "convex/server"
import { v } from "convex/values"

export const MAIL_OUTBOX_STATUSES = ["queued", "sending", "sent", "failed"] as const

/**
 * Outgoing email replies (`mail.reply_to_email`). Tool handlers run inside a
 * mutation (no fetch), so they queue a row here; `replies:_drain` sends it.
 * Rows also back the per-recipient throttle (1 per 2 min, 3 per hour).
 */
export const mailTables = {
  mailOutbox: defineTable({
    /** Recipient, lowercase. */
    to: v.string(),
    subject: v.string(),
    text: v.string(),
    from: v.string(),
    replyTo: v.optional(v.string()),
    /** `<message-id>` of the email answered. */
    inReplyTo: v.optional(v.string()),
    references: v.optional(v.string()),
    emailId: v.optional(v.id("ingestEmails")),
    status: v.union(...MAIL_OUTBOX_STATUSES.map((s) => v.literal(s))),
    attempts: v.number(),
    /** Short reason of the last failure (never the provider's response body). */
    error: v.optional(v.string()),
    createdAt: v.number(),
    /** When the last send attempt started (status `sending`). */
    claimedAt: v.optional(v.number()),
    sentAt: v.optional(v.number()),
    /** Who queued it (system-core ActorRef); re-authorized when the drain sends it (a row without one is never sent). */
    actorRef: v.optional(actorRefValidator),
  })
    .index("by_to", ["to", "createdAt"])
    .index("by_status", ["status", "createdAt"]),
}
