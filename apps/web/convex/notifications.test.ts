import { convexTest } from "convex-test"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { api, internal } from "./_generated/api"
import schema from "./schema"
import { modules } from "./test.setup"

// Notifications as installed in this app (convex/notifications.ts). Fake timers keep
// convex-test from running the scheduled email delivery; rows stay `pending`.

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

const userIdOf = async (user: ReturnType<T["withIdentity"]>) => {
  const s = await user.query(api.system.session, {})
  return (s.actor as { userId: string }).userId
}

describe("notifications", () => {
  test("a new draft invoice notifies the approvers, not the creator or readers; read state is per user", async () => {
    const t = setup()
    const superUser = await bootstrap(t)
    await superUser.mutation(api.system.setModuleEnabled, { moduleId: "finance", enabled: true })
    const alice = await inviteWithRole(t, superUser, ALICE, ["finance:accountant"])
    const bob = await inviteWithRole(t, superUser, BOB, ["finance:reader"])
    const before = await alice.query(api.notifications.listNotifications, {})

    await superUser.mutation(api.finance.createInvoice, { number: "N-1", customer: "UAB Test", amountCents: 12345 })

    const list = await alice.query(api.notifications.listNotifications, {})
    expect(list.items).toHaveLength(before.items.length + 1)
    expect(list.items[0]).toMatchObject({
      type: "finance.invoice_awaiting_approval",
      moduleId: "finance",
      params: { number: "N-1", customer: "UAB Test", amountCents: 12345, currency: "EUR" },
      href: "/app/finance?invoice=N-1",
      readAt: null,
      emailStatus: "pending",
    })
    const invoiceNotes = async (u: ReturnType<T["withIdentity"]>) => (await u.query(api.notifications.listNotifications, {})).items.filter((n) => n.type === "finance.invoice_awaiting_approval")
    expect(await invoiceNotes(bob)).toHaveLength(0)
    expect(await invoiceNotes(superUser)).toHaveLength(0)

    const unread = await alice.query(api.notifications.unreadNotificationCount, {})
    expect(unread).toBeGreaterThanOrEqual(1)
    // Own data only: Bob cannot mark Alice's notification.
    expect(await codeOf(bob.mutation(api.notifications.markNotificationRead, { notificationId: list.items[0]!.id }))).not.toBe("OK")
    expect(await alice.mutation(api.notifications.markNotificationRead, { notificationId: list.items[0]!.id })).toEqual({ read: true })
    expect(await alice.query(api.notifications.unreadNotificationCount, {})).toBe(unread - 1)

    const unreadOnly = await alice.query(api.notifications.listNotifications, { unreadOnly: true })
    expect(unreadOnly.items.find((n) => n.id === list.items[0]!.id)).toBeUndefined()

    let res = await alice.mutation(api.notifications.markAllNotificationsRead, {})
    while (!res.done) res = await alice.mutation(api.notifications.markAllNotificationsRead, {})
    expect(await alice.query(api.notifications.unreadNotificationCount, {})).toBe(0)
  })

  test("assigning a role notifies the user with the role names", async () => {
    const t = setup()
    const superUser = await bootstrap(t)
    const alice = await inviteWithRole(t, superUser, ALICE, ["finance:reader"])
    const { roleId } = (await superUser.mutation(api.system.createRole, { name: "Tvirtintojas", subroleIds: ["finance:accountant"] })) as { roleId: string }

    await superUser.mutation(api.system.assignRoles, { userId: await userIdOf(alice), roleIds: [roleId] })

    const [latest] = (await alice.query(api.notifications.listNotifications, { limit: 1 })).items
    expect(latest).toMatchObject({ type: "roles.role_assigned", moduleId: "roles", href: null, readAt: null })
    expect(latest!.params).toMatchObject({ roleNames: ["Tvirtintojas"] })
  })

  test("preferences: defaults, then an in-app opt-out hides new notifications of that type", async () => {
    const t = setup()
    const superUser = await bootstrap(t)
    await superUser.mutation(api.system.setModuleEnabled, { moduleId: "finance", enabled: true })
    const alice = await inviteWithRole(t, superUser, ALICE, ["finance:accountant"])

    const prefs = await alice.query(api.notifications.getNotificationPreferences, {})
    const invoice = prefs.find((p) => p.type === "finance.invoice_awaiting_approval")
    expect(invoice).toMatchObject({ moduleId: "finance", inApp: true, email: true, customized: false, defaultChannels: { inApp: true, email: true } })
    expect(prefs.map((p) => p.type)).toContain("roles.role_assigned")

    const saved = await alice.mutation(api.notifications.setNotificationPreference, { type: "finance.invoice_awaiting_approval", inApp: false, email: false })
    expect(saved).toMatchObject({ inApp: false, email: false, customized: true })

    await superUser.mutation(api.finance.createInvoice, { number: "N-2", customer: "UAB Test", amountCents: 100 })
    const items = (await alice.query(api.notifications.listNotifications, {})).items
    expect(items.filter((n) => n.type === "finance.invoice_awaiting_approval")).toHaveLength(0)
  })
})
