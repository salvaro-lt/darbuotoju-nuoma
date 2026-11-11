import { convexTest } from "convex-test"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { api, internal } from "./_generated/api"
import schema from "./schema"
import { modules } from "./test.setup"

// Staffing area "teams" as installed in this app (convex/teams.ts), on the staffing demo data.

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

async function teamsApp() {
  const t = convexTest(schema, modules)
  await t.mutation(internal.system.registerSystem, {})
  const superUser = t.withIdentity(SUPER)
  await superUser.mutation(api.system.completeSignIn, {})
  for (const moduleId of ["staffing", "staffing-teams"]) await superUser.mutation(api.system.setModuleEnabled, { moduleId, enabled: true })
  await t.mutation(internal.staffing._seedDemo, {})
  expect(await t.mutation(internal.teams._seedDemo, {})).toEqual({ seeded: true, requests: 3 })
  return { t, superUser }
}

describe("teams", () => {
  test("viewer may read but not confirm; disabled module denies everything", async () => {
    const { t, superUser } = await teamsApp()
    const { roleId } = (await superUser.mutation(api.system.createRole, { name: "Teams viewer", subroleIds: ["staffing-teams:viewer", "staffing:viewer"] })) as { roleId: string }
    await superUser.action(api.system.createInvite, { email: ALICE.email, roleIds: [roleId] })
    const token = new URL(sent.at(-1)!.text.match(/https:\/\/app\.test\/invite\?token=\S+/)![0]).searchParams.get("token")!
    const alice = t.withIdentity(ALICE)
    await alice.mutation(api.system.completeSignIn, { inviteToken: token })

    const [first] = await alice.query(api.teams.listRequests, {})
    expect(first).toBeDefined()
    expect(await codeOf(alice.mutation(api.teams.confirmTeam, { requestId: first!.id, status: "confirmed" }))).toBe("FORBIDDEN")
    expect(await codeOf(alice.mutation(api.teams.requestClientDraft, { requestId: first!.id }))).toBe("FORBIDDEN")
    await superUser.mutation(api.system.setModuleEnabled, { moduleId: "staffing-teams", enabled: false })
    expect(await codeOf(alice.query(api.teams.listRequests, {}))).toBe("FORBIDDEN")
  })

  test("seeded requests: one fully covered and confirmed, one with gaps; double confirm refused", async () => {
    const { superUser } = await teamsApp()
    const requests = await superUser.query(api.teams.listRequests, { status: "open" })
    const covered = requests.find((r) => r.clientName.startsWith("Nordhavn"))!
    const gappy = requests.find((r) => r.clientName.startsWith("Fiktiv"))!

    const a = (await superUser.query(api.teams.getRequest, { requestId: covered.id }))!
    expect(a.proposal.selection).toHaveLength(a.request.needed)
    expect(a.proposal.gaps.filter((g) => g.kind === "people" || g.kind === "drivers")).toEqual([])
    // Workers of the shipyard's current project get the earlier-work bonus.
    expect(a.proposal.lines[0]!.ranked.some((r) => r.previousClientAssignments > 0)).toBe(true)

    const b = (await superUser.query(api.teams.getRequest, { requestId: gappy.id }))!
    expect(b.proposal.gaps.some((g) => g.kind === "people")).toBe(true)
    expect(b.proposal.gaps.some((g) => g.kind === "drivers")).toBe(true)
    expect(b.proposal.gapText.lt.join("\n")).toContain("subrangą")

    const res = await superUser.mutation(api.teams.confirmTeam, { requestId: covered.id, status: "confirmed" })
    expect(res.assignments).toBe(a.request.needed)
    const project = (await superUser.query(api.staffing.getProject, { projectId: res.projectId }))!
    expect(project.team.filter((m) => m.status === "confirmed")).toHaveLength(a.request.needed)
    expect(await codeOf(superUser.mutation(api.teams.confirmTeam, { requestId: covered.id, status: "confirmed" }))).toBe("CONFLICT")

    // Without N8N_URL the draft request is recorded as not configured.
    await superUser.mutation(api.teams.requestClientDraft, { requestId: gappy.id })
  })
})
