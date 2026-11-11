// Sends the email replies queued by `mail.reply_to_email` (convex/mailTools.ts).
//
//   replies:_drain           cron every 10 s (convex/crons.ts): up to 10 queued rows
//   replies:_drainOne        the tool gateway, right after a reply was queued
//
// A row is claimed (queued → sending) in a mutation, sent with Resend in the
// action, then marked sent or put back to
// queued; after 3 failed attempts it stays `failed`. A row left `sending` by a
// crashed run is retried after 5 minutes.
import { authorizeJob } from "@digimuza/system-core/convex"
import { makeFunctionReference } from "convex/server"
import { v } from "convex/values"
import type { Doc, Id } from "./_generated/dataModel"
import { internalAction, internalMutation } from "./_generated/server"
import { sendMail } from "./mail"
import { replyToEmailTool } from "./mailTools"
import { system } from "./system"

const BATCH = 10
const MAX_ATTEMPTS = 3
const STALE_SENDING_MS = 5 * 60_000

type Row = Doc<"mailOutbox">
// By name, so this file does not depend on a regenerated `_generated/api`.
const claimRef = makeFunctionReference<"mutation", { outboxId?: Id<"mailOutbox">; limit: number }, Row[]>("replies:_claim")
const finishRef = makeFunctionReference<"mutation", { outboxId: Id<"mailOutbox">; ok: boolean; error?: string }, null>("replies:_finish")

/**
 * Marks up to `limit` queued rows (or the one `outboxId`) as sending and returns them.
 * Each row's actor is re-authorized first (key revoked, permission lost, no actor → failed `not_authorized`).
 */
export const _claim = internalMutation({
  args: { outboxId: v.optional(v.id("mailOutbox")), limit: v.number() },
  handler: async (ctx, a): Promise<Row[]> => {
    const now = Date.now()
    const { sys } = await system.context(ctx)
    let rows: Row[]
    if (a.outboxId) {
      const row = await ctx.db.get(a.outboxId)
      rows = row && row.status === "queued" ? [row] : []
    } else {
      rows = await ctx.db
        .query("mailOutbox")
        .withIndex("by_status", (q) => q.eq("status", "queued"))
        .take(a.limit)
      if (rows.length < a.limit) {
        const sending = await ctx.db
          .query("mailOutbox")
          .withIndex("by_status", (q) => q.eq("status", "sending"))
          .take(50)
        const stale = sending.filter((r) => (r.claimedAt ?? r.createdAt) < now - STALE_SENDING_MS)
        const retry: Row[] = []
        for (const r of stale) {
          if (r.attempts < MAX_ATTEMPTS) retry.push(r)
          else await ctx.db.patch(r._id, { status: "failed", error: "stale_sending" })
        }
        rows = rows.concat(retry.slice(0, a.limit - rows.length))
      }
    }
    const out: Row[] = []
    for (const row of rows) {
      if (!row.actorRef || !(await authorizeJob(sys, row.actorRef, replyToEmailTool.permission))) {
        await ctx.db.patch(row._id, { status: "failed", error: "not_authorized" })
        continue
      }
      await ctx.db.patch(row._id, { status: "sending", attempts: row.attempts + 1, claimedAt: now })
      out.push({ ...row, status: "sending" as const, attempts: row.attempts + 1 })
    }
    return out
  },
})

/** Records the outcome. */
export const _finish = internalMutation({
  args: { outboxId: v.id("mailOutbox"), ok: v.boolean(), error: v.optional(v.string()) },
  handler: async (ctx, a): Promise<null> => {
    const row = await ctx.db.get(a.outboxId)
    if (!row || row.status !== "sending") return null
    const now = Date.now()
    if (!a.ok) {
      const failed = row.attempts >= MAX_ATTEMPTS
      await ctx.db.patch(row._id, { status: failed ? "failed" : "queued", error: a.error ?? "send_failed" })
      return null
    }
    await ctx.db.patch(row._id, { status: "sent", sentAt: now, error: undefined })
    return null
  },
})

async function send(row: Row): Promise<{ ok: boolean; error?: string }> {
  const headers: Record<string, string> = {}
  if (row.inReplyTo) headers["In-Reply-To"] = row.inReplyTo
  if (row.references) headers.References = row.references
  try {
    await sendMail({ to: row.to, subject: row.subject, text: row.text, from: row.from, replyTo: row.replyTo, headers })
    return { ok: true }
  } catch (e) {
    // The adapter's message carries the HTTP status only, never the response body.
    return { ok: false, error: e instanceof Error ? e.message.slice(0, 200) : "send_failed" }
  }
}

type DrainResult = { sent: number; failed: number }

async function drainRows(rows: Row[], finish: (r: Row, res: { ok: boolean; error?: string }) => Promise<unknown>): Promise<DrainResult> {
  const out = { sent: 0, failed: 0 }
  for (const row of rows) {
    const res = await send(row)
    await finish(row, res)
    if (res.ok) out.sent++
    else out.failed++
  }
  return out
}

/** Cron entry point: sends up to 10 queued replies. */
export const _drain = internalAction({
  args: {},
  handler: async (ctx): Promise<DrainResult> => {
    const rows = await ctx.runMutation(claimRef, { limit: BATCH })
    return drainRows(rows, (r, res) => ctx.runMutation(finishRef, { outboxId: r._id, ...res }))
  },
})

/** Sends one queued reply now (the gateway calls it right after the tool queued it). */
export const _drainOne = internalAction({
  args: { outboxId: v.id("mailOutbox") },
  handler: async (ctx, a): Promise<DrainResult> => {
    const rows = await ctx.runMutation(claimRef, { outboxId: a.outboxId, limit: 1 })
    return drainRows(rows, (r, res) => ctx.runMutation(finishRef, { outboxId: r._id, ...res }))
  },
})
