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
    await t.mutation(internal.staffing._seedDemo, {})
    await t.mutation(internal.invoicing._seedDemo, {})
    const draft = (await superUser.query(api.invoicing.listInvoices, { status: "draft" }))[0]!
    expect(await codeOf(alice.mutation(api.invoicing.approveInvoice, { invoiceId: draft.id }))).toBe("FORBIDDEN")
    await superUser.mutation(api.system.setModuleEnabled, { moduleId: "staffing-invoicing", enabled: false })
    expect(await codeOf(alice.query(api.invoicing.listInvoices, {}))).toBe("FORBIDDEN")
  })
})

describe("staffing-invoicing: flow", () => {
  test("seed → approve draft (numbered, due by terms) → pay in two parts → debts, reminders, profitability, export", async () => {
    const t = setup()
    const admin = await invoicingApp(t)
    await t.mutation(internal.staffing._seedDemo, {})
    const seeded = await t.mutation(internal.invoicing._seedDemo, {})
    expect(seeded).toMatchObject({ seeded: true })
    expect((await t.mutation(internal.invoicing._seedDemo, {})).seeded).toBe(false)

    const all = await admin.query(api.invoicing.listInvoices, {})
    expect(all.length).toBeGreaterThanOrEqual(5)
    expect(new Set(all.map((i) => i.status))).toEqual(new Set(["draft", "approved", "sent", "partially_paid", "paid"]))
    expect(all.filter((i) => i.overdue).length).toBe(2)

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
    expect(debts.overdue).toHaveLength(2)
    vi.useFakeTimers()
    const { queued } = await admin.mutation(api.invoicing.runDueReminders, {})
    expect(queued).toBeGreaterThanOrEqual(1)
    await t.finishAllScheduledFunctions(vi.runAllTimers)
    const after = await admin.query(api.invoicing.debts, {})
    expect(after.reminders.some((r) => r.status === "not_configured")).toBe(true)
    expect((await admin.mutation(api.invoicing.runDueReminders, {})).queued).toBe(0)

    // Profitability: every active project has revenue and costs; margins differ.
    const portfolio = (await admin.query(api.invoicing.portfolio, {})).filter((r) => r.earnedCents > 0)
    expect(portfolio.length).toBe(2)
    expect(portfolio[0]!.marginPct!).toBeLessThan(10)
    expect(portfolio[1]!.marginPct!).toBeGreaterThan(20)
    expect(portfolio.every((r) => r.invoicedCents > 0 && r.costCents > 0)).toBe(true)

    const csv = await admin.query(api.invoicing.siteProExport, { invoiceId: draft.id })
    expect(csv.csv.split("\r\n")[0]).toContain("Dokumento tipas")
    expect(csv.fileName).toContain(number)

    const audit = await admin.query(api.system.listAudit, { actionPrefix: "staffing-invoicing." })
    const actions = (audit as { items: { action: string }[] }).items.map((e) => e.action)
    expect(actions).toEqual(expect.arrayContaining(["staffing-invoicing.invoice.approve", "staffing-invoicing.payment.create", "staffing-invoicing.reminder.send"]))
  })
})
