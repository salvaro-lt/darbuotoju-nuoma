import { convexTest } from "convex-test"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { addDays, todayIso } from "@digimuza/staffing/pure"
import { weekStartOf } from "@digimuza/staffing/timesheets/pure"
import { api, internal } from "./_generated/api"
import type { Id } from "./_generated/dataModel"
import schema from "./schema"
import { modules } from "./test.setup"

// The timesheets area as installed in this app (convex/timesheets.ts), on the staffing demo data.

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

async function demoApp(t: T) {
  await t.mutation(internal.system.registerSystem, {})
  const superUser = t.withIdentity(SUPER)
  await superUser.mutation(api.system.completeSignIn, {})
  await superUser.mutation(api.system.setModuleEnabled, { moduleId: "staffing", enabled: true })
  await superUser.mutation(api.system.setModuleEnabled, { moduleId: "staffing-timesheets", enabled: true })
  await t.mutation(internal.staffing._seedDemo, {})
  expect((await t.mutation(internal.timesheets._seedDemo, {})).seeded).toBe(true)
  expect((await t.mutation(internal.timesheets._seedDemo, {})).seeded).toBe(false)
  return superUser
}

describe("timesheets", () => {
  test("a viewer reads but cannot write or approve; signed out is refused", async () => {
    const t = setup()
    const superUser = await demoApp(t)
    const { roleId } = (await superUser.mutation(api.system.createRole, { name: "Tabeliai skaitytojas", subroleIds: ["staffing-timesheets:viewer"] })) as { roleId: string }
    await superUser.action(api.system.createInvite, { email: ALICE.email, roleIds: [roleId] })
    const invite = sent.map((s) => String(s.body.text ?? "")).find((x) => x.includes("invite?token="))!
    const token = new URL(invite.match(/https:\/\/app\.test\/invite\?token=\S+/)![0]).searchParams.get("token")!
    const alice = t.withIdentity(ALICE)
    await alice.mutation(api.system.completeSignIn, { inviteToken: token })

    expect(await codeOf(t.query(api.timesheets.overview, {}))).toBe("UNAUTHENTICATED")
    expect(await codeOf(alice.query(api.timesheets.overview, {}))).toBe("OK")
    const [project] = await alice.query(api.timesheets.overview, {})
    expect(await codeOf(alice.mutation(api.timesheets.approveWeek, { projectId: project!.id, weekStart: weekStartOf(todayIso()) }))).toBe("FORBIDDEN")
    expect(await codeOf(alice.query(api.timesheets.listSubcontractors, {}))).toBe("FORBIDDEN")
  })

  test("seeded demo: late BST timesheet, NDS mismatches resolved, approval locks, approved hours and reminders", async () => {
    const t = setup()
    const admin = await demoApp(t)
    const overview = await admin.query(api.timesheets.overview, {})
    const nds = overview.find((p) => p.code === "NDS-2026-07")!
    const bst = overview.find((p) => p.code === "BST-2026-03")!
    expect(bst.due.late).toBe(true)
    expect(nds.due.late).toBe(false)

    // The last NDS client sheet has exactly the 4 deliberate mismatches.
    const sheets = await admin.query(api.timesheets.listClientSheets, { projectId: nds.id })
    const last = sheets[0]!
    const rec = (await admin.query(api.timesheets.getReconciliation, { sheetId: last.id as Id<"staffing_timesheets_clientSheets"> }))!
    const open = rec.reconciliation.lines.filter((l) => l.kind !== "ok")
    expect(open.map((l) => l.kind).sort()).toEqual(["diff", "diff", "missing_ours", "missing_theirs"])
    expect(rec.reconciliation.names.every((n) => n.workerId)).toBe(true)

    // Accepting the client's value changes our hours; the line turns ok.
    const diff = open.find((l) => l.kind === "diff" && l.diff === 2)!
    await admin.mutation(api.timesheets.resolveLine, { sheetId: last.id as never, key: diff.key, action: "accept_client" })
    const after = (await admin.query(api.timesheets.getReconciliation, { sheetId: last.id as never }))!
    expect(after.reconciliation.lines.find((l) => l.key === diff.key)?.kind).toBe("ok")

    // Approving the week locks it and exposes the hours to invoicing.
    const weekStart = last.periodFrom
    const before = await admin.query(api.timesheets.listApprovedHours, { projectId: nds.id, from: weekStart, to: addDays(weekStart, 6) })
    expect(before).toEqual([])
    await admin.mutation(api.timesheets.approveWeek, { projectId: nds.id, weekStart })
    const approved = await admin.query(api.timesheets.listApprovedHours, { projectId: nds.id, from: weekStart, to: addDays(weekStart, 6) })
    expect(approved.length).toBeGreaterThan(20)
    expect(approved.some((r) => r.overtime === 2 && r.trade === "WELD-MAG")).toBe(true)
    const grid = (await admin.query(api.timesheets.weekGrid, { projectId: nds.id, weekStart }))!
    const row = grid.rows.find((r) => Object.keys(r.entries).length)!
    expect(await codeOf(admin.mutation(api.timesheets.saveEntry, { assignmentId: row.assignmentId as never, date: weekStart, regularHours: 4, overtimeHours: 0 }))).toBe("CONFLICT")

    // Late reminder: without n8n env it is recorded as not configured; with it, posted to the webhook.
    vi.useFakeTimers()
    await admin.mutation(api.timesheets.sendReminder, { projectId: bst.id })
    await t.finishAllScheduledFunctions(vi.runAllTimers)
    expect((await admin.query(api.timesheets.overview, {})).find((p) => p.id === bst.id)?.lastReminder?.status).toBe("not_configured")
    vi.stubEnv("N8N_URL", "https://n8n.test")
    vi.stubEnv("N8N_WEBHOOK_SECRET", "s")
    expect((await t.mutation(internal.timesheets._dailyReminders, {})).queued).toBe(0) // reminded today already
    await admin.mutation(api.timesheets.sendReminder, { projectId: bst.id })
    await t.finishAllScheduledFunctions(vi.runAllTimers)
    const hook = sent.find((s) => s.url.endsWith("/webhook/dr-nuoma-tabelio-priminimas"))!
    expect(hook.body).toMatchObject({ to: "pm@bst.example", redirectTo: "super@acme.test", language: "en" })
  })
})
