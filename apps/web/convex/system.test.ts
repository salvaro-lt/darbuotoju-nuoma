import { convexTest } from "convex-test"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { api, internal } from "./_generated/api"
import schema from "./schema"
import { modules } from "./test.setup"

type T = ReturnType<typeof setup>
const setup = () => convexTest(schema, modules)

// Identities as Convex reports them for a WorkOS token with the JWT template: `email_verified` stays a raw claim.
const SUPER = { subject: "user_super", issuer: "https://api.workos.com/user_management/client_TEST123", email: "super@acme.test", email_verified: true }
const ALICE = { subject: "user_alice", issuer: "https://api.workos.com/user_management/client_TEST123", email: "alice@acme.test", email_verified: true }
const MALLORY = { subject: "user_mallory", issuer: "https://api.workos.com/user_management/client_TEST123", email: "mallory@acme.test", email_verified: true }

/** Captures mail sent through Resend (convex/mail.ts) instead of sending it. */
let sent: { to: string[]; subject: string; text: string }[] = []
beforeEach(() => {
  sent = []
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    if (!String(url).startsWith("https://api.resend.com/")) throw new Error(`unexpected fetch ${url}`)
    sent.push(JSON.parse(String(init.body)))
    return new Response("{}", { status: 200 })
  })
})
afterEach(() => vi.unstubAllGlobals())

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

/** Super creates a role from `subroleIds`, invites `who`, and `who` accepts. */
async function inviteWithRole(t: T, superUser: ReturnType<T["withIdentity"]>, who: typeof ALICE, subroleIds: string[]) {
  const { roleId } = (await superUser.mutation(api.system.createRole, { name: `Role ${subroleIds.join("+")}`, subroleIds })) as { roleId: string }
  const res = await superUser.action(api.system.createInvite, { email: who.email, roleIds: [roleId] })
  expect(res.deliveryStatus).toBe("sent")
  const token = new URL(sent.at(-1)!.text.match(/https:\/\/app\.test\/invite\?token=\S+/)![0]).searchParams.get("token")!
  const user = t.withIdentity(who)
  await user.mutation(api.system.completeSignIn, { inviteToken: token })
  return { user, roleId }
}

describe("sign-in", () => {
  test("a verified SUPER_USER_EMAILS address becomes Super; a stranger gets no account", async () => {
    const t = setup()
    const superUser = await bootstrap(t)
    const s = await superUser.query(api.system.session, {})
    expect(s.actor).toMatchObject({ kind: "user", email: "super@acme.test", isSuper: true })

    const stranger = t.withIdentity(MALLORY)
    expect(await codeOf(stranger.mutation(api.system.completeSignIn, {}))).toBe("UNAUTHENTICATED")
    expect((await stranger.query(api.system.session, {})).actor).toBeNull()
  })

  test("a WorkOS token without the JWT template (no email claim) cannot become Super", async () => {
    const t = setup()
    await t.mutation(internal.system.registerSystem, {})
    const { email: _e, email_verified: _v, ...bare } = SUPER
    expect(await codeOf(t.withIdentity(bare).mutation(api.system.completeSignIn, {}))).toBe("UNAUTHENTICATED")
  })

  test("an unverified email never becomes Super", async () => {
    const t = setup()
    await t.mutation(internal.system.registerSystem, {})
    const fake = t.withIdentity({ ...SUPER, subject: "ba-fake", email_verified: false })
    expect(await codeOf(fake.mutation(api.system.completeSignIn, {}))).not.toBe("OK")
  })
})

describe("finance guard", () => {
  test("anonymous callers are rejected", async () => {
    const t = setup()
    await bootstrap(t)
    expect(await codeOf(t.query(api.finance.listInvoices, {}))).toBe("UNAUTHENTICATED")
  })

  test("the module registers disabled: Super may use it, others may not until enabled", async () => {
    const t = setup()
    const superUser = await bootstrap(t)
    const { user: alice } = await inviteWithRole(t, superUser, ALICE, ["finance:accountant"])

    expect(await codeOf(superUser.mutation(api.finance.createInvoice, { number: "A-1", customer: "UAB Test", amountCents: 1000 }))).toBe("OK")
    expect(await codeOf(alice.query(api.finance.listInvoices, {}))).toBe("FORBIDDEN")

    await superUser.mutation(api.system.setModuleEnabled, { moduleId: "finance", enabled: true })
    expect(await alice.query(api.finance.listInvoices, {})).toHaveLength(1)
  })

  test("a reader can list but not approve; an accountant can approve once", async () => {
    const t = setup()
    const superUser = await bootstrap(t)
    await superUser.mutation(api.system.setModuleEnabled, { moduleId: "finance", enabled: true })
    const { user: alice } = await inviteWithRole(t, superUser, ALICE, ["finance:reader"])
    const { invoiceId } = await superUser.mutation(api.finance.createInvoice, { number: "A-2", customer: "UAB Test", amountCents: 2500 })

    expect(await alice.query(api.finance.listInvoices, {})).toHaveLength(1)
    expect(await codeOf(alice.mutation(api.finance.approveInvoice, { invoiceId }))).toBe("FORBIDDEN")
    expect(await codeOf(alice.mutation(api.finance.createInvoice, { number: "A-3", customer: "X", amountCents: 1 }))).toBe("FORBIDDEN")

    expect(await codeOf(superUser.mutation(api.finance.approveInvoice, { invoiceId }))).toBe("OK")
    expect(await codeOf(superUser.mutation(api.finance.approveInvoice, { invoiceId }))).toBe("CONFLICT")

    const audit = await superUser.query(api.system.listAudit, { action: "finance.invoice.approve" })
    expect(audit.items).toHaveLength(1)
  })

  test("bulk approval needs the feature flag in addition to the permission", async () => {
    const t = setup()
    const superUser = await bootstrap(t)
    await superUser.mutation(api.system.setModuleEnabled, { moduleId: "finance", enabled: true })
    const a = await superUser.mutation(api.finance.createInvoice, { number: "B-1", customer: "X", amountCents: 100 })
    const b = await superUser.mutation(api.finance.createInvoice, { number: "B-2", customer: "X", amountCents: 100 })
    const ids = [a.invoiceId, b.invoiceId]

    expect(await codeOf(superUser.mutation(api.finance.bulkApproveInvoices, { invoiceIds: ids }))).toBe("FORBIDDEN")
    await superUser.mutation(api.system.setFeatureFlag, { flagId: "finance:bulk-approve", value: true })
    expect(await superUser.mutation(api.finance.bulkApproveInvoices, { invoiceIds: ids })).toMatchObject({ approved: 2 })
  })
})

describe("invites", () => {
  test("an invite works once and only for its own email", async () => {
    const t = setup()
    const superUser = await bootstrap(t)
    const { roleId } = (await superUser.mutation(api.system.createRole, { name: "Readers", subroleIds: ["finance:reader"] })) as { roleId: string }
    await superUser.action(api.system.createInvite, { email: ALICE.email, roleIds: [roleId] })
    const token = new URL(sent.at(-1)!.text.match(/https:\/\/app\.test\/invite\?token=\S+/)![0]).searchParams.get("token")!

    expect(await codeOf(t.withIdentity(MALLORY).mutation(api.system.completeSignIn, { inviteToken: token }))).not.toBe("OK")
    expect(await codeOf(t.withIdentity(ALICE).mutation(api.system.completeSignIn, { inviteToken: token }))).toBe("OK")
    const bob = { ...MALLORY, subject: "ba-bob", email: "alice@acme.test" }
    expect(await codeOf(t.withIdentity(bob).mutation(api.system.completeSignIn, { inviteToken: token }))).not.toBe("OK")
  })
})

describe("API keys", () => {
  test("an agent key acts through its roles, never as Super, and stops working when revoked", async () => {
    const t = setup()
    const superUser = await bootstrap(t)
    await superUser.mutation(api.system.setModuleEnabled, { moduleId: "finance", enabled: true })

    // A Super owner's key with no roles has no business permissions.
    const bare = await superUser.action(api.system.createApiKey, { name: "bare", roleIds: [] })
    expect(await codeOf(t.query(api.finance.listInvoices, { apiKey: bare.secret }))).toBe("FORBIDDEN")

    const { roleId } = (await superUser.mutation(api.system.createRole, { name: "Accountants", subroleIds: ["finance:accountant"] })) as { roleId: string }
    const key = await superUser.action(api.system.createApiKey, { name: "bot", roleIds: [roleId] })
    expect(key.secret).toMatch(/^dsk_/)
    expect(await codeOf(t.mutation(api.finance.createInvoice, { apiKey: key.secret, number: "K-1", customer: "X", amountCents: 100 }))).toBe("OK")

    const listed = await superUser.query(api.system.listMyApiKeys, {})
    expect(JSON.stringify(listed)).not.toContain(key.secret)

    await superUser.mutation(api.system.revokeApiKey, { apiKeyId: key.apiKeyId })
    expect(await codeOf(t.query(api.finance.listInvoices, { apiKey: key.secret }))).not.toBe("OK")
  })
})

describe("Super tools: view as role", () => {
  test("a Super viewing as a role is checked as that role, and gets Super back when stopping", async () => {
    const t = setup()
    const superUser = await bootstrap(t)
    await superUser.mutation(api.system.setModuleEnabled, { moduleId: "finance", enabled: true })
    const { invoiceId } = await superUser.mutation(api.finance.createInvoice, { number: "V-1", customer: "X", amountCents: 100 })
    const { roleId } = (await superUser.mutation(api.system.createRole, { name: "Readers", subroleIds: ["finance:reader"] })) as { roleId: string }

    await superUser.mutation(api.system.startRoleView, { roleId })
    expect(await superUser.query(api.system.roleViewStatus, {})).toEqual({ canViewAs: true, roleView: { roleId, roleName: "Readers" } })
    const viewing = await superUser.query(api.system.session, {})
    expect(viewing.actor).toMatchObject({ isSuper: false })
    expect(viewing.permissions).toContain("finance:invoice:read")
    expect(viewing.permissions).not.toContain("finance:invoice:approve")

    expect(await superUser.query(api.finance.listInvoices, {})).toHaveLength(1)
    expect(await codeOf(superUser.mutation(api.finance.approveInvoice, { invoiceId }))).toBe("FORBIDDEN")

    await superUser.mutation(api.system.stopRoleView, {})
    expect((await superUser.query(api.system.session, {})).actor).toMatchObject({ isSuper: true })
    expect(await codeOf(superUser.mutation(api.finance.approveInvoice, { invoiceId }))).toBe("OK")

    const audit = await superUser.query(api.system.listAudit, { action: "super.role_view.start" })
    expect(audit.items).toHaveLength(1)
  })

  test("Super-only admin actions are off during a role view (enforced by system-core)", async () => {
    const t = setup()
    const superUser = await bootstrap(t)
    const { roleId } = (await superUser.mutation(api.system.createRole, { name: "Readers", subroleIds: ["finance:reader"] })) as { roleId: string }
    await superUser.mutation(api.system.startRoleView, { roleId })
    expect(await codeOf(superUser.mutation(api.system.setModuleEnabled, { moduleId: "finance", enabled: true }))).toBe("FORBIDDEN")
    expect(await codeOf(superUser.query(api.system.listUsers, {}))).toBe("FORBIDDEN")
    await superUser.mutation(api.system.stopRoleView, {})
    expect(await codeOf(superUser.query(api.system.listUsers, {}))).toBe("OK")
  })

  test("a disabled module stays unavailable in a role view, even for a Super", async () => {
    const t = setup()
    const superUser = await bootstrap(t)
    const { roleId } = (await superUser.mutation(api.system.createRole, { name: "Accountants", subroleIds: ["finance:accountant"] })) as { roleId: string }
    await superUser.mutation(api.system.startRoleView, { roleId })
    expect(await codeOf(superUser.query(api.finance.listInvoices, {}))).toBe("FORBIDDEN")
  })

  test("only a Super can start a role view", async () => {
    const t = setup()
    const superUser = await bootstrap(t)
    const { user: alice, roleId } = await inviteWithRole(t, superUser, ALICE, ["finance:reader"])
    expect(await codeOf(alice.mutation(api.system.startRoleView, { roleId }))).toBe("FORBIDDEN")
    expect(await alice.query(api.system.roleViewStatus, {})).toEqual({ canViewAs: false, roleView: null })
  })
})
