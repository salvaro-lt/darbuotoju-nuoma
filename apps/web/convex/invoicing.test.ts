import { convexTest } from "convex-test"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { api, internal } from "./_generated/api"
import schema from "./schema"
import { modules } from "./test.setup"

// The invoicing area (staffing-invoicing) as installed in this app (convex/invoicing.ts).

type T = ReturnType<typeof setup>
const setup = () => convexTest(schema, modules)

const ISSUER = "https://api.workos.com/user_management/client_TEST123"
const SUPER = { subject: "user_super", issuer: ISSUER, email: "super@acme.test", email_verified: true }
const ALICE = { subject: "user_alice", issuer: ISSUER, email: "alice@acme.test", email_verified: true }

let sent: { text?: string }[] = []
beforeEach(() => {
  sent = []
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    sent.push(JSON.parse(String(init.body)))
    return new Response("{}", { status: 200 })
  })
})
afterEach(() => {
  vi.unstubAllGlobals()
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

async function invoicingApp(t: T) {
  await t.mutation(internal.system.registerSystem, {})
  const superUser = t.withIdentity(SUPER)
  await superUser.mutation(api.system.completeSignIn, {})
  await superUser.mutation(api.system.setModuleEnabled, { moduleId: "staffing", enabled: true })
  await superUser.mutation(api.system.setModuleEnabled, { moduleId: "staffing-invoicing", enabled: true })
  return superUser
}

/** The demo as on localhost: staffing → timesheets → invoicing seeds. */
async function seeded(t: T) {
  await t.mutation(internal.staffing._seedDemo, {})
  await t.mutation(internal.timesheets._seedDemo, {})
  return await t.mutation(internal.invoicing._seedDemo, {})
}

async function inviteWithRole(t: T, superUser: ReturnType<T["withIdentity"]>, subroleIds: string[]) {
  const { roleId } = (await superUser.mutation(api.system.createRole, { name: `Role ${subroleIds.join("+")}`, subroleIds })) as { roleId: string }
  await superUser.action(api.system.createInvite, { email: ALICE.email, roleIds: [roleId] })
  const token = new URL(sent.at(-1)!.text!.match(/https:\/\/app\.test\/invite\?token=\S+/)![0]).searchParams.get("token")!
  const alice = t.withIdentity(ALICE)
  await alice.mutation(api.system.completeSignIn, { inviteToken: token })
  return alice
}

describe("staffing-invoicing: access", () => {
  test("signed out, viewer approving, and disabled module are denied", async () => {
    const t = setup()
    const superUser = await invoicingApp(t)
    expect(await codeOf(t.query(api.invoicing.listInvoices, {}))).toBe("UNAUTHENTICATED")
    const alice = await inviteWithRole(t, superUser, ["staffing-invoicing:viewer"])
    expect(await codeOf(alice.query(api.invoicing.listInvoices, {}))).toBe("OK")
    expect(await codeOf(alice.query(api.invoicing.portfolio, {}))).toBe("FORBIDDEN")
    expect(await codeOf(alice.query(api.invoicing.workerProfitability, {}))).toBe("FORBIDDEN")
    await t.mutation(internal.staffing._seedDemo, {})
    await t.mutation(internal.invoicing._seedDemo, {})
    const draft = (await superUser.query(api.invoicing.listInvoices, { status: "draft" }))[0]!
    expect(await codeOf(alice.mutation(api.invoicing.approveInvoice, { invoiceId: draft.id }))).toBe("FORBIDDEN")
    await superUser.mutation(api.system.setModuleEnabled, { moduleId: "staffing-invoicing", enabled: false })
    expect(await codeOf(alice.query(api.invoicing.listInvoices, {}))).toBe("FORBIDDEN")
  })

  test("purchase invoices: the accountant prepares, only the director approves", async () => {
    const t = setup()
    const superUser = await invoicingApp(t)
    await seeded(t)
    const accountant = await inviteWithRole(t, superUser, ["staffing-invoicing:accountant"])
    const pending = (await accountant.query(api.invoicing.listPurchases, { status: "pending" })).items[0]!
    expect(await codeOf(accountant.mutation(api.invoicing.updatePurchase, { purchaseId: pending.id as never, note: "Patikrinta" }))).toBe("OK")
    expect(await codeOf(accountant.mutation(api.invoicing.approvePurchase, { purchaseId: pending.id as never }))).toBe("FORBIDDEN")
    expect(await codeOf(accountant.mutation(api.invoicing.rejectPurchase, { purchaseId: pending.id as never }))).toBe("FORBIDDEN")
    expect(await codeOf(t.query(api.invoicing.listPurchases, {}))).toBe("UNAUTHENTICATED")
  })
})

describe("staffing-invoicing: flow", () => {
  test("seed → approve draft (numbered, due by terms) → pay in two parts → debts, reminders, profitability, export", async () => {
    const t = setup()
    const admin = await invoicingApp(t)
    const result = await seeded(t)
    expect(result).toMatchObject({ seeded: true })
    expect((await t.mutation(internal.invoicing._seedDemo, {})).seeded).toBe(false)

    const all = await admin.query(api.invoicing.listInvoices, {})
    expect(all.length).toBeGreaterThanOrEqual(4)
    expect(new Set(all.map((i) => i.status))).toEqual(new Set(["draft", "approved", "sent", "partially_paid", "paid"]))
    expect(all.filter((i) => i.overdue).length).toBe(1)

    // Approve the draft: next number in the series, due date = issue date + client terms.
    const draft = all.find((i) => i.status === "draft")!
    const { number } = await admin.mutation(api.invoicing.approveInvoice, { invoiceId: draft.id, issueDate: "2026-11-05" })
    expect(number).toMatch(/^DN-2026-\d{4}$/)
    const detail = (await admin.query(api.invoicing.getInvoice, { invoiceId: draft.id }))!
    expect(detail.invoice.dueDate).toBe(new Date(Date.parse("2026-11-05T00:00:00Z") + detail.client.paymentTermsDays * 86_400_000).toISOString().slice(0, 10))
    expect(detail.lines.length).toBeGreaterThan(0)

    // Overpayment refused; two payments close it.
    const total = detail.invoice.totalCents
    expect(await codeOf(admin.mutation(api.invoicing.recordPayment, { invoiceId: draft.id, date: "2026-11-06", amountCents: total + 1 }))).toBe("VALIDATION")
    expect((await admin.mutation(api.invoicing.recordPayment, { invoiceId: draft.id, date: "2026-11-06", amountCents: 1000 })).status).toBe("partially_paid")
    expect((await admin.mutation(api.invoicing.recordPayment, { invoiceId: draft.id, date: "2026-11-07", amountCents: total - 1000 })).status).toBe("paid")

    // Debts: the partially paid invoice still waits for stage 2; without n8n env the attempt is logged as not configured.
    const debts = await admin.query(api.invoicing.debts, {})
    expect(debts.overdue).toHaveLength(1)
    vi.useFakeTimers()
    const { queued } = await admin.mutation(api.invoicing.runDueReminders, {})
    expect(queued).toBeGreaterThanOrEqual(1)
    await t.finishAllScheduledFunctions(vi.runAllTimers)
    const after = await admin.query(api.invoicing.debts, {})
    expect(after.reminders.some((r) => r.status === "not_configured")).toBe(true)
    expect((await admin.mutation(api.invoicing.runDueReminders, {})).queued).toBe(0)

    // Profitability: every active project has revenue, wages and costs; margins differ.
    const portfolio = (await admin.query(api.invoicing.portfolio, {})).filter((r) => r.earnedCents > 0)
    expect(portfolio.length).toBe(2)
    expect(portfolio[0]!.marginPct!).toBeLessThan(10)
    expect(portfolio[1]!.marginPct!).toBeGreaterThan(20)
    expect(portfolio.every((r) => r.invoicedCents > 0 && r.wageCents > 0 && r.costCents > r.wageCents)).toBe(true)

    // Per client and per worker add up to the same margin (general overhead aside).
    const clients = await admin.query(api.invoicing.clientProfitability, {})
    expect(clients.rows.reduce((s, r) => s + r.earnedCents, 0)).toBe(portfolio.reduce((s, r) => s + r.earnedCents, 0))
    const workers = await admin.query(api.invoicing.workerProfitability, {})
    expect(workers.reduce((s, r) => s + r.marginCents, 0)).toBe(portfolio.reduce((s, r) => s + r.marginCents, 0))
    expect(workers.some((w) => w.source === "subcontractor")).toBe(true)
    // A period filter narrows it down.
    const lastMonth = await admin.query(api.invoicing.portfolio, { from: "2026-10-01", to: "2026-10-31" })
    expect(lastMonth.reduce((s, r) => s + r.earnedCents, 0)).toBeLessThan(portfolio.reduce((s, r) => s + r.earnedCents, 0))

    // A wage rate changes the worker's margin.
    const w = workers[0]!
    await admin.mutation(api.invoicing.setWageRate, { workerId: w.workerId as never, hourlyCostCents: w.hourlyCostCents + 500 })
    const w2 = (await admin.query(api.invoicing.workerProfitability, {})).find((x) => x.workerId === w.workerId)!
    expect(w2.marginCents).toBeLessThan(w.marginCents)
    expect(await codeOf(admin.mutation(api.invoicing.setWageRate, { workerId: w.workerId as never, hourlyCostCents: -1 }))).toBe("VALIDATION")

    const csv = await admin.query(api.invoicing.siteProExport, { invoiceId: draft.id })
    expect(csv.csv.split("\r\n")[0]).toContain("Dokumento tipas")
    expect(csv.fileName).toContain(number)

    const audit = await admin.query(api.system.listAudit, { actionPrefix: "staffing-invoicing." })
    const actions = (audit as { items: { action: string }[] }).items.map((e) => e.action)
    expect(actions).toEqual(expect.arrayContaining(["staffing-invoicing.invoice.approve", "staffing-invoicing.payment.create", "staffing-invoicing.reminder.send", "staffing-invoicing.wage_rate.update"]))
  })

  test("billable hours are the approved timesheet weeks plus manual corrections", async () => {
    const t = setup()
    const admin = await invoicingApp(t)
    await seeded(t)
    const projects = await admin.query(api.staffing.listProjects, {})
    const nds = projects.find((p) => p.code === "NDS-2026-07")!
    const today = new Date().toISOString().slice(0, 10)
    const res = await admin.query(api.invoicing.listHours, { projectId: nds.id, from: "2026-01-01", to: today })
    expect(res.rows.some((r) => r.source === "timesheets")).toBe(true)
    expect(res.rows.some((r) => r.source === "manual")).toBe(true)
    // The timesheets seed leaves last week and this week open: their hours are not billable.
    expect(res.unapprovedWeeks.length).toBeGreaterThanOrEqual(1)
    for (const monday of res.unapprovedWeeks) expect(res.rows.filter((r) => r.source === "timesheets" && r.date >= monday && r.date <= addDays(monday, 6))).toHaveLength(0)
  })
})

const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)

describe("staffing-invoicing: the closed process", () => {
  test("the forgotten ~€40,000 period is flagged until an invoice is issued; the daily check notifies", async () => {
    const t = setup()
    const admin = await invoicingApp(t)
    const result = (await seeded(t)) as { forgotten: { clientId: string; from: string; to: string; valueCents: number } | null }
    expect(result.forgotten).not.toBeNull()
    const f = result.forgotten!
    expect(f.valueCents).toBeGreaterThanOrEqual(40_000_00)

    const chain = await admin.query(api.invoicing.chain, {})
    const alert = chain.alerts.find((a) => a.clientId === f.clientId && a.from === f.from)!
    expect(alert).toBeDefined()
    expect(alert.brokenAt).toBe("drafted")
    expect(alert.daysSinceEnd).toBeGreaterThan(chain.alertAfterDays)
    expect(alert.atRiskCents).toBe(f.valueCents)
    const period = chain.rows.find((r) => r.clientId === f.clientId)!.periods.find((p) => p.from === f.from)!
    expect(period.steps).toMatchObject({ hours: "done", weekApproved: "done", clientSheet: "done", reconciled: "done", drafted: "missing" })
    // At least one older period is fully closed (paid).
    expect(chain.rows.some((r) => r.periods.some((p) => p.closed))).toBe(true)

    // The daily job: one run, recorded as not configured without n8n env.
    vi.useFakeTimers()
    const run = await t.mutation(internal.invoicing._dailyChainCheck, {})
    expect(run.alerts).toBe(chain.alerts.length)
    await t.finishAllScheduledFunctions(vi.runAllTimers)
    expect((await admin.query(api.invoicing.chain, {})).lastRun).toMatchObject({ status: "not_configured", alerts: chain.alerts.length })
    vi.useRealTimers()

    // Draft and approve the invoice: the alert is gone.
    const { id } = await admin.mutation(api.invoicing.createDraft, { clientId: f.clientId as never, from: f.from, to: f.to })
    expect((await admin.query(api.invoicing.chain, {})).alerts.some((a) => a.from === f.from && a.clientId === f.clientId)).toBe(true)
    await admin.mutation(api.invoicing.approveInvoice, { invoiceId: id })
    const after = await admin.query(api.invoicing.chain, {})
    expect(after.alerts.some((a) => a.from === f.from && a.clientId === f.clientId)).toBe(false)
    const fixed = after.rows.find((r) => r.clientId === f.clientId)!.periods.find((p) => p.from === f.from)!
    expect(fixed.brokenAt).toBe("sent")
  })
})

describe("staffing-invoicing: purchase invoices", () => {
  test("known supplier → approval queue; unknown sender → review; approved invoice is a project cost, ready to forward", async () => {
    const t = setup()
    const admin = await invoicingApp(t)
    await seeded(t)
    const known = await t.mutation(internal.invoicing._simulatePurchaseEmail, { from: "UAB Autonuoma <saskaitos@autonuoma.example>", subject: "Sąskaita faktūra AN-60001", text: "Mikroautobuso nuoma. Suma: 1 210,00 EUR" })
    expect(known).toMatchObject({ status: "pending" })
    const unknown = await t.mutation(internal.invoicing._simulatePurchaseEmail, { from: "billing@unknown-hostel.example", subject: "Invoice INV-77", text: "Total 300.00" })
    expect(unknown).toMatchObject({ status: "review" })

    const list = await admin.query(api.invoicing.listPurchases, {})
    const k = list.items.find((p) => p.id === known!.id)!
    expect(k).toMatchObject({ number: "AN-60001", totalCents: 1_210_00, knownSender: true })
    // Unknown: approval refused until reviewed; accepting the sender makes them a known supplier.
    expect(await codeOf(admin.mutation(api.invoicing.approvePurchase, { purchaseId: unknown!.id as never }))).toBe("CONFLICT")
    await admin.mutation(api.invoicing.acceptSender, { purchaseId: unknown!.id as never, name: "Unknown Hostel", category: "accommodation" })
    const again = await t.mutation(internal.invoicing._simulatePurchaseEmail, { from: "billing@unknown-hostel.example", subject: "Invoice INV-78", text: "Total 120.00" })
    expect(again).toMatchObject({ status: "pending" })

    // Approve with a project: forward "ready" without SITEPRO_IMPORT_EMAIL, and the project's costs grow.
    const projects = await admin.query(api.staffing.listProjects, {})
    const nds = projects.find((p) => p.code === "NDS-2026-07")!
    const before = (await admin.query(api.invoicing.projectProfitability, { projectId: nds.id }))!
    await admin.mutation(api.invoicing.updatePurchase, { purchaseId: known!.id as never, projectId: nds.id, netCents: 1_000_00, vatCents: 210_00 })
    vi.useFakeTimers()
    await admin.mutation(api.invoicing.approvePurchase, { purchaseId: known!.id as never })
    await t.finishAllScheduledFunctions(vi.runAllTimers)
    vi.useRealTimers()
    const approved = (await admin.query(api.invoicing.listPurchases, { status: "approved" })).items.find((p) => p.id === known!.id)!
    expect(approved.forward).toBe("ready")
    const afterP = (await admin.query(api.invoicing.projectProfitability, { projectId: nds.id }))!
    expect(afterP.purchaseCents - before.purchaseCents).toBe(1_000_00)
    expect(afterP.costs.some((c) => c.kind === "purchase" && c.id === known!.id)).toBe(true)
    expect(await codeOf(admin.mutation(api.invoicing.approvePurchase, { purchaseId: known!.id as never }))).toBe("CONFLICT")

    const audit = await admin.query(api.system.listAudit, { actionPrefix: "staffing-invoicing.purchase" })
    expect((audit as { items: { action: string }[] }).items.map((e) => e.action)).toEqual(expect.arrayContaining(["staffing-invoicing.purchase.approve", "staffing-invoicing.purchase.update"]))
  })
})
