import { convexTest } from "convex-test"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { api, internal } from "./_generated/api"
import schema from "./schema"
import { modules } from "./test.setup"

// The staffing area "compliance" as installed in this app (convex/compliance.ts).

type T = ReturnType<typeof setup>
const setup = () => convexTest(schema, modules)

const ISSUER = "https://api.workos.com/user_management/client_TEST123"
const SUPER = { subject: "user_super", issuer: ISSUER, email: "super@acme.test", email_verified: true }
const ALICE = { subject: "user_alice", issuer: ISSUER, email: "alice@acme.test", email_verified: true }

let sent: { url: string; body: Record<string, unknown> }[] = []
beforeEach(() => {
  sent = []
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    sent.push({ url: String(url), body: JSON.parse(String(init.body)) })
    return new Response("{}", { status: 200 })
  })
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
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

async function complianceApp(t: T) {
  await t.mutation(internal.system.registerSystem, {})
  const superUser = t.withIdentity(SUPER)
  await superUser.mutation(api.system.completeSignIn, {})
  await superUser.mutation(api.system.setModuleEnabled, { moduleId: "staffing", enabled: true })
  await superUser.mutation(api.system.setModuleEnabled, { moduleId: "staffing-compliance", enabled: true })
  return superUser
}

async function viewer(t: T, superUser: ReturnType<T["withIdentity"]>) {
  const { roleId } = (await superUser.mutation(api.system.createRole, { name: "Docs viewer", subroleIds: ["staffing-compliance:viewer"] })) as { roleId: string }
  await superUser.action(api.system.createInvite, { email: ALICE.email, roleIds: [roleId] })
  const mail = sent.map((s) => JSON.stringify(s.body)).find((b) => b.includes("invite?token="))!
  const token = mail.match(/invite\?token=([^\s"\\]+)/)![1]!
  const alice = t.withIdentity(ALICE)
  await alice.mutation(api.system.completeSignIn, { inviteToken: decodeURIComponent(token) })
  return alice
}

describe("compliance: access", () => {
  test("signed out, a viewer sending the digest, and the module off are denied", async () => {
    const t = setup()
    const superUser = await complianceApp(t)
    expect(await codeOf(t.query(api.compliance.listExpiring, {}))).toBe("UNAUTHENTICATED")
    const alice = await viewer(t, superUser)
    expect(await codeOf(alice.query(api.compliance.listExpiring, {}))).toBe("OK")
    expect(await codeOf(alice.mutation(api.compliance.sendDigest, {}))).toBe("FORBIDDEN")
    await superUser.mutation(api.system.setModuleEnabled, { moduleId: "staffing-compliance", enabled: false })
    expect(await codeOf(alice.query(api.compliance.listExpiring, {}))).toBe("FORBIDDEN")
  })
})

describe("compliance: demo flow", () => {
  test("seed → readiness shows two blockers → contract generated → digest sent once via n8n", async () => {
    const t = setup()
    const admin = await complianceApp(t)
    await t.mutation(internal.staffing._seedDemo, {})
    const seeded = await t.mutation(internal.compliance._seedDemo, {})
    expect(seeded).toMatchObject({ seeded: true, contracts: 5 })
    expect((await t.mutation(internal.compliance._seedDemo, {})).seeded).toBe(false)

    const projects = await admin.query(api.compliance.listReadiness, {})
    const vsb = projects.find((p) => p.code === "VSB-2026-12")!
    expect(vsb.readiness).toBe("blocked")
    expect(vsb.counts.blocked).toBe(2)
    const r = (await admin.query(api.compliance.getProjectReadiness, { projectId: vsb.id }))!
    expect(r.rows.filter((x) => x.readiness === "blocked").map((x) => x.blockers)).toEqual([["VCA / SCC"], ["VCA / SCC"]])

    const [tpl] = await admin.query(api.compliance.listTemplates, {})
    const res = await admin.mutation(api.compliance.generateContract, { templateId: tpl!.id as never, assignmentId: r.rows[0]!.assignmentId, hourlyRateCents: 1850 })
    const c = (await admin.query(api.compliance.getContract, { contractId: res.id }))!
    expect(c.body).toContain(r.rows[0]!.workerName)
    expect(c.body).toContain("VSB-2026-12")

    // Not configured: nothing sent, nothing remembered.
    await admin.mutation(api.compliance.sendDigest, {})
    await t.finishAllScheduledFunctions(vi.runAllTimers)
    expect((await admin.query(api.compliance.listDigestRuns, {}))[0]!.status).toBe("not_configured")

    vi.stubEnv("N8N_URL", "https://n8n.test")
    vi.stubEnv("N8N_WEBHOOK_SECRET", "s3cret")
    sent = []
    const first = await admin.mutation(api.compliance.sendDigest, {})
    expect(first.items).toBeGreaterThan(0)
    await t.finishAllScheduledFunctions(vi.runAllTimers)
    const hook = sent.find((s) => s.url === "https://n8n.test/webhook/dr-nuoma-dokumentu-galiojimas")!
    expect(hook.body).toMatchObject({ to: "super@acme.test", redirectTo: "super@acme.test" })
    expect((hook.body.items as unknown[]).length).toBe(first.items)
    expect((await admin.query(api.compliance.listDigestRuns, {}))[0]!.status).toBe("sent")
    expect((await admin.mutation(api.compliance.sendDigest, {})).items).toBe(0)
  })
})
