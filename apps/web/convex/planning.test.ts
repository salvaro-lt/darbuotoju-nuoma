import { convexTest } from "convex-test"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { addDays, mondayOf, nextMonday, todayIso } from "@digimuza/staffing"
import { api, internal } from "./_generated/api"
import schema from "./schema"
import { modules } from "./test.setup"

// Staffing area "planning" as installed in this app (convex/planning.ts), on the staffing, teams and planning demo data.

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

async function planningApp() {
  const t = convexTest(schema, modules)
  await t.mutation(internal.system.registerSystem, {})
  const superUser = t.withIdentity(SUPER)
  await superUser.mutation(api.system.completeSignIn, {})
  for (const moduleId of ["staffing", "staffing-teams", "staffing-planning"]) await superUser.mutation(api.system.setModuleEnabled, { moduleId, enabled: true })
  await t.mutation(internal.staffing._seedDemo, {})
  await t.mutation(internal.teams._seedDemo, {})
  const seeded = await t.mutation(internal.planning._seedDemo, {})
  expect(seeded.seeded).toBe(true)
  return { t, superUser }
}

async function signIn(t: Awaited<ReturnType<typeof planningApp>>["t"], superUser: Awaited<ReturnType<typeof planningApp>>["superUser"], subroleIds: string[]) {
  const { roleId } = (await superUser.mutation(api.system.createRole, { name: "Planning test", subroleIds })) as { roleId: string }
  await superUser.action(api.system.createInvite, { email: ALICE.email, roleIds: [roleId] })
  const token = new URL(sent.at(-1)!.text.match(/https:\/\/app\.test\/invite\?token=\S+/)![0]).searchParams.get("token")!
  const alice = t.withIdentity(ALICE)
  await alice.mutation(api.system.completeSignIn, { inviteToken: token })
  return alice
}

describe("planning", () => {
  test("viewer reads the board but cannot mark rest or feedback; disabled module denies everything", async () => {
    const { t, superUser } = await planningApp()
    const alice = await signIn(t, superUser, ["staffing-planning:viewer", "staffing:viewer"])
    const board = await alice.query(api.planning.getBoard, {})
    expect(board.weeks).toHaveLength(8)
    const someone = board.rows[0]!.worker.id as never
    expect(await codeOf(alice.mutation(api.planning.addAvailability, { workerId: someone, kind: "rest", startDate: todayIso(), endDate: addDays(todayIso(), 13) }))).toBe("FORBIDDEN")
    const settings = await alice.query(api.planning.getSettings, {})
    expect(await codeOf(alice.mutation(api.planning.setFeedback, { workerId: someone, clientId: settings.clients[0]!.id as never, verdict: "suitable" }))).toBe("FORBIDDEN")
    await superUser.mutation(api.system.setModuleEnabled, { moduleId: "staffing-planning", enabled: false })
    expect(await codeOf(alice.query(api.planning.getBoard, {}))).toBe("FORBIDDEN")
  })

  test("seed is idempotent and refuses in production", async () => {
    const { t } = await planningApp()
    expect((await t.mutation(internal.planning._seedDemo, {})).seeded).toBe(false)
    const again = await t.mutation(internal.planning._seedDemo, { reset: true })
    expect(again).toMatchObject({ seeded: true, workers: 0, requests: 0, capacities: 6, rules: 3, feedback: 5 })
    vi.stubEnv("APP_ENV", "production")
    try {
      expect(await codeOf(t.mutation(internal.planning._seedDemo, {}))).toContain("refuses")
    } finally {
      vi.unstubAllEnvs()
    }
  })

  test("the interview's week: 20 welders from Monday, rest respected, ending projects free people a week later", async () => {
    const { superUser } = await planningApp()
    const today = todayIso()
    const monday = nextMonday(today)
    const trades = await superUser.query(api.staffing.listTrades, {})
    const welding = trades.filter((x) => x.code.startsWith("WELD")).map((x) => x.id)
    const a = await superUser.query(api.planning.capacity, { tradeIds: welding, count: 20, from: monday })
    // Six of the nine from the dock project could go on; three go home to rest (the welders among them are not counted).
    expect(a.freedByEnding.map((p) => p.name)).toEqual(expect.arrayContaining(["Jose Halimbawa", "Taras Prykladnyi"]))
    expect(a.freedByEnding.map((p) => p.name)).not.toContain("Bohdan Testiuk")
    expect(a.backFromRest.map((p) => p.name)).toContain("Sigitas Mėgintojas")
    expect(a.subcontractorTotal).toBeGreaterThan(0)
    expect(a.total).toBe(a.ownFree.length + a.freedByEnding.length + a.backFromRest.length + a.subcontractorTotal)
    expect(a.shortfall).toBe(Math.max(0, 20 - a.total))
    // The Botlek project ends next Friday: its welders are free a week later.
    expect(a.freedLater.map((p) => p.name)).toContain("Marius Mėginėlis")
    expect(a.reply.lt.client).toContain("suvirintojų")

    const board = await superUser.query(api.planning.getBoard, {})
    const week1 = board.weeks.find((w) => w.start === monday)!
    const mag = trades.find((x) => x.code === "WELD-MAG")!.id
    expect(week1.trades.find((x) => x.tradeId === mag)!.demand).toBeGreaterThanOrEqual(18)
    const bohdan = board.rows.find((r) => r.worker.name === "Bohdan Testiuk")!
    expect(bohdan.cells[board.weeks.indexOf(week1)]!.state).toBe("rest")
    const marius = board.rows.find((r) => r.worker.name === "Marius Mėginėlis")!
    expect(marius.status.state).toBe("working")
    expect(marius.cells[board.weeks.indexOf(week1)]!.state).toBe("ending")

    // listAvailableWorkers (base) respects rest periods too.
    const free = await superUser.query(api.staffing.findAvailableWorkers, { from: monday, to: addDays(monday, 6), trades: [mag] })
    expect(free.map((w) => w.fullName)).not.toContain("Bohdan Testiuk")
    expect(free.map((w) => w.fullName)).toContain("Jose Halimbawa")
  })

  test("teams: unsuitable feedback excludes the worker for that client; rules and subcontractor capacity show", async () => {
    const { superUser } = await planningApp()
    const requests = await superUser.query(api.teams.listRequests, { status: "open" })
    const rdw = requests.find((r) => r.clientName.startsWith("Rotterdamse"))!
    const p = (await superUser.query(api.teams.getRequest, { requestId: rdw.id }))!
    const rodel = p.proposal.lines[0]!.ranked.find((r) => r.name === "Rodel Halimbawa")!
    expect(rodel.eligible).toBe(false)
    expect(rodel.warnings.map((w) => w.code)).toContain("client_unsuitable")
    expect(p.proposal.selection.map((s) => s.workerId)).not.toContain(rodel.workerId)
    // Jose worked for this client twice and is marked suitable.
    const jose = p.proposal.lines[0]!.ranked.find((r) => r.name === "Jose Halimbawa")!
    expect(jose.previousClientAssignments).toBe(2)
    expect(jose.clientFeedback).toBe("suitable")
    expect(p.proposal.rules).toMatchObject({ driversPerPeople: 4, english: "housing", stored: true })
    expect(p.proposal.ruleWarnings.some((w) => w.code === "housing")).toBe(true)
    expect(p.proposal.gaps.some((g) => g.kind === "subcontractor_capacity")).toBe(true)

    // Planner flags a worker on the card: history and verdict per client.
    const card = (await superUser.query(api.planning.getWorkerPlanning, { workerId: jose.workerId as never }))!
    expect(card.history.find((h) => h.clientName.startsWith("Rotterdamse"))).toMatchObject({ times: 2, feedback: { verdict: "suitable" } })
    // The dock project ends this Friday (on a weekend it already has).
    expect(card.status.state).toBe(addDays(mondayOf(todayIso()), 4) >= todayIso() ? "working" : "reserve")
  })

  test("rest period: added on the card, the worker drops out of availability, deleted again", async () => {
    const { superUser } = await planningApp()
    const monday = nextMonday(todayIso())
    const trades = await superUser.query(api.staffing.listTrades, {})
    const mag = trades.find((x) => x.code === "WELD-MAG")!.id
    const before = await superUser.query(api.staffing.findAvailableWorkers, { from: monday, to: addDays(monday, 13), trades: [mag] })
    const dennis = before.find((w) => w.fullName === "Dennis Pagsubok")!
    const { id } = await superUser.mutation(api.planning.addAvailability, { workerId: dennis.id, kind: "rest", startDate: addDays(monday, 7), endDate: addDays(monday, 20), note: "Namo" })
    const after = await superUser.query(api.staffing.findAvailableWorkers, { from: monday, to: addDays(monday, 13), trades: [mag] })
    expect(after.map((w) => w.id)).not.toContain(dennis.id)
    expect(await codeOf(superUser.mutation(api.planning.addAvailability, { workerId: dennis.id, kind: "rest", startDate: monday, endDate: addDays(monday, -1) }))).toBe("VALIDATION")
    await superUser.mutation(api.planning.deleteAvailability, { availabilityId: id })
    const back = await superUser.query(api.staffing.findAvailableWorkers, { from: monday, to: addDays(monday, 13), trades: [mag] })
    expect(back.map((w) => w.id)).toContain(dennis.id)
  })
})
