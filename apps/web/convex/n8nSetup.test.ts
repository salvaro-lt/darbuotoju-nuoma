import { convexTest } from "convex-test"
import { makeFunctionReference } from "convex/server"
import { describe, expect, test } from "vitest"
import { api, internal } from "./_generated/api"
import { N8N_ROLE_NAME } from "./n8nSetup"
import schema from "./schema"
import { system } from "./system"
import { modules } from "./test.setup"

// The n8n agent key (scripts/n8n-setup.ts → `npx convex run n8nSetup:_issueAgentKey`):
// issued without a session, owned by a Super user, carrying non-protected roles.
// Issuing revokes nothing; `_revokeOtherAgentKeys` runs once the new secret is stored.

const issuer = "https://api.workos.com/user_management/client_TEST123"
const SUPER = { subject: "user_super", issuer, email: "super@acme.test", email_verified: true }

type Issued = { apiKeyId: string; prefix: string; ownerId: string; roleIds: string[]; secret: string }
const issue = makeFunctionReference<"action", { name: string; ownerEmail?: string; roleKeys?: string[] }, Issued>("n8nSetup:_issueAgentKey")
const revokeOthers = makeFunctionReference<"mutation", { name: string; keepApiKeyId: string }, { revoked: string[] }>("n8nSetup:_revokeOtherAgentKeys")

async function setup() {
  const t = convexTest(schema, modules)
  await t.mutation(internal.system.registerSystem, {})
  const superUser = t.withIdentity(SUPER)
  await superUser.mutation(api.system.completeSignIn, {})
  return { t, superUser }
}

describe("n8n agent key", () => {
  test("issues a dsk_ key with the n8n role that resolves as an agent of the Super owner", async () => {
    const { t } = await setup()
    const res = await t.action(issue, { name: "n8n" })
    expect(res.secret).toMatch(/^dsk_[a-z0-9]{10}_[A-Za-z0-9_-]{32,}$/)

    const state = await t.run(async (ctx) => {
      const { sys, actor } = await system.context(ctx, { apiKey: res.secret })
      const roles = await sys.store.findBy("apiKeyRoles", "apiKeyId", res.apiKeyId)
      const role = await sys.store.get("roles", res.roleIds[0]!)
      const subs = (await sys.store.findBy("roleSubroles", "roleId", res.roleIds[0]!)).map((r) => r.subroleId)
      const owner = await sys.store.get("users", res.ownerId)
      const key = await sys.store.get("apiKeys", res.apiKeyId)
      return { actor, roles: roles.map((r) => r.roleId), role, subs, ownerEmail: owner?.email, key }
    })
    expect(state.actor).toEqual({ kind: "agent", apiKeyId: res.apiKeyId, ownerId: res.ownerId })
    expect(state.ownerEmail).toBe(SUPER.email)
    expect(state.roles).toEqual(res.roleIds)
    expect(state.role).toMatchObject({ name: N8N_ROLE_NAME, protected: false, archived: false })
    // Every business module's subroles; no system subroles (users, roles, api-keys…).
    expect(state.subs).toEqual(expect.arrayContaining(["staffing:admin", "finance:accountant", "ingest:admin", "documents:admin", "ai:user"]))
    expect(state.subs.some((s) => s.startsWith("users:") || s.startsWith("api-keys:") || s.startsWith("profile:"))).toBe(false)
    // Never n8n's own subroles: an email-triggered workflow must not manage n8n workflows.
    expect(state.subs.some((s) => s.startsWith("n8n:"))).toBe(false)
    expect(state.key).toMatchObject({ name: "n8n", ownerId: res.ownerId })
    expect(state.key?.purpose).toBeUndefined()
    expect(state.key?.hash).not.toContain(res.secret)
  })

  test("re-issuing revokes nothing; revokeOther revokes only same-name keys of the same owner and keeps the given one", async () => {
    const { t } = await setup()
    const first = await t.action(issue, { name: "n8n" })
    const second = await t.action(issue, { name: "n8n" })
    const other = await t.action(issue, { name: "other" })
    expect(second.roleIds).toEqual(first.roleIds)
    // Same name, another owner (must survive).
    const foreignKey = await t.run(async (ctx) => {
      await ctx.db.insert("apiKeys", { key: "ak_foreign", prefix: "foreign0000", hash: "x", ownerId: "user_someone_else", name: "n8n", createdAt: Date.now() })
      return "ak_foreign"
    })

    const active = async () =>
      t.run(async (ctx) => {
        const a = await system.context(ctx, { apiKey: first.secret })
        const b = await system.context(ctx, { apiKey: second.secret })
        const roles = (await ctx.db.query("roles").collect()).filter((r) => r.name === N8N_ROLE_NAME)
        const keys = await ctx.db.query("apiKeys").collect()
        const revoked = Object.fromEntries(keys.map((k) => [k.key, k.revokedAt !== undefined]))
        return { first: a.actor, second: b.actor, roles: roles.length, revoked }
      })
    const before = await active()
    expect(before.first).toMatchObject({ kind: "agent", apiKeyId: first.apiKeyId })
    expect(before.second).toMatchObject({ kind: "agent", apiKeyId: second.apiKeyId })
    expect(before.roles).toBe(1)

    const res = await t.mutation(revokeOthers, { name: "n8n", keepApiKeyId: second.apiKeyId })
    expect(res.revoked).toEqual([first.apiKeyId])
    const after = await active()
    expect(after.first).toBeNull()
    expect(after.second).toMatchObject({ kind: "agent", apiKeyId: second.apiKeyId })
    expect(after.revoked[other.apiKeyId]).toBe(false)
    expect(after.revoked[foreignKey]).toBe(false)

    expect(await t.mutation(revokeOthers, { name: "n8n", keepApiKeyId: second.apiKeyId })).toEqual({ revoked: [] })
    await expect(t.mutation(revokeOthers, { name: "n8n", keepApiKeyId: first.apiKeyId })).rejects.toThrow(/NOT_FOUND/)
  })

  test("explicit roles are validated: the protected Admin role is refused; an unknown owner fails", async () => {
    const { t } = await setup()
    await expect(t.action(issue, { name: "n8n", roleKeys: ["system:admin"] })).rejects.toThrow(/protected_role|FORBIDDEN/)
    await expect(t.action(issue, { name: "n8n", ownerEmail: "nobody@acme.test" })).rejects.toThrow(/NOT_FOUND/)
  })
})
