import { convexTest } from "convex-test"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { api, internal } from "./_generated/api"
import type { Id } from "./_generated/dataModel"
import { bareAddress, queueReply, replySubject } from "./mailTools"
import schema from "./schema"
import { modules } from "./test.setup"

// mail.reply_to_email (convex/mailTools.ts) through the tool gateway, and the
// outbox drain (convex/replies.ts) with a stubbed Resend.

const ISSUER = "https://api.workos.com/user_management/client_TEST123"
const SUPER = { subject: "user_super", issuer: ISSUER, email: "super@acme.test", email_verified: true }
const INBOX = "uzklausos@digimuza.ai"

type Sent = { from: string; to: string[]; subject: string; text: string; reply_to?: string; headers?: Record<string, string> }
let sent: Sent[] = []
let resendStatus = 200

beforeEach(() => {
  sent = []
  resendStatus = 200
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"], now: new Date("2026-11-11T10:00:00Z") })
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    if (!String(url).startsWith("https://api.resend.com/")) throw new Error(`unexpected fetch ${url}`)
    if (resendStatus !== 200) return new Response("{}", { status: resendStatus })
    sent.push(JSON.parse(String(init.body)))
    return new Response("{}", { status: 200 })
  })
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

async function setup() {
  const t = convexTest(schema, modules)
  await t.mutation(internal.system.registerSystem, {})
  const superUser = t.withIdentity(SUPER)
  await superUser.mutation(api.system.completeSignIn, {})
  for (const moduleId of ["ai", "ingest"]) await superUser.mutation(api.system.setModuleEnabled, { moduleId, enabled: true })
  const { roleId } = (await superUser.mutation(api.system.createRole, { name: "Inbox key", subroleIds: ["ingest:editor"] })) as { roleId: string }
  const { secret: apiKey, apiKeyId } = await t.action(internal.n8nSetup._issueAgentKey, { name: "n8n", roleKeys: [roleId] })
  /** The key as the actor of a reply queued directly (the drain re-authorizes it). */
  const actorRef = { kind: "agent" as const, apiKeyId }
  const inboxId = await t.run((ctx) =>
    ctx.db.insert("ingestInboxes", {
      name: "Užklausos",
      localPart: "uzklausos",
      domain: "digimuza.ai",
      address: INBOX,
      status: "active",
      purpose: "user",
      deleted: false,
      received: 0,
      createdBy: "test",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }),
  )
  let n = 0
  const email = async (e: { from: string; subject?: string; replyTo?: string[]; messageId?: string }): Promise<Id<"ingestEmails">> =>
    t.run(async (ctx) => {
      n++
      const eventId = await ctx.db.insert("ingestEvents", {
        provider: "resend",
        svixId: `svix_${n}`,
        type: "email.received",
        raw: "{}",
        rawTruncated: false,
        status: "processed",
        attempts: 1,
        operationId: "op",
        receivedAt: Date.now(),
      })
      return ctx.db.insert("ingestEmails", {
        inboxId,
        eventId,
        resendEmailId: `re_${n}`,
        from: e.from,
        to: [INBOX],
        subject: e.subject ?? "Kaina baneriui",
        text: "Sveiki, kiek kainuotų baneris 2x1 m?",
        attachments: [],
        status: "fetched",
        deliveries: [],
        receivedAt: Date.now(),
        createdAt: Date.now(),
        ...(e.replyTo ? { replyTo: e.replyTo } : {}),
        ...(e.messageId !== undefined ? { messageId: e.messageId } : { messageId: `msg-${n}@mail.klientas.lt` }),
      })
    })
  const reply = (emailId: string, text = "Ačiū, netrukus atsiųsime sąmatą.") =>
    t.action(api.toolGateway.callTool, { apiKey, tool: "mail_reply_to_email", argsJson: JSON.stringify({ emailId, text }) })
  const outbox = () => t.run((ctx) => ctx.db.query("mailOutbox").collect())
  return { t, superUser, apiKey, apiKeyId, actorRef, inboxId, email, reply, outbox }
}

const advance = (ms: number) => vi.setSystemTime(Date.now() + ms)

describe("mail.reply_to_email", () => {
  test("helpers: address and subject", () => {
    expect(bareAddress("Jonas <Jonas@Klientas.LT>")).toBe("jonas@klientas.lt")
    expect(replySubject("Kaina")).toBe("Re: Kaina")
    expect(replySubject("Re: Kaina")).toBe("Re: Kaina")
    expect(replySubject("ATS: Kaina")).toBe("ATS: Kaina")
  })

  test("queues a threaded reply to the sender (Reply-To wins) and the gateway sends it right away", async () => {
    const { email, reply, outbox } = await setup()
    const id = await email({ from: "Jonas <jonas@klientas.lt>", replyTo: ["Jonas@Klientas.lt"], messageId: "abc@mail.klientas.lt" })
    const res = await reply(id)
    expect(res).toMatchObject({ ok: true, result: { queued: true, to: "jonas@klientas.lt", sent: true, outboxId: expect.any(String) } })

    const [row] = await outbox()
    expect(row).toMatchObject({
      to: "jonas@klientas.lt",
      subject: "Re: Kaina baneriui",
      from: "System <no-reply@digimuza.ai>",
      replyTo: INBOX,
      inReplyTo: "<abc@mail.klientas.lt>",
      references: "<abc@mail.klientas.lt>",
      status: "sent",
      attempts: 1,
    })
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({
      to: ["jonas@klientas.lt"],
      subject: "Re: Kaina baneriui",
      reply_to: INBOX,
      headers: { "In-Reply-To": "<abc@mail.klientas.lt>", References: "<abc@mail.klientas.lt>" },
    })
  })

  test("throttle: 1 per 2 minutes and 3 per hour per recipient", async () => {
    const { email, reply } = await setup()
    const from = "ieva@klientas.lt"
    expect(await reply(await email({ from }))).toMatchObject({ ok: true, result: { queued: true } })
    advance(60_000)
    expect(await reply(await email({ from }))).toMatchObject({ ok: true, result: { sent: false, skipped: "rate_limited_2m" } })
    // Another recipient is not affected.
    expect(await reply(await email({ from: "kitas@klientas.lt" }))).toMatchObject({ ok: true, result: { queued: true } })
    advance(2 * 60_000)
    expect(await reply(await email({ from }))).toMatchObject({ ok: true, result: { queued: true } })
    advance(3 * 60_000)
    expect(await reply(await email({ from }))).toMatchObject({ ok: true, result: { queued: true } })
    advance(3 * 60_000)
    expect(await reply(await email({ from }))).toMatchObject({ ok: true, result: { sent: false, skipped: "rate_limited_1h" } })
    advance(60 * 60_000)
    expect(await reply(await email({ from }))).toMatchObject({ ok: true, result: { queued: true } })
    expect(sent.filter((m) => m.to[0] === from)).toHaveLength(4)
  })

  test("never answers automatic senders, auto-replies or our own inbox", async () => {
    const { email, reply, outbox } = await setup()
    expect(await reply(await email({ from: "no-reply@shop.lt" }))).toMatchObject({ ok: true, result: { sent: false, skipped: "automatic_sender" } })
    expect(await reply(await email({ from: "MAILER-DAEMON@mx.lt" }))).toMatchObject({ ok: true, result: { sent: false, skipped: "automatic_sender" } })
    expect(await reply(await email({ from: "jonas@klientas.lt", subject: "Automatic reply: Kaina" }))).toMatchObject({ ok: true, result: { skipped: "automatic_subject" } })
    expect(await reply(await email({ from: `Mes <${INBOX}>` }))).toMatchObject({ ok: true, result: { sent: false, skipped: "own_inbox" } })
    expect(await outbox()).toHaveLength(0)
    expect(sent).toHaveLength(0)
  })

  test("unknown email is NOT_FOUND; empty text is VALIDATION", async () => {
    const { email, reply } = await setup()
    const id = await email({ from: "jonas@klientas.lt" })
    expect(await reply("nope")).toMatchObject({ ok: false, code: "NOT_FOUND" })
    expect(await reply(id, "")).toMatchObject({ ok: false, code: "VALIDATION" })
  })
})

describe("replies:_drain", () => {
  test("sends queued replies with reply_to and thread headers", async () => {
    const { t, email, actorRef } = await setup()
    const id = await email({ from: "Jonas <jonas@klientas.lt>", subject: "Reikia suvirintojų", messageId: "<first@mail.klientas.lt>" })
    // Queued without the gateway's immediate send.
    const { outboxId } = await t.run((ctx) => queueReply(ctx, { emailId: id, text: "Ačiū, susisieksime.", actorRef, operationId: "op" }))
    expect(outboxId).toBeTruthy()
    const row0 = await t.run((ctx) => ctx.db.get(outboxId!))
    expect(row0).toMatchObject({ status: "queued", subject: "Re: Reikia suvirintojų" })

    advance(1000)
    expect(await t.action(internal.replies._drain, {})).toEqual({ sent: 1, failed: 0 })
    expect(sent[0]).toMatchObject({ to: ["jonas@klientas.lt"], reply_to: INBOX, subject: "Re: Reikia suvirintojų", headers: { "In-Reply-To": "<first@mail.klientas.lt>" } })
    expect(await t.run((ctx) => ctx.db.get(outboxId!))).toMatchObject({ status: "sent", sentAt: Date.now() })
    // Nothing left to send.
    expect(await t.action(internal.replies._drain, {})).toEqual({ sent: 0, failed: 0 })
  })

  test("a failed send is retried, then marked failed after 3 attempts (error without body)", async () => {
    const { t, email, actorRef } = await setup()
    const id = await email({ from: "jonas@klientas.lt" })
    const { outboxId } = await t.run((ctx) => queueReply(ctx, { emailId: id, text: "x", actorRef, operationId: "op" }))
    resendStatus = 500
    for (let i = 0; i < 3; i++) expect(await t.action(internal.replies._drain, {})).toEqual({ sent: 0, failed: 1 })
    const row = await t.run((ctx) => ctx.db.get(outboxId!))
    expect(row).toMatchObject({ status: "failed", attempts: 3, error: "Mail delivery failed with HTTP 500" })
    expect(await t.action(internal.replies._drain, {})).toEqual({ sent: 0, failed: 0 })
  })

  test("the drain re-authorizes the actor: a revoked key's queued reply fails not_authorized, nothing sent", async () => {
    const { t, superUser, email, apiKeyId, actorRef } = await setup()
    const id = await email({ from: "jonas@klientas.lt" })
    const queued = await t.run((ctx) => queueReply(ctx, { emailId: id, text: "x", actorRef, operationId: "op" }))
    const noActor = await t.run((ctx) => queueReply(ctx, { emailId: id, text: "y", operationId: "op", now: Date.now() + 10 * 60_000 }))
    await superUser.mutation(api.system.revokeApiKey, { apiKeyId })
    expect(await t.action(internal.replies._drain, {})).toEqual({ sent: 0, failed: 0 })
    for (const outboxId of [queued.outboxId!, noActor.outboxId!]) expect(await t.run((ctx) => ctx.db.get(outboxId))).toMatchObject({ status: "failed", error: "not_authorized", attempts: 0 })
    expect(sent).toHaveLength(0)
  })
})
