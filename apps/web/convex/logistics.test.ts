import { convexTest } from "convex-test"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { api, internal } from "./_generated/api"
import type { Id } from "./_generated/dataModel"
import schema from "./schema"
import { modules } from "./test.setup"

// The logistics area (module staffing-logistics) as installed in this app (convex/logistics.ts).

type T = ReturnType<typeof setup>
const setup = () => convexTest(schema, modules)

const ISSUER = "https://api.workos.com/user_management/client_TEST123"
const SUPER = { subject: "user_super", issuer: ISSUER, email: "super@acme.test", email_verified: true }
const ALICE = { subject: "user_alice", issuer: ISSUER, email: "alice@acme.test", email_verified: true }

let sent: { url: string; body: Record<string, unknown> }[] = []
beforeEach(() => {
  sent = []
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    sent.push({ url: String(url), body: JSON.parse(String(init.body)) })
    return new Response("{}", { status: 200 })
  })
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

const codeOf = async (p: Promise<unknown>) => {
  try {
    await p
    return "OK"
  } catch (e) {
    return (e as { data?: { code?: string } }).data?.code ?? String(e)
  }
}

async function logisticsApp(t: T) {
  await t.mutation(internal.system.registerSystem, {})
  const superUser = t.withIdentity(SUPER)
  await superUser.mutation(api.system.completeSignIn, {})
  for (const moduleId of ["staffing", "staffing-logistics"]) await superUser.mutation(api.system.setModuleEnabled, { moduleId, enabled: true })
  await t.mutation(internal.staffing._seedDemo, {})
  await t.mutation(internal.logistics._seedDemo, {})
  const projects = await superUser.query(api.logistics.listProjects, {})
  const nds = projects.find((p) => p.code === "NDS-2026-07")!
  return { superUser, nds, projects }
}

async function inviteWithRole(t: T, superUser: ReturnType<T["withIdentity"]>, subroleIds: string[]) {
  const { roleId } = (await superUser.mutation(api.system.createRole, { name: `Role ${subroleIds.join("+")}`, subroleIds })) as { roleId: string }
  await superUser.action(api.system.createInvite, { email: ALICE.email, roleIds: [roleId] })
  const mail = sent.at(-1)!.body as { text: string }
  const token = new URL(mail.text.match(/https:\/\/app\.test\/invite\?token=\S+/)![0]).searchParams.get("token")!
  const alice = t.withIdentity(ALICE)
  await alice.mutation(api.system.completeSignIn, { inviteToken: token })
  return alice
}

describe("logistics: access", () => {
  test("signed out, viewer writing and disabled module are denied", async () => {
    const t = setup()
    const { superUser, nds } = await logisticsApp(t)
    expect(await codeOf(t.query(api.logistics.getPlan, { projectId: nds.projectId }))).toBe("UNAUTHENTICATED")
    const alice = await inviteWithRole(t, superUser, ["staffing-logistics:viewer"])
    expect(await codeOf(alice.query(api.logistics.getPlan, { projectId: nds.projectId }))).toBe("OK")
    expect(await codeOf(alice.mutation(api.logistics.autoAssign, { projectId: nds.projectId, kind: "beds" }))).toBe("FORBIDDEN")
    await superUser.mutation(api.system.setModuleEnabled, { moduleId: "staffing-logistics", enabled: false })
    expect(await codeOf(alice.query(api.logistics.getPlan, { projectId: nds.projectId }))).toBe("FORBIDDEN")
  })
})

describe("logistics: demo plan", () => {
  test("seeded problems show as warnings; plan change is detected and acknowledged", async () => {
    const t = setup()
    const { superUser, nds, projects } = await logisticsApp(t)
    expect(projects.map((p) => p.code).sort()).toEqual(["BST-2026-03", "FST-2026-11", "NDS-2026-07"])
    const plan = (await superUser.query(api.logistics.getPlan, { projectId: nds.projectId }))!
    const kinds = plan.plan.warnings.map((w) => w.kind)
    expect(kinds).toEqual(expect.arrayContaining(["beds_short", "no_bed", "travel_unbooked", "sizes_missing"]))
    expect(kinds.filter((k) => k === "travel_unbooked")).toHaveLength(2)
    expect(plan.diff?.added.map((e) => e.name)).toEqual(["Jānis Paraugs"])

    const bst = projects.find((p) => p.code === "BST-2026-03")!
    const bstPlan = (await superUser.query(api.logistics.getPlan, { projectId: bst.projectId }))!
    expect(bstPlan.plan.warnings.map((w) => w.kind)).toEqual(expect.arrayContaining(["vehicle_no_driver", "empty_beds"]))

    await superUser.mutation(api.logistics.acknowledgePlan, { projectId: nds.projectId })
    const after = (await superUser.query(api.logistics.getPlan, { projectId: nds.projectId }))!
    expect(after.diff).toEqual({ added: [], removed: [], changed: [] })
    expect((await t.mutation(internal.logistics._seedDemo, {})).seeded).toBe(false)
  })

  test("allocation: non-driver refused as driver; auto-assign seats; notify without n8n records not_configured", async () => {
    vi.useFakeTimers()
    const t = setup()
    const { superUser, nds } = await logisticsApp(t)
    const plan = (await superUser.query(api.logistics.getPlan, { projectId: nds.projectId }))!
    const van = plan.vehicles[0]!.id as Id<"staffing_logistics_vehicles">
    const nonDriver = plan.members.find((m) => !m.isDriver)!
    expect(await codeOf(superUser.mutation(api.logistics.setAllocation, { projectId: nds.projectId, workerId: nonDriver.workerId as Id<"staffing_workers">, vehicleId: van, driver: true }))).toBe("VALIDATION")
    const { assigned } = await superUser.mutation(api.logistics.autoAssign, { projectId: nds.projectId, kind: "seats" })
    expect(assigned).toBe(1)

    const res = await superUser.mutation(api.logistics.notifyCoordinator, { projectId: nds.projectId })
    expect(res.lines).toBeGreaterThan(0)
    await t.finishAllScheduledFunctions(vi.runAllTimers)
    vi.useRealTimers()
    const after = (await superUser.query(api.logistics.getPlan, { projectId: nds.projectId }))!
    expect(after.notifications[0]?.status).toBe("not_configured")
  })

  test("with n8n configured, the webhook gets title, lines and redirectTo", async () => {
    vi.useFakeTimers()
    vi.stubEnv("N8N_URL", "https://n8n.test")
    vi.stubEnv("N8N_WEBHOOK_SECRET", "test-secret")
    const t = setup()
    const { superUser, nds } = await logisticsApp(t)
    sent = []
    await superUser.mutation(api.logistics.notifyCoordinator, { projectId: nds.projectId })
    await t.finishAllScheduledFunctions(vi.runAllTimers)
    vi.useRealTimers()
    expect(sent).toHaveLength(1)
    expect(sent[0]!.url).toBe("https://n8n.test/webhook/dr-nuoma-pranesimas")
    expect(sent[0]!.body).toMatchObject({ redirectTo: "super@acme.test", title: expect.stringContaining("NDS-2026-07") })
    expect((sent[0]!.body.lines as string[]).some((l) => l.includes("Trūksta lovų"))).toBe(true)
  })
})

describe("logistics: housing pool (DIG-110)", () => {
  test("guard: viewer reads but can't place people or log fuel; module off denies; seed refuses in production", async () => {
    const t = setup()
    const { superUser } = await logisticsApp(t)
    await t.mutation(internal.logistics._seedHousing, {})
    expect(await codeOf(t.query(api.logistics.housingOverview, {}))).toBe("UNAUTHENTICATED")
    const alice = await inviteWithRole(t, superUser, ["staffing-logistics:viewer"])
    const view = await alice.query(api.logistics.housingOverview, {})
    const flat = view.flats[0]!
    const worker = view.workers[0]!
    expect(await codeOf(alice.mutation(api.logistics.saveStay, { accommodationId: flat.id as Id<"staffing_logistics_accommodations">, workerId: worker.workerId as Id<"staffing_workers">, startDate: view.today }))).toBe("FORBIDDEN")
    expect(await codeOf(alice.mutation(api.logistics.autoAllocateHousing, { region: "Rotterdam" }))).toBe("FORBIDDEN")
    const fleet = await alice.query(api.logistics.fleetOverview, {})
    expect(await codeOf(alice.mutation(api.logistics.addVehicleLog, { vehicleId: fleet.vehicles[0]!.id as Id<"staffing_logistics_vehicles">, date: view.today, kind: "fuel", km: 100, litres: 9, costCents: 1700 }))).toBe("FORBIDDEN")
    await superUser.mutation(api.system.setModuleEnabled, { moduleId: "staffing-logistics", enabled: false })
    expect(await codeOf(alice.query(api.logistics.housingOverview, {}))).toBe("FORBIDDEN")
    vi.stubEnv("APP_ENV", "production")
    expect(await codeOf(t.mutation(internal.logistics._seedHousing, { reset: true }))).toContain("refuses")
  })

  test("seeded Rotterdam pool: flags, consolidation, incoming team, costs per project", async () => {
    const t = setup()
    const { superUser } = await logisticsApp(t)
    expect(await t.mutation(internal.logistics._seedHousing, {})).toMatchObject({ seeded: true, flats: 6, vehicles: 5 })
    expect(await t.mutation(internal.logistics._seedHousing, {})).toMatchObject({ seeded: false })

    const view = await superUser.query(api.logistics.housingOverview, { region: "Rotterdam" })
    expect(view.region).toBe("Rotterdam")
    expect(view.regions).toEqual(expect.arrayContaining(["Rotterdam", "Bergen", "Hamburg"]))
    expect(view.flats).toHaveLength(6)
    const byName = (s: string) => view.flats.find((f) => f.name.startsWith(s))!
    expect(byName("Vlaardingen").flags.map((f) => f.kind)).toEqual(expect.arrayContaining(["lonely", "no_driver"]))
    expect(byName("Spijkenisse").flags.map((f) => f.kind)).toContain("under_occupied")
    expect(new Set(byName("Schiedam").residents.flatMap((r) => r.projectCodes)).size).toBeGreaterThan(1)
    expect(view.totals.emptyBedCents).toBeGreaterThan(0)
    expect(view.incoming.map((i) => i.projectCode)).toEqual(["SBP-2026-05", "SBP-2026-05", "SBP-2026-05"])
    const vl = view.suggestions.find((s) => s.sourceName.startsWith("Vlaardingen"))!
    expect(vl.moves[0]!.toName).toMatch(/^Dordrecht/)
    expect(vl.monthlySavingCents).toBe(295000)

    // Incoming Filipinos fill paid beds first, never with the Ukrainian-only speakers.
    const auto = await superUser.mutation(api.logistics.autoAllocateHousing, { region: "Rotterdam" })
    expect(auto.placed).toHaveLength(3)
    expect(auto.placed.every((p) => !p.flatName.startsWith("Dordrecht") && !p.flatName.startsWith("Vlaardingen"))).toBe(true)

    // Apply the move: Vlaardingen is empty from tomorrow.
    await superUser.mutation(api.logistics.applyConsolidation, { sourceId: vl.sourceId as Id<"staffing_logistics_accommodations"> })
    const after = await superUser.query(api.logistics.housingOverview, { region: "Rotterdam" })
    expect(after.flats.find((f) => f.id === vl.sourceId)!.upcoming).toHaveLength(0)
    expect(after.flats.find((f) => f.name.startsWith("Dordrecht"))!.upcoming.map((r) => r.name)).toContain(vl.moves[0]!.workerName)
    expect(after.incoming).toHaveLength(0)

    // A full flat refuses one more person.
    const charlois = after.flats.find((f) => f.name.startsWith("Rotterdam-Charlois"))!
    const housed = new Set(after.flats.flatMap((f) => [...f.residents, ...f.upcoming].map((r) => r.workerId)))
    const extra = after.workers.find((w) => !housed.has(w.workerId))!
    expect(await codeOf(superUser.mutation(api.logistics.saveStay, { accommodationId: charlois.id as Id<"staffing_logistics_accommodations">, workerId: extra.workerId as Id<"staffing_workers">, startDate: after.today }))).toBe("CONFLICT")

    const costs = await superUser.query(api.logistics.housingCosts, { from: after.monthFrom, to: after.monthTo })
    expect(costs.projects.map((p) => p.projectCode)).toEqual(expect.arrayContaining(["VSW-2026-14", "VSW-2026-15", "SBP-2026-02"]))
    expect(costs.projects.find((p) => p.projectCode === "VSW-2026-15")!.vehicleCents).toBeGreaterThan(0)

    const fleet = await superUser.query(api.logistics.fleetOverview, { region: "Rotterdam" })
    expect(fleet.vehicles).toHaveLength(5)
    expect(fleet.vehicles.filter((v) => v.ownership === "owned")).toHaveLength(3)
    expect(fleet.totals.km).toBeGreaterThan(0)
  })
})
