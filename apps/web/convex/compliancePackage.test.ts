import { convexTest } from "convex-test"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { api, internal } from "./_generated/api"
import type { Id } from "./_generated/dataModel"
import schema from "./schema"
import { modules } from "./test.setup"

// Client document package (DIG-113) as installed in this app (convex/compliance.ts):
// the seeded packages, one click / approve flows with a fake n8n, the public link guard.

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

async function seeded(t: T) {
  await t.mutation(internal.system.registerSystem, {})
  const admin = t.withIdentity(SUPER)
  await admin.mutation(api.system.completeSignIn, {})
  await admin.mutation(api.system.setModuleEnabled, { moduleId: "staffing", enabled: true })
  await admin.mutation(api.system.setModuleEnabled, { moduleId: "staffing-compliance", enabled: true })
  await t.mutation(internal.staffing._seedDemo, {})
  await t.mutation(internal.compliance._seedDemo, {})
  // scans → phase 1 (complete project) → scans → phase 2 (packages)
  await t.finishAllScheduledFunctions(vi.runAllTimers)
  const projects = await admin.query(api.compliance.listReadiness, {})
  const ready = projects.find((p) => p.code === "VSB-2026-14")!
  const blocked = projects.find((p) => p.code === "VSB-2026-12")!
  return { admin, ready: ready.id as Id<"staffing_projects">, blocked: blocked.id as Id<"staffing_projects"> }
}

const tokenOf = (url: string) => url.split("/d/")[1]!

describe("client document package", () => {
  test("seed: a ready package, one waiting for approval, and a send history; idempotent", async () => {
    const t = setup()
    const { admin, ready, blocked } = await seeded(t)
    const r = await admin.query(api.compliance.listPackages, { projectId: ready })
    expect(r.map((p) => p.status)).toEqual(["ready"])
    expect(r[0]!.missing).toEqual([])
    expect(r[0]!.fileCount).toBeGreaterThan(0)
    const b = await admin.query(api.compliance.listPackages, { projectId: blocked })
    expect(b.map((p) => p.status)).toEqual(["needs_approval", "sent"])
    expect(b[0]!.missing.map((g) => g.reason).sort()).toEqual(["expired", "missing"])
    expect(b[1]!.link?.downloads).toBe(1)
    // Running the seed again adds nothing.
    await t.mutation(internal.compliance._seedDemo, {})
    await t.finishAllScheduledFunctions(vi.runAllTimers)
    expect((await admin.query(api.compliance.listPackages, { projectId: blocked })).length).toBe(2)
  })

  test("complete package: one click → n8n webhook with the files attached, redirected outside production; logged on the worker", async () => {
    const t = setup()
    const { admin, ready } = await seeded(t)
    vi.stubEnv("N8N_URL", "https://n8n.test")
    vi.stubEnv("N8N_WEBHOOK_SECRET", "s3cret")
    sent = []
    const [pkg] = await admin.query(api.compliance.listPackages, { projectId: ready })
    await admin.mutation(api.compliance.sendPackage, { packageId: pkg!.id as Id<"staffing_compliance_packages"> })
    await t.finishAllScheduledFunctions(vi.runAllTimers)
    const hook = sent.find((s) => s.url === "https://n8n.test/webhook/dr-nuoma-dokumentu-paketas")!
    expect(hook.body).toMatchObject({ to: ["pm@vsb.example"], redirectTo: "super@acme.test", language: "nl" })
    expect((hook.body.attachments as unknown[]).length).toBe(pkg!.fileCount)
    expect(String(hook.body.text)).toContain("Geachte")
    expect(String(hook.body.text)).toContain("https://app.test/d/")
    expect(String(hook.body.text)).not.toContain("Missing:")
    const after = (await admin.query(api.compliance.listPackages, { projectId: ready }))[0]!
    expect(after).toMatchObject({ status: "sent", redirectedTo: "super@acme.test", approvedByName: "super@acme.test" })
    expect(after.link?.state).toBe("ok")
    const sends = await admin.query(api.compliance.workerPackageSends, { workerId: after.members[0]!.workerId as Id<"staffing_workers"> })
    expect(sends[0]).toMatchObject({ projectCode: "VSB-2026-14", to: ["pm@vsb.example"], missing: 0 })
    // Sent packages cannot be sent twice.
    expect(await codeOf(admin.mutation(api.compliance.sendPackage, { packageId: pkg!.id as Id<"staffing_compliance_packages"> }))).toBe("CONFLICT")
  })

  test("incomplete package: needs approval → send anyway without n8n → not configured, still downloadable; auto-send for complete ones", async () => {
    const t = setup()
    const { admin, ready, blocked } = await seeded(t)
    const created = await admin.mutation(api.compliance.createPackage, { projectId: blocked, recipients: [{ email: "Site@Client.example", name: "Site" }], language: "lt" })
    expect(created.status).toBe("needs_approval")
    expect(created.missing).toBe(2)
    await admin.mutation(api.compliance.sendPackage, { packageId: created.packageId })
    await t.finishAllScheduledFunctions(vi.runAllTimers)
    const p = (await admin.query(api.compliance.listPackages, { projectId: blocked }))[0]!
    expect(p).toMatchObject({ status: "not_configured", recipients: [{ email: "site@client.example", name: "Site" }] })
    expect(p.text).toContain("Trūksta:")
    expect(p.link?.state).toBe("ok")
    expect(sent.some((s) => s.url.includes("dokumentu-paketas"))).toBe(false)

    // "Siųsti automatiškai": a complete package goes out without another click.
    vi.stubEnv("N8N_URL", "https://n8n.test")
    vi.stubEnv("N8N_WEBHOOK_SECRET", "s3cret")
    await admin.mutation(api.compliance.setPackageSettings, { projectId: ready, autoSend: true })
    const auto = await admin.mutation(api.compliance.createPackage, { projectId: ready })
    expect(auto.status).toBe("queued")
    await t.finishAllScheduledFunctions(vi.runAllTimers)
    expect((await admin.query(api.compliance.listPackages, { projectId: ready }))[0]!.status).toBe("sent")

    // Cancelled packages stay in the log and cannot be sent.
    const again = await admin.mutation(api.compliance.createPackage, { projectId: blocked })
    await admin.mutation(api.compliance.cancelPackage, { packageId: again.packageId })
    expect(await codeOf(admin.mutation(api.compliance.sendPackage, { packageId: again.packageId }))).toBe("CONFLICT")
  })

  test("public link: works without a session, logs downloads, refuses expired, revoked and unknown tokens", async () => {
    const t = setup()
    const { admin, blocked } = await seeded(t)
    const [pkg] = await admin.query(api.compliance.listPackages, { projectId: blocked })
    const packageId = pkg!.id as Id<"staffing_compliance_packages">
    const { url } = await admin.mutation(api.compliance.createPackageLink, { packageId, days: 3 })
    const token = tokenOf(url)
    const shared = await t.query(api.compliance.getSharedPackage, { token })
    expect(shared.state).toBe("ok")
    if (shared.state !== "ok") return
    expect(shared.project.code).toBe("VSB-2026-12")
    expect(shared.missing.length).toBe(2)
    const zip = await t.mutation(api.compliance.openSharedPackage, { token, kind: "zip" })
    expect(zip.state).toBe("ok")
    expect(zip.files.length).toBe(pkg!.fileCount)
    const logged = (await admin.query(api.compliance.listPackages, { projectId: blocked }))[0]!
    expect(logged.link?.downloads).toBe(1)
    expect(logged.accesses.map((a) => a.kind)).toEqual(["zip"])

    expect((await t.query(api.compliance.getSharedPackage, { token: "x".repeat(32) })).state).toBe("not_found")
    expect((await t.query(api.compliance.getSharedPackage, { token: "../etc" })).state).toBe("not_found")
    await t.run(async (ctx) => {
      const link = (await ctx.db.query("staffing_compliance_packageLinks").collect()).find((l) => l.packageId === packageId && l.expiresAt > Date.now() + 2 * 86_400_000)!
      await ctx.db.patch(link._id, { expiresAt: Date.now() - 1 })
    })
    expect((await t.query(api.compliance.getSharedPackage, { token })).state).toBe("expired")
    expect((await t.mutation(api.compliance.openSharedPackage, { token, kind: "zip" })).files).toEqual([])
    const second = await admin.mutation(api.compliance.createPackageLink, { packageId })
    await admin.mutation(api.compliance.revokePackageLinks, { packageId })
    expect((await t.query(api.compliance.getSharedPackage, { token: tokenOf(second.url) })).state).toBe("revoked")
  })

  test("access: a viewer sees the log but cannot send; signed out is refused", async () => {
    const t = setup()
    const { admin, blocked } = await seeded(t)
    expect(await codeOf(t.mutation(api.compliance.createPackage, { projectId: blocked }))).toBe("UNAUTHENTICATED")
    const { roleId } = (await admin.mutation(api.system.createRole, { name: "Docs viewer", subroleIds: ["staffing-compliance:viewer"] })) as { roleId: string }
    await admin.action(api.system.createInvite, { email: ALICE.email, roleIds: [roleId] })
    const mail = sent.map((s) => JSON.stringify(s.body)).find((b) => b.includes("invite?token="))!
    const token = mail.match(/invite\?token=([^\s"\\]+)/)![1]!
    const alice = t.withIdentity(ALICE)
    await alice.mutation(api.system.completeSignIn, { inviteToken: decodeURIComponent(token) })
    expect(await codeOf(alice.query(api.compliance.listPackages, { projectId: blocked }))).toBe("OK")
    expect(await codeOf(alice.mutation(api.compliance.createPackage, { projectId: blocked }))).toBe("FORBIDDEN")
    const [pkg] = await alice.query(api.compliance.listPackages, { projectId: blocked })
    expect(await codeOf(alice.mutation(api.compliance.sendPackage, { packageId: pkg!.id as Id<"staffing_compliance_packages"> }))).toBe("FORBIDDEN")
  })
})
