import { convexTest } from "convex-test"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { api, internal } from "./_generated/api"
import schema from "./schema"
import { modules } from "./test.setup"

// Automations as installed in this app (convex/automations.ts): permissions, the
// webhook's token check, and a received form waiting for extraction.

const issuer = "https://api.workos.com/user_management/client_TEST123"
const SUPER = { subject: "user_super", issuer, email: "super@acme.test", email_verified: true }

beforeEach(() => {
  // Keeps convex-test from running the scheduled extraction (it would call the model).
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
})
afterEach(() => vi.useRealTimers())

async function setup() {
  const t = convexTest(schema, modules)
  await t.mutation(internal.system.registerSystem, {})
  const superUser = t.withIdentity(SUPER)
  await superUser.mutation(api.system.completeSignIn, {})
  for (const moduleId of ["automations", "finance"]) await superUser.mutation(api.system.setModuleEnabled, { moduleId, enabled: true })
  await superUser.mutation(api.system.createRole, { name: "Buhalterija", subroleIds: ["finance:accountant"] })
  return { t, superUser }
}

const definition = {
  name: "Sąskaitos iš formos",
  trigger: { channel: "webhook" as const },
  extract: {
    instructions: "Ištrauk sąskaitos numerį, klientą ir sumą eurais.",
    fields: [
      { name: "number", type: "string" as const, required: true },
      { name: "customer", type: "string" as const, required: true },
      { name: "amount", type: "number" as const, required: true },
    ],
  },
  actions: [{ targetId: "finance.create_invoice", mapping: { number: "{{number}}", customer: "{{customer}}", amountEur: "{{amount}}" } }],
}

describe("automations", () => {
  test("needs a session and the module's permissions", async () => {
    const { t } = await setup()
    await expect(t.query(api.automations.listAutomations, {})).rejects.toThrow(/UNAUTHENTICATED/)
  })

  test("the webhook answers 404 / 401 without a valid token and queues a run with one", async () => {
    const { t, superUser } = await setup()
    const { automationId } = await superUser.mutation(api.automations.createAutomation, { definition })
    const post = (id: string, token: string) => t.mutation(api.automations.ingestWebhook, { automationId: id, token, contentType: "application/json", raw: '{"message":"A-1, UAB Testas, 12,50 EUR"}' })
    expect(await post("nope", "")).toMatchObject({ ok: false, status: 404 })
    expect(await post(automationId, "")).toMatchObject({ ok: false, status: 401 })
    const { secret } = await superUser.action(api.automations.rotateHookSecret, { automationId })
    expect(await post(automationId, secret)).toMatchObject({ ok: true, status: 202, ignored: false })
    const { items } = await superUser.query(api.automations.listRuns, { automationId })
    expect(items).toMatchObject([{ status: "queued" }])
    const targets = await superUser.query(api.automations.listAutomationTargets, {})
    expect(targets.map((x) => x.id)).toEqual(["finance.create_invoice"])
  })
})
