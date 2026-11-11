import { convexTest } from "convex-test"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { api, internal } from "./_generated/api"
import schema from "./schema"
import { modules } from "./test.setup"

// Global search as installed in this app (convex/search.ts): the palette's contract.

type T = ReturnType<typeof setup>
const setup = () => convexTest(schema, modules)

const issuer = "https://api.workos.com/user_management/client_TEST123"
const SUPER = { subject: "user_super", issuer, email: "super@acme.test", email_verified: true }
const ALICE = { subject: "user_alice", issuer, email: "alice@acme.test", email_verified: true }
const BOB = { subject: "user_bob", issuer, email: "bob@acme.test", email_verified: true }

let sent: { to: string[]; subject: string; text: string }[] = []
beforeEach(() => {
  sent = []
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    if (!String(url).startsWith("https://api.resend.com/")) throw new Error(`unexpected fetch ${url}`)
    sent.push(JSON.parse(String(init.body)))
    return new Response("{}", { status: 200 })
  })
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

const codeOf = async (p: Promise<unknown>) => {
  try {
    await p
    return "OK"
  } catch (e) {
    return (e as { data?: { code?: string } }).data?.code ?? String(e)
  }
}

async function bootstrap(t: T) {
  await t.mutation(internal.system.registerSystem, {})
  const superUser = t.withIdentity(SUPER)
  await superUser.mutation(api.system.completeSignIn, {})
  return superUser
}

async function inviteWithRole(t: T, superUser: ReturnType<T["withIdentity"]>, who: typeof ALICE, subroleIds: string[]) {
  const { roleId } = (await superUser.mutation(api.system.createRole, { name: `Role ${who.subject}`, subroleIds })) as { roleId: string }
  await superUser.action(api.system.createInvite, { email: who.email, roleIds: [roleId] })
  const token = new URL(sent.at(-1)!.text.match(/https:\/\/app\.test\/invite\?token=\S+/)![0]).searchParams.get("token")!
  const user = t.withIdentity(who)
  await user.mutation(api.system.completeSignIn, { inviteToken: token })
  return user
}

async function withInvoices(t: T) {
  const superUser = await bootstrap(t)
  await superUser.mutation(api.system.setModuleEnabled, { moduleId: "finance", enabled: true })
  await superUser.mutation(api.finance.createInvoice, { number: "INV-1001", customer: "UAB Saulė", amountCents: 1000 })
  await superUser.mutation(api.finance.createInvoice, { number: "INV-1002", customer: "UAB Vėjas", amountCents: 2000 })
  await superUser.mutation(api.finance.createInvoice, { number: "PRO-7", customer: "Saulės baldai", amountCents: 3000 })
  return superUser
}

describe("global search", () => {
  test("a finance reader finds invoices by number prefix and by customer name", async () => {
    const t = setup()
    const superUser = await withInvoices(t)
    const alice = await inviteWithRole(t, superUser, ALICE, ["finance:reader"])

    const byNumber = await alice.query(api.search.search, { query: "inv-100" })
    expect(byNumber.groups.map((g) => g.providerId)).toEqual(["finance.invoices"])
    expect(byNumber.groups[0]!.hits.map((h) => h.title).sort()).toEqual(["INV-1001", "INV-1002"])
    expect(byNumber.groups[0]!.hits.every((h) => h.href.startsWith("/app/finance?invoice="))).toBe(true)

    const byCustomer = await alice.query(api.search.search, { query: "Vėjas" })
    expect(byCustomer.total).toBe(1)
  })

  test("the query is trimmed and must be 2–100 characters", async () => {
    const t = setup()
    const superUser = await withInvoices(t)
    expect(await codeOf(superUser.query(api.search.search, { query: " a " }))).toBe("VALIDATION")
    expect(await codeOf(superUser.query(api.search.search, { query: "x".repeat(101) }))).toBe("VALIDATION")
    expect((await superUser.query(api.search.search, { query: "  INV-1001  " })).query).toBe("INV-1001")
  })

  test("without finance permissions the invoice provider does not run", async () => {
    const t = setup()
    const superUser = await withInvoices(t)
    await superUser.mutation(api.system.setModuleEnabled, { moduleId: "ai", enabled: true })
    const bob = await inviteWithRole(t, superUser, BOB, ["ai:user"])
    expect(await bob.query(api.search.search, { query: "INV" })).toMatchObject({ groups: [], total: 0 })
  })

  test("signed out → UNAUTHENTICATED", async () => {
    const t = setup()
    await withInvoices(t)
    expect(await codeOf(t.query(api.search.search, { query: "INV" }))).toBe("UNAUTHENTICATED")
  })
})
