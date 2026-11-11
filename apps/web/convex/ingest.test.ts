import { convexTest } from "convex-test"
import { svixSignature } from "@digimuza/system-core/automations"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { api, internal } from "./_generated/api"
import schema from "./schema"
import { modules } from "./test.setup"

// Gavimas (ingest) as installed in this app (convex/ingest.ts): an inbox on the
// receiving domain, an email automation reading it, and a signed Resend webhook
// that lands in the inbox and queues the automation's run.

const issuer = "https://api.workos.com/user_management/client_TEST123"
const SUPER = { subject: "user_super", issuer, email: "super@acme.test", email_verified: true }
const SECRET = "whsec_c2VjcmV0LXNpZ25pbmcta2V5LWZvci10ZXN0cw=="

beforeEach(() => {
  process.env.RESEND_RECEIVING_API_KEY = "re_test"
  process.env.RESEND_WEBHOOK_SECRET = SECRET
  // Resend answers the body; the extraction model answers 500.
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
  vi.stubGlobal("fetch", async (url: string) => {
    if (String(url).startsWith("https://api.resend.com/emails/receiving/em_1"))
      return new Response(JSON.stringify({ id: "em_1", from: "jonas@example.com", to: ["saskaitos@abc123.resend.app"], subject: "Sąskaita", text: "A-1, UAB Testas, 12,50 EUR", html: null, headers: {}, attachments: [] }), { status: 200 })
    // The extraction model is not configured here: the run fails, the email stays.
    return new Response("{}", { status: 500 })
  })
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  delete process.env.RESEND_RECEIVING_API_KEY
  delete process.env.RESEND_WEBHOOK_SECRET
})

async function setup() {
  const t = convexTest(schema, modules)
  await t.mutation(internal.system.registerSystem, {})
  const superUser = t.withIdentity(SUPER)
  await superUser.mutation(api.system.completeSignIn, {})
  for (const moduleId of ["automations", "finance", "ingest"]) await superUser.mutation(api.system.setModuleEnabled, { moduleId, enabled: true })
  await superUser.mutation(api.system.createRole, { name: "Buhalterija", subroleIds: ["finance:accountant"] })
  return { t, superUser }
}

describe("ingest", () => {
  test("needs a session", async () => {
    const { t } = await setup()
    await expect(t.query(api.ingest.listInboxes, {})).rejects.toThrow(/UNAUTHENTICATED/)
  })

  test("a signed webhook reaches the inbox and the automation reading it", async () => {
    const { t, superUser } = await setup()
    await superUser.mutation(api.ingest.setManagedDomain, { domain: "abc123.resend.app" })
    const { inboxId, address } = await superUser.mutation(api.ingest.createInbox, { name: "Sąskaitos", localPart: "saskaitos" })
    const { automationId } = await superUser.mutation(api.automations.createAutomation, {
      definition: {
        name: "Sąskaitos iš laiškų",
        trigger: { channel: "email", emailSource: "resend", inboxId },
        extract: { instructions: "Ištrauk sąskaitos numerį, klientą ir sumą eurais.", fields: [{ name: "number", type: "string", required: true }, { name: "customer", type: "string", required: true }, { name: "amount", type: "number", required: true }] },
        actions: [{ targetId: "finance.create_invoice", mapping: { number: "{{number}}", customer: "{{customer}}", amountEur: "{{amount}}" } }],
      },
    })
    const raw = JSON.stringify({ type: "email.received", created_at: new Date().toISOString(), data: { email_id: "em_1", from: "jonas@example.com", to: [address], subject: "Sąskaita" } })
    const ts = String(Math.floor(Date.now() / 1000))
    const signed = { svixId: "msg_1", svixTimestamp: ts, svixSignature: await svixSignature(SECRET, "msg_1", ts, raw), raw }
    expect(await t.mutation(api.ingest.receiveResendWebhook, signed)).toMatchObject({ ok: true, status: 200, duplicate: false })
    expect(await t.mutation(api.ingest.receiveResendWebhook, signed)).toMatchObject({ ok: true, duplicate: true })
    expect(await t.mutation(api.ingest.receiveResendWebhook, { ...signed, svixSignature: "v1,AAAA", svixId: "msg_2" })).toMatchObject({ ok: false, status: 401 })
    await t.finishAllScheduledFunctions(vi.runAllTimers)
    const { items } = await superUser.query(api.ingest.listEmails, { inboxId })
    expect(items).toMatchObject([{ subject: "Sąskaita", status: "fetched", deliveries: [{ refId: automationId, outcome: "accepted" }] }])
  })
})
