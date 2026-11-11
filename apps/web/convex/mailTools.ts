// `mail.reply_to_email`: answer a received email (Gavimas) in the same thread.
//
// Tool handlers run inside a mutation (no fetch), so the handler only checks and
// queues a `mailOutbox` row; `replies:_drain` sends it (cron every 10 s, and the
// tool gateway right after the call). For the assistant the tool needs approval;
// the n8n gateway (convex/toolGateway.ts) runs it directly.
//
// Permission: `ingest:inbox:manage` (Gavimas), the people who run the inboxes.
import { defineAiTool } from "@digimuza/system-core/ai"
import { SystemError, toActorRef, toConvexError, type ActorRef, type ErrorCode } from "@digimuza/system-core/convex"
import { IngestPermissions } from "@digimuza/system-core/ingest"
import { z } from "zod"
import { getConvexEnv } from "../env"
import type { Doc, Id } from "./_generated/dataModel"
import type { MutationCtx, QueryCtx } from "./_generated/server"

/** Throws a client-safe error with a stable code. */
function fail(code: ErrorCode, reason: string, operationId: string): never {
  throw toConvexError(new SystemError(code, undefined, { reason, operationId }), operationId)
}

const MINUTE = 60_000
/** Per recipient: at most 1 reply per 2 minutes and 3 per hour. */
export const REPLY_LIMITS = { shortMs: 2 * MINUTE, shortMax: 1, longMs: 60 * MINUTE, longMax: 3 } as const

/** Automatic senders: never answer them (mail loops). */
const AUTOMATIC_SENDER = /(^|[._+-])(no-?reply|do-?not-?reply|mailer-daemon|postmaster|bounce[s]?|notifications?)([._+-]|@)/i
/** Automatic replies and bounces, by subject. */
const AUTOMATIC_SUBJECT = /^(auto(matic)?[ -]?reply|automatinis atsakymas|out of office|neb[uū]siu|undeliver|delivery status|mail delivery)/i

/** `Name <a@b.lt>` or `a@b.lt` → `a@b.lt` (lowercase). */
export function bareAddress(raw: string): string {
  const m = /<([^<>\s]+@[^<>\s]+)>/.exec(raw)
  return (m?.[1] ?? raw).trim().toLowerCase()
}

/** `Re: <subject>`, without stacking `Re:` / `Ats:` prefixes. */
export function replySubject(subject: string): string {
  const s = subject.trim()
  if (/^(re|ats|aw|sv)\s*:/i.test(s)) return s
  return s ? `Re: ${s}` : "Re:"
}

/** A Message-ID in angle brackets. */
export function angleId(id: string | undefined): string | undefined {
  const s = id?.trim()
  if (!s) return undefined
  return s.startsWith("<") ? s : `<${s}>`
}

export type SkipReason = "invalid_recipient" | "automatic_sender" | "automatic_subject" | "own_inbox" | "rate_limited_2m" | "rate_limited_1h"

/** Why a reply to `email` must not be sent, or null when it may be. Reads only. */
export async function replyBlock(ctx: QueryCtx, email: Doc<"ingestEmails">, inbox: Doc<"ingestInboxes"> | null, to: string, now: number): Promise<SkipReason | null> {
  if (!/^[^@\s]+@[^@\s]+$/.test(to)) return "invalid_recipient"
  if (AUTOMATIC_SENDER.test(to)) return "automatic_sender"
  if (AUTOMATIC_SUBJECT.test(email.subject.trim())) return "automatic_subject"
  if (inbox && to === inbox.address.toLowerCase()) return "own_inbox"
  const recent = await ctx.db
    .query("mailOutbox")
    .withIndex("by_to", (q) => q.eq("to", to).gte("createdAt", now - REPLY_LIMITS.longMs))
    .collect()
  const counted = recent.filter((r) => r.status !== "failed")
  if (counted.filter((r) => r.createdAt > now - REPLY_LIMITS.shortMs).length >= REPLY_LIMITS.shortMax) return "rate_limited_2m"
  if (counted.length >= REPLY_LIMITS.longMax) return "rate_limited_1h"
  return null
}


export interface QueueReplyResult {
  queued?: true
  sent?: false
  skipped?: SkipReason
  outboxId?: Id<"mailOutbox">
  to: string
}

/** Checks the guards and queues the reply in `mailOutbox`. Throws NOT_FOUND for an unknown email. */
export async function queueReply(
  ctx: MutationCtx,
  a: { emailId: string; text: string; actorRef?: ActorRef; operationId: string; now?: number },
): Promise<QueueReplyResult> {
  const now = a.now ?? Date.now()
  const emailId = ctx.db.normalizeId("ingestEmails", a.emailId.trim())
  const email = emailId ? await ctx.db.get(emailId) : null
  if (!email) return fail("NOT_FOUND", "email_not_found", a.operationId)
  const inbox = await ctx.db.get(email.inboxId)
  const to = bareAddress(email.replyTo?.[0] ?? email.from)
  const skipped = await replyBlock(ctx, email, inbox, to, now)
  if (skipped) return { sent: false, skipped, to }

  const messageId = angleId(email.messageId)
  const doc: Omit<Doc<"mailOutbox">, "_id" | "_creationTime"> = {
    to,
    subject: replySubject(email.subject),
    text: a.text,
    from: getConvexEnv().MAIL_FROM,
    status: "queued",
    attempts: 0,
    createdAt: now,
    emailId: email._id,
  }
  if (inbox) doc.replyTo = inbox.address
  if (messageId) {
    doc.inReplyTo = messageId
    doc.references = messageId
  }

  if (a.actorRef) doc.actorRef = a.actorRef
  const outboxId = await ctx.db.insert("mailOutbox", doc)
  return { queued: true, outboxId, to }
}

export const replyToEmailTool = defineAiTool({
  id: "mail.reply_to_email",
  description:
    "Atsako į gautą el. laišką (Gavimas) toje pačioje gijoje: gavėjas – laiško siuntėjas (ar jo Reply-To), atsakymas ateina į tą pačią dėžutę. " +
    "emailId – gauto laiško id. Automatiniams siuntėjams (no-reply…), mūsų pačių dėžutei ir dažniau nei 1 kartą per 2 min. / 3 kartus per valandą tam pačiam gavėjui neišsiunčia: grąžina {sent:false, skipped}. " +
    "Naudotojas patvirtina prieš vykdant.",
  permission: IngestPermissions.manage,
  requiresApproval: true,
  input: z.object({
    emailId: z.string().trim().min(1).max(64).describe("Gauto laiško (ingestEmails) id"),
    text: z.string().trim().min(1).max(8000).describe("Atsakymo tekstas (paprastas tekstas, be HTML)"),
  }),
  handler: async ({ db, sys, actor }, input) =>
    queueReply({ db } as unknown as MutationCtx, { emailId: input.emailId, text: input.text, actorRef: toActorRef(actor), operationId: sys.operationId }),
})

export const mailTools = [replyToEmailTool]
