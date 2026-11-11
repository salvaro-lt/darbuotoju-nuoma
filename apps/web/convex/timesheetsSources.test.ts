import { convexTest } from "convex-test"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { addDays, todayIso } from "@digimuza/staffing/pure"
import { weekStartOf } from "@digimuza/staffing/timesheets/pure"
import { api, internal } from "./_generated/api"
import type { Id } from "./_generated/dataModel"
import schema from "./schema"
import { modules } from "./test.setup"

// DIG-111 as installed in this app: the worker's personal link (/h/<token>),
// the three-source comparison, disputes and the email intake of client PDFs.

type T = ReturnType<typeof setup>
const setup = () => convexTest(schema, modules)

const ISSUER = "https://api.workos.com/user_management/client_TEST123"
const SUPER = { subject: "user_super", issuer: ISSUER, email: "super@acme.test", email_verified: true }

let sent: { url: string; body: Record<string, unknown> }[] = []
beforeEach(() => {
  sent = []
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    sent.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : {} })
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
  const seeded = await t.mutation(internal.timesheets._seedDemo, {})
  expect(seeded.sources.links).toBeGreaterThan(5)
  expect(seeded.sources.disputes).toBe(5)
  expect((await t.mutation(internal.timesheets._seedDemo, {})).seeded).toBe(false)
  const nds = (await superUser.query(api.timesheets.overview, {})).find((p) => p.code === "NDS-2026-07")!
  const bst = (await superUser.query(api.timesheets.overview, {})).find((p) => p.code === "BST-2026-03")!
  return { admin: superUser, nds, bst }
}

describe("timesheets: worker personal link", () => {
  test("bad tokens are refused and reveal nothing; a disabled module says unavailable", async () => {
    const t = setup()
    const { admin, nds } = await demoApp(t)
    for (const token of ["", "short", "../../etc/passwd", "x".repeat(200), "demo-nobody-000000000000"]) {
      expect(await t.query(api.timesheets.workerPortal, { token })).toEqual({ state: "not_found" })
      expect(await codeOf(t.mutation(api.timesheets.saveMyHours, { token, date: addDays(todayIso(), -1), regularHours: 8, overtimeHours: 0 }))).toBe("NOT_FOUND")
      expect(await codeOf(t.mutation(api.timesheets.flagMyDay, { token, date: addDays(todayIso(), -1), comment: "x" }))).toBe("NOT_FOUND")
    }
    // A regenerated link kills the old token.
    const links = (await admin.query(api.timesheets.listWorkerLinks, { projectId: nds.id }))!
    const row = links.rows.find((r) => r.link)!
    const old = row.link!.token
    expect((await t.query(api.timesheets.workerPortal, { token: old })).state).toBe("ok")
    const { token: fresh } = await admin.mutation(api.timesheets.regenerateWorkerLink, { workerId: row.workerId as Id<"staffing_workers"> })
    expect(await t.query(api.timesheets.workerPortal, { token: old })).toEqual({ state: "not_found" })
    expect((await t.query(api.timesheets.workerPortal, { token: fresh })).state).toBe("ok")
    // Module off: the page says so, writes are refused.
    await admin.mutation(api.system.setModuleEnabled, { moduleId: "staffing-timesheets", enabled: false })
    expect(await t.query(api.timesheets.workerPortal, { token: fresh })).toEqual({ state: "unavailable" })
    expect(await codeOf(t.mutation(api.timesheets.saveMyHours, { token: fresh, date: addDays(todayIso(), -1), regularHours: 8, overtimeHours: 0 }))).toBe("UNAVAILABLE")
    // Link management needs a signed-in coordinator.
    expect(await codeOf(t.query(api.timesheets.listWorkerLinks, { projectId: nds.id }))).toBe("UNAUTHENTICATED")
  })

  test("the worker enters hours, sees the client's, says 'nesutinku'; the coordinator sees three sources", async () => {
    const t = setup()
    const { admin, nds } = await demoApp(t)
    const links = (await admin.query(api.timesheets.listWorkerLinks, { projectId: nds.id }))!
    const pav = links.rows.find((r) => r.workerName.startsWith("Pavyzdys"))!
    expect(pav.link!.token).toMatch(/^demo-pavyzdys-/)
    const token = pav.link!.token
    const lastMonday = addDays(weekStartOf(todayIso()), -7)

    // Last week: the client sheet is in; Tuesday the worker and the client say 10, our grid 8.
    const portal = await t.query(api.timesheets.workerPortal, { token, weekStart: lastMonday })
    if (portal.state !== "ok") throw new Error(portal.state)
    expect(portal.current?.projectCode).toBe("NDS-2026-07")
    const tue = portal.days[1]!
    expect(tue).toMatchObject({ client: 10, ours: 8, kind: "ours_differs" })
    expect(tue.mine?.regular).toBe(8)
    expect(tue.mine?.overtime).toBe(2)

    // Writes: today-or-earlier only, quarter hours, ≤ 24 h, within the assignment.
    const yesterday = addDays(todayIso(), -1)
    expect(await codeOf(t.mutation(api.timesheets.saveMyHours, { token, date: addDays(todayIso(), 1), regularHours: 8, overtimeHours: 0 }))).toBe("VALIDATION")
    expect(await codeOf(t.mutation(api.timesheets.saveMyHours, { token, date: addDays(todayIso(), -60), regularHours: 8, overtimeHours: 0 }))).toBe("VALIDATION")
    expect(await codeOf(t.mutation(api.timesheets.saveMyHours, { token, date: yesterday, regularHours: 8.1, overtimeHours: 0 }))).toBe("VALIDATION")
    expect(await t.mutation(api.timesheets.saveMyHours, { token, date: yesterday, regularHours: 8, overtimeHours: 1.5, note: "Blokas B16" })).toEqual({ ok: true })
    const wed = lastMonday < yesterday ? addDays(lastMonday, 2) : yesterday
    await t.mutation(api.timesheets.flagMyDay, { token, date: wed, comment: "Klientas parašė per mažai" })
    const after = await t.query(api.timesheets.workerPortal, { token, weekStart: lastMonday })
    if (after.state !== "ok") throw new Error(after.state)
    expect(after.days[2]!.mine?.disagree).toBe("Klientas parašė per mažai")

    // The coordinator's three-source table for last week.
    const tw = (await admin.query(api.timesheets.threeWayWeek, { projectId: nds.id, weekStart: lastMonday }))!
    const pavRow = tw.rows.find((r) => r.workerId === pav.workerId)!
    expect(pavRow.days[addDays(lastMonday, 1)]!.kind).toBe("ours_differs")
    expect(pavRow.flags).toBeGreaterThanOrEqual(1)
    expect(tw.totals.flags).toBeGreaterThanOrEqual(3) // two seeded + this one
    expect(tw.totals.disagreements).toBeGreaterThanOrEqual(4)
    expect(tw.rows[0]!.disagreements + tw.rows[0]!.flags).toBeGreaterThan(0) // problems first

    // One click: a dispute from the Testenko mismatch (client 0.5 h less).
    const tes = tw.rows.find((r) => r.name.startsWith("Testenko"))!
    const created = await admin.mutation(api.timesheets.createDispute, { workerId: tes.workerId as never, projectId: nds.id, periodFrom: lastMonday, periodTo: addDays(lastMonday, 6), kind: "mismatch" })
    expect(created.existing).toBe(false)
    const again = await admin.mutation(api.timesheets.createDispute, { workerId: tes.workerId as never, projectId: nds.id, periodFrom: lastMonday, periodTo: addDays(lastMonday, 6), kind: "mismatch" })
    expect(again).toMatchObject({ id: created.id, existing: true })
    const d = (await admin.query(api.timesheets.getDispute, { disputeId: created.id }))!
    expect(d.hours).toBe(0.5)
    expect(d.amountCents).toBe(Math.round(0.5 * d.rateCents))
    expect(d.lines.some((l) => l.flag)).toBe(true)
    // Nothing to dispute where the sources agree.
    const ok = tw.rows.find((r) => r.disagreements === 0 && r.flags === 0 && r.totals.client > 0)
    if (ok) expect(await codeOf(admin.mutation(api.timesheets.createDispute, { workerId: ok.workerId as never, projectId: nds.id, periodFrom: lastMonday, periodTo: addDays(lastMonday, 6), kind: "mismatch" }))).toBe("VALIDATION")

    // Status changes land in the timeline; resolved cases leave "Pakibę".
    const before = await admin.query(api.timesheets.listDisputes, {})
    await admin.mutation(api.timesheets.setDisputeStatus, { disputeId: created.id, status: "waiting_client", note: "Išsiųsta klientui" })
    await admin.mutation(api.timesheets.addDisputeNote, { disputeId: created.id, note: "Klientas žiūri" })
    await admin.mutation(api.timesheets.setDisputeStatus, { disputeId: created.id, status: "resolved_accepted" })
    const closed = (await admin.query(api.timesheets.getDispute, { disputeId: created.id }))!
    expect(closed.timeline.map((e) => e.kind)).toEqual(["created", "status", "note", "status"])
    expect(closed.resolvedAt).not.toBeNull()
    const end = await admin.query(api.timesheets.listDisputes, {})
    expect(end.totals.openCents).toBe(before.totals.openCents - d.amountCents)
  })

  test("seeded disputes: about 6 000 EUR open since September; the link email goes to n8n", async () => {
    const t = setup()
    const { admin, nds } = await demoApp(t)
    const list = await admin.query(api.timesheets.listDisputes, {})
    expect(list.totals.open).toBe(3)
    expect(list.totals.openCents).toBeGreaterThan(590_000)
    expect(list.totals.openCents).toBeLessThan(610_000)
    expect(list.items.every((i) => i.periodFrom >= `${addDays(todayIso(), -75).slice(0, 7)}-01`)).toBe(true)
    expect((await admin.query(api.timesheets.listDisputes, { status: "closed" })).items).toHaveLength(2)

    vi.useFakeTimers()
    vi.stubEnv("N8N_URL", "https://n8n.test")
    vi.stubEnv("N8N_WEBHOOK_SECRET", "s")
    vi.stubEnv("SITE_URL", "https://app.test")
    const links = (await admin.query(api.timesheets.listWorkerLinks, { projectId: nds.id }))!
    const withEmail = links.rows.find((r) => r.email)
    const without = links.rows.find((r) => !r.email)
    if (without) expect(await codeOf(admin.mutation(api.timesheets.sendWorkerLink, { workerId: without.workerId as never }))).toBe("VALIDATION")
    if (withEmail) {
      await admin.mutation(api.timesheets.sendWorkerLink, { workerId: withEmail.workerId as never })
      await t.finishAllScheduledFunctions(vi.runAllTimers)
      const hook = sent.find((s) => s.url.endsWith("/webhook/dr-nuoma-pranesimas"))!
      expect(hook.body).toMatchObject({ to: withEmail.email, redirectTo: "super@acme.test", appUrl: `https://app.test/h/${withEmail.link!.token}` })
    }
  })
})

describe("timesheets: client PDF by email", () => {
  test("a PDF email is matched by project code and filed for review even without Resend / AI", async () => {
    const t = setup()
    const { admin, bst } = await demoApp(t)
    const intakeId = await t.run(async (ctx) =>
      ctx.db.insert("staffing_timesheets_intake", {
        emailKey: "re_test_1",
        inboxAddress: "tabeliai@demo.test",
        from: "someone@unknown.example",
        subject: `Stundennachweis – ${bst.code}`,
        receivedAt: Date.now(),
        attachments: [{ name: "report.pdf", type: "application/pdf", size: 1000 }],
        status: "queued",
        createdAt: Date.now(),
        createdBy: "test",
      }),
    )
    await t.action(internal.timesheets._processIntake, { intakeId })
    const { rows } = await admin.query(api.timesheets.listIntake, {})
    const row = rows.find((r) => r.id === intakeId)!
    expect(row).toMatchObject({ status: "imported", matchedBy: "project_code", project: { code: bst.code } })
    const sheets = await admin.query(api.timesheets.listClientSheets, { projectId: bst.id })
    const sheet = sheets.find((s) => s.id === row.sheetId)!
    // The PDF could not be fetched (no Resend here): still filed, with the reason, rows can be typed in.
    expect(sheet).toMatchObject({ review: "pending", source: "pdf", status: "failed" })
    expect(sheet.error).toMatch(/resend_not_configured|attachment_missing/)
    await admin.mutation(api.timesheets.confirmSheetReview, { sheetId: sheet.id as never })
    expect((await admin.query(api.timesheets.listClientSheets, { projectId: bst.id })).find((s) => s.id === sheet.id)?.review).toBe("confirmed")

    // The seeded scan-log sheet keeps every raw line; reconciliation uses the day sums.
    const scan = sheets.find((s) => s.rawRowCount > 0)!
    expect(scan.rawRowCount).toBeGreaterThan(scan.rowCount * 10)
    const rec = (await admin.query(api.timesheets.getReconciliation, { sheetId: scan.id as never }))!
    expect(rec.sheet.rawRows.filter((r) => r.minutes === 13).length).toBeGreaterThan(100)
    expect(rec.reconciliation.lines.filter((l) => l.kind !== "ok")).toHaveLength(1)

    // The seeded email nobody could place: pick the project by hand.
    const lost = rows.find((r) => r.status === "no_match")!
    await admin.mutation(api.timesheets.assignIntake, { intakeId: lost.id as never, projectId: bst.id })
    await t.action(internal.timesheets._processIntake, { intakeId: lost.id as never })
    expect((await admin.query(api.timesheets.listIntake, {})).rows.find((r) => r.id === lost.id)).toMatchObject({ status: "imported", matchedBy: "manual" })
  })
})
