import { convexTest } from "convex-test"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { api, internal } from "./_generated/api"
import schema from "./schema"
import { modules } from "./test.setup"

// The staffing base as installed in this app (convex/staffing.ts).

type T = ReturnType<typeof setup>
type User = ReturnType<T["withIdentity"]>
const setup = () => convexTest(schema, modules)

const ISSUER = "https://api.workos.com/user_management/client_TEST123"
const SUPER = { subject: "user_super", issuer: ISSUER, email: "super@acme.test", email_verified: true }
const ALICE = { subject: "user_alice", issuer: ISSUER, email: "alice@acme.test", email_verified: true }

let sent: { text: string }[] = []
beforeEach(() => {
  sent = []
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
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

async function staffingApp(t: T) {
  await t.mutation(internal.system.registerSystem, {})
  const superUser = t.withIdentity(SUPER)
  await superUser.mutation(api.system.completeSignIn, {})
  await superUser.mutation(api.system.setModuleEnabled, { moduleId: "staffing", enabled: true })
  return superUser
}

async function inviteWithRole(t: T, superUser: User, subroleIds: string[]) {
  const { roleId } = (await superUser.mutation(api.system.createRole, { name: `Role ${subroleIds.join("+")}`, subroleIds })) as { roleId: string }
  await superUser.action(api.system.createInvite, { email: ALICE.email, roleIds: [roleId] })
  const token = new URL(sent.at(-1)!.text.match(/https:\/\/app\.test\/invite\?token=\S+/)![0]).searchParams.get("token")!
  const alice = t.withIdentity(ALICE)
  await alice.mutation(api.system.completeSignIn, { inviteToken: token })
  return alice
}

describe("staffing: access", () => {
  test("signed out, missing permission and disabled module are denied", async () => {
    const t = setup()
    const superUser = await staffingApp(t)
    expect(await codeOf(t.query(api.staffing.listWorkers, {}))).toBe("UNAUTHENTICATED")
    const alice = await inviteWithRole(t, superUser, ["staffing:viewer"])
    expect(await codeOf(alice.query(api.staffing.listWorkers, {}))).toBe("OK")
    expect(await codeOf(alice.mutation(api.staffing.createTrade, { code: "X", nameLt: "X", nameEn: "X" }))).toBe("FORBIDDEN")
    await superUser.mutation(api.system.setModuleEnabled, { moduleId: "staffing", enabled: false })
    expect(await codeOf(alice.query(api.staffing.listWorkers, {}))).toBe("FORBIDDEN")
  })
})

describe("staffing: base", () => {
  test("worker, project and assignment: overlap refused, availability follows, writes audited", async () => {
    const t = setup()
    const admin = await staffingApp(t)
    const { id: weld } = await admin.mutation(api.staffing.createTrade, { code: "weld-mag", nameLt: "Suvirintojas", nameEn: "Welder" })
    const { id: passport } = await admin.mutation(api.staffing.createCertificateType, { name: "Pasas", mandatory: true, defaultValidityMonths: 120 })
    const { id: clientId } = await admin.mutation(api.staffing.createClient, {
      name: "Demo Client",
      code: "dc",
      kind: "client",
      country: "no",
      contacts: [],
      defaultRates: [{ tradeId: weld, hourlyRateCents: 4500 }],
      paymentTermsDays: 30,
      invoicingPeriod: "monthly",
      notes: "",
    })
    const worker = (firstName: string) => ({
      firstName,
      lastName: "Pavyzdys",
      phone: "+370 600 00000",
      nationality: "LT",
      languages: ["lt"],
      source: "own" as const,
      trades: [{ tradeId: weld, level: "skilled" as const }],
      driverLicenseCategories: [],
      clothingSizes: {},
      status: "active" as const,
      notes: "",
      homeCountry: "LT",
      homeCity: "Klaipėda",
    })
    const { id: jonas } = await admin.mutation(api.staffing.createWorker, worker("Jonas"))
    const { id: petras } = await admin.mutation(api.staffing.createWorker, worker("Petras"))
    await admin.mutation(api.staffing.addWorkerCertificate, { workerId: jonas, certificateTypeId: passport, issuedAt: "2025-01-01" })
    const { id: projectId } = await admin.mutation(api.staffing.createProject, {
      clientId,
      name: "Hull blocks",
      code: "dc-1",
      country: "NO",
      city: "Bergen",
      startDate: "2030-01-01",
      endDate: "2030-02-28",
      status: "active",
      rates: [],
      notes: "",
    })
    await admin.mutation(api.staffing.createAssignment, { projectId, workerId: jonas, tradeId: weld, startDate: "2030-01-01", endDate: "2030-02-28", status: "confirmed" })
    expect(await codeOf(admin.mutation(api.staffing.createAssignment, { projectId, workerId: jonas, tradeId: weld, startDate: "2030-02-01", status: "active" }))).toBe("CONFLICT")

    const free = await admin.query(api.staffing.findAvailableWorkers, { from: "2030-01-15", to: "2030-01-20", trades: [weld] })
    expect(free.map((w) => w.firstName)).toEqual(["Petras"])
    // Petras has no passport (mandatory): filtered out when certificates are required.
    expect(await admin.query(api.staffing.findAvailableWorkers, { from: "2030-03-01", to: "2030-03-10", requireValidCertsOn: "2030-03-10" })).toHaveLength(1)

    const card = (await admin.query(api.staffing.getWorker, { workerId: jonas, onDate: "2029-12-01" }))!
    expect(card.certificates[0]!.expiresAt).toBe("2035-01-01")
    expect(card.next?.projectCode).toBe("DC-1")
    const petrasCard = (await admin.query(api.staffing.getWorker, { workerId: petras }))!
    expect(petrasCard.worker.certStatus).toBe("missing")

    const team = (await admin.query(api.staffing.getProject, { projectId }))!.team
    expect(team.map((m) => m.worker.firstName)).toEqual(["Jonas"])

    const audit = await admin.query(api.system.listAudit, { actionPrefix: "staffing." })
    const actions = (audit as { items: { action: string }[] }).items.map((e) => e.action)
    expect(actions).toEqual(expect.arrayContaining(["staffing.trade.create", "staffing.worker.create", "staffing.certificate.create", "staffing.project.create", "staffing.assignment.create"]))
  })

  test("demo seed runs and is idempotent", async () => {
    const t = setup()
    const admin = await staffingApp(t)
    const res = await t.mutation(internal.staffing._seedDemo, {})
    expect(res).toMatchObject({ seeded: true, workers: 25, projects: 3 })
    expect((await t.mutation(internal.staffing._seedDemo, {})).seeded).toBe(false)
    const workers = await admin.query(api.staffing.listWorkers, { status: "active" })
    expect(workers.length).toBe(24)
    expect(workers.some((w) => w.certStatus === "expiring30")).toBe(true)
  })
})
