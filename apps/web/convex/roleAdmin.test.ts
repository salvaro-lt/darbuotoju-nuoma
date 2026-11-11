import { ADMIN_ROLE_ID, PROFILE_ROLE_ID } from "@digimuza/system-core/modules"
import { convexTest } from "convex-test"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { api, internal } from "./_generated/api"
import schema from "./schema"
import { modules } from "./test.setup"

type T = ReturnType<typeof setup>
const setup = () => convexTest(schema, modules)

const ISSUER = "https://api.workos.com/user_management/client_TEST123"
const SUPER = { subject: "user_super", issuer: ISSUER, email: "super@acme.test", email_verified: true }
const ALICE = { subject: "user_alice", issuer: ISSUER, email: "alice@acme.test", email_verified: true }
const BOB = { subject: "user_bob", issuer: ISSUER, email: "bob@acme.test", email_verified: true }

let sent: { text: string }[] = []
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

async function invite(t: T, superUser: ReturnType<T["withIdentity"]>, who: typeof ALICE, roleIds: string[]) {
  await superUser.action(api.system.createInvite, { email: who.email, roleIds })
  const token = new URL(sent.at(-1)!.text.match(/https:\/\/app\.test\/invite\?token=\S+/)![0]).searchParams.get("token")!
  const user = t.withIdentity(who)
  await user.mutation(api.system.completeSignIn, { inviteToken: token })
  return user
}

describe("roleAdmin.overview", () => {
  test("Super: no limits except what core refuses even to Super", async () => {
    const t = setup()
    const superUser = await bootstrap(t)
    const o = await superUser.query(api.roleAdmin.overview, {})
    expect(o.isSuper).toBe(true)
    expect(o.entitlements).toBeNull()
    expect(o.subrolePermissions["roles:viewer"]).toEqual(["roles:role:read"])
    expect(o.roles[ADMIN_ROLE_ID]).toMatchObject({ edit: null, archive: "protected_role", delegation: null })
    expect(o.roles[PROFILE_ROLE_ID]).toMatchObject({ edit: "implicit_role", archive: "protected_role" })

    // The locks match the mutations.
    expect(await codeOf(superUser.mutation(api.system.updateRole, { roleId: ADMIN_ROLE_ID, description: "Company admin" }))).toBe("OK")
    expect(await codeOf(superUser.mutation(api.system.updateRole, { roleId: PROFILE_ROLE_ID, description: "x" }))).toBe("FORBIDDEN")
    expect(await codeOf(superUser.mutation(api.system.archiveRole, { roleId: ADMIN_ROLE_ID }))).toBe("FORBIDDEN")
  })

  test("an Admin sees the same locks that updateRole/archiveRole enforce", async () => {
    const t = setup()
    const superUser = await bootstrap(t)
    const { roleId: viewer } = await superUser.mutation(api.system.createRole, { name: "Viewer", subroleIds: ["roles:viewer"] })
    const { roleId: finance } = await superUser.mutation(api.system.createRole, { name: "Finance", subroleIds: ["finance:reader"] })
    const alice = await invite(t, superUser, ALICE, [ADMIN_ROLE_ID])

    const o = await alice.query(api.roleAdmin.overview, {})
    expect(o.isSuper).toBe(false)
    expect(o.entitlements).toContain("roles:role:update")
    expect(o.entitlements).not.toContain("finance:invoice:read")
    expect(o.roles[ADMIN_ROLE_ID]).toMatchObject({ edit: "protected_role", archive: "protected_role", held: true })
    expect(o.roles[viewer]).toMatchObject({ edit: null, archive: null, delegation: null, grant: null, held: false })
    expect(o.roles[finance]).toMatchObject({ edit: "exceeds_authority", archive: "exceeds_authority", grant: "exceeds_authority" })
    const me = (await alice.query(api.system.session, {})).actor as { userId: string }
    expect(o.userRoles?.[me.userId]).toEqual([ADMIN_ROLE_ID])

    expect(await codeOf(alice.mutation(api.system.updateRole, { roleId: viewer, name: "Readers" }))).toBe("OK")
    expect(await codeOf(alice.mutation(api.system.updateRole, { roleId: finance, name: "x" }))).toBe("FORBIDDEN")
    expect(await codeOf(alice.mutation(api.system.updateRole, { roleId: ADMIN_ROLE_ID, name: "x" }))).toBe("FORBIDDEN")
    expect(await codeOf(alice.mutation(api.system.archiveRole, { roleId: viewer }))).toBe("OK")

    const after = await alice.query(api.roleAdmin.overview, {})
    expect(after.roles[viewer]).toBeUndefined()
  })

  test("needs roles:role:read", async () => {
    const t = setup()
    const superUser = await bootstrap(t)
    const { roleId } = await superUser.mutation(api.system.createRole, { name: "Finance", subroleIds: ["finance:reader"] })
    const bob = await invite(t, superUser, BOB, [roleId])
    expect(await codeOf(bob.query(api.roleAdmin.overview, {}))).toBe("FORBIDDEN")
    expect(await codeOf(t.query(api.roleAdmin.overview, {}))).toBe("UNAUTHENTICATED")
  })
})
