import { describe, expect, test } from "vitest"
import {
  agingBucket,
  allocateCents,
  billingPeriodsBetween,
  chainStatus,
  defaultWageCents,
  emailAddressOf,
  matchSupplier,
  parseInvoiceEmail,
  parseMoneyCents,
  wageCostCents,
  workerProfitability,
  type ChainFacts,
  type WorkerDayValue,
  billingPeriodOf,
  dueReminderStage,
  formatInvoiceNumber,
  invoiceTotals,
  marginPct,
  nextBillingPeriod,
  priceHours,
  siteProCsv,
  statusAfterPayments,
  vatRateFor,
  weeklySeries,
} from "../src/invoicing/pure"

describe("invoicing: billing periods", () => {
  test("weekly is Monday–Sunday, monthly the calendar month, biweekly a fixed fortnight", () => {
    expect(billingPeriodOf("weekly", "2026-11-11")).toEqual({ from: "2026-11-09", to: "2026-11-15" })
    expect(billingPeriodOf("monthly", "2026-02-14")).toEqual({ from: "2026-02-01", to: "2026-02-28" })
    const a = billingPeriodOf("biweekly", "2026-11-11")
    expect(a.to).toBe(addDays14(a.from))
    // Both weeks of a fortnight map to the same period.
    expect(billingPeriodOf("biweekly", a.to)).toEqual(a)
  })

  test("next period follows the last invoiced one, else the last finished one", () => {
    expect(nextBillingPeriod("monthly", "2026-09-30", "2026-11-11")).toEqual({ from: "2026-10-01", to: "2026-10-31" })
    expect(nextBillingPeriod("weekly", null, "2026-11-11")).toEqual({ from: "2026-11-02", to: "2026-11-08" })
  })
})

describe("invoicing: pricing", () => {
  const rows = [
    { projectId: "p1", tradeId: "weld", regular: 8, overtime: 2, weekend: 0 },
    { projectId: "p1", tradeId: "weld", regular: 8, overtime: 0, weekend: 6 },
    { projectId: "p1", tradeId: "grind", regular: 8, overtime: 0, weekend: 0 },
  ]

  test("lines per project × trade × rate type with overtime ×1.25 and weekend ×1.5 by default", () => {
    const { lines, missingRates } = priceHours(rows, (_p, trade) => ({ rateCents: trade === "weld" ? 4700 : null, overtimePct: 125, weekendPct: 150 }))
    expect(lines).toEqual([
      { projectId: "p1", tradeId: "weld", rateType: "regular", hours: 16, multiplierPct: 100, unitPriceCents: 4700, amountCents: 75200 },
      { projectId: "p1", tradeId: "weld", rateType: "overtime", hours: 2, multiplierPct: 125, unitPriceCents: 5875, amountCents: 11750 },
      { projectId: "p1", tradeId: "weld", rateType: "weekend", hours: 6, multiplierPct: 150, unitPriceCents: 7050, amountCents: 42300 },
    ])
    // No sell rate: left out and reported, never priced at zero.
    expect(missingRates).toEqual([{ projectId: "p1", tradeId: "grind", hours: 8 }])
  })

  test("per-client surcharges change the unit price; totals add VAT only for Lithuanian buyers", () => {
    const { lines } = priceHours([rows[0]!], () => ({ rateCents: 4000, overtimePct: 120, weekendPct: 150 }))
    expect(lines.find((l) => l.rateType === "overtime")!.unitPriceCents).toBe(4800)
    expect(vatRateFor("NO")).toBe(0)
    expect(vatRateFor("lt")).toBe(21)
    expect(invoiceTotals(lines, 21)).toEqual({ subtotalCents: 41600, vatCents: 8736, totalCents: 50336 })
  })
})

describe("invoicing: numbering, payments, debts, reminders", () => {
  test("number series and payment status", () => {
    expect(formatInvoiceNumber("DN", 2026, 7)).toBe("DN-2026-0007")
    expect(statusAfterPayments("sent", 1000, 0)).toBe("sent")
    expect(statusAfterPayments("sent", 1000, 400)).toBe("partially_paid")
    expect(statusAfterPayments("approved", 1000, 1000)).toBe("paid")
  })

  test("aging buckets by days past due", () => {
    expect(agingBucket("2026-11-11", "2026-11-11")).toBe("current")
    expect(agingBucket("2026-10-12", "2026-11-11")).toBe("d0_30")
    expect(agingBucket("2026-10-01", "2026-11-11")).toBe("d31_60")
    expect(agingBucket("2026-09-01", "2026-11-11")).toBe("d60_plus")
  })

  test("reminder stage 1 from +3 days, stage 2 from +14, each once", () => {
    expect(dueReminderStage(2, [])).toBeNull()
    expect(dueReminderStage(3, [])).toBe(1)
    expect(dueReminderStage(10, [1])).toBeNull()
    expect(dueReminderStage(14, [1])).toBe(2)
    expect(dueReminderStage(40, [1, 2])).toBeNull()
    // A late first run skips straight to the firmer stage.
    expect(dueReminderStage(20, [])).toBe(2)
  })
})

describe("invoicing: profitability and export", () => {
  test("weekly series fills gaps; margin on revenue", () => {
    const s = weeklySeries([{ date: "2026-11-02", cents: 1000 }, { date: "2026-11-18", cents: 500 }], [{ date: "2026-11-06", cents: 300 }])
    expect(s.map((w) => w.week)).toEqual(["2026-11-02", "2026-11-09", "2026-11-16"])
    expect(s[0]).toEqual({ week: "2026-11-02", revenueCents: 1000, costCents: 300 })
    expect(marginPct(1000, 950)).toBe(5)
    expect(marginPct(0, 10)).toBeNull()
  })

  test("SitePro CSV: header, one row per line, decimal comma, quoted text", () => {
    const csv = siteProCsv([
      {
        number: "DN-2026-0001",
        issueDate: "2026-11-03",
        dueDate: "2026-12-03",
        currency: "EUR",
        vatRatePct: 0,
        periodFrom: "2026-10-01",
        periodTo: "2026-10-31",
        client: { code: "NDS", name: "Demo; Shipyard", vatCode: null, country: "NO" },
        lines: [{ projectCode: "NDS-1", serviceCode: "WELD-MAG", serviceName: "Suvirintojas", hours: 7.5, unitPriceCents: 4700, amountCents: 35250 }],
      },
    ])
    const [header, row] = csv.trim().split("\r\n")
    expect(header!.split(";")[0]).toBe("Dokumento tipas")
    expect(row).toContain(";DN;2026-0001;")
    expect(row).toContain('"Demo; Shipyard"')
    expect(row).toContain(";7,5;47,00;352,50;0;0,00;352,50;EUR;")
  })
})

describe("invoicing: the closed process (chain)", () => {
  const base: ChainFacts = {
    period: { from: "2026-08-01", to: "2026-08-31" },
    today: "2026-11-11",
    daysWithHours: 21,
    weeksWithHours: 5,
    weeksApproved: 5,
    daysCovered: 21,
    sheets: 1,
    openMismatches: 0,
    invoice: null,
    approvedValueCents: 4_000_000,
    invoicedCents: 0,
  }

  test("the forgotten period: everything up to reconciliation done, no invoice → broken at 'drafted', alert, all of it at risk", () => {
    const r = chainStatus(base, 7)
    expect(r.steps).toEqual({ hours: "done", weekApproved: "done", clientSheet: "done", reconciled: "done", drafted: "missing", approved: "missing", sent: "missing", paid: "missing" })
    expect(r.brokenAt).toBe("drafted")
    expect(r).toMatchObject({ closed: false, ended: true, daysSinceEnd: 72, alert: true, atRiskCents: 4_000_000 })
  })

  test("a paid invoice closes the period; a draft does not stop the alert; partial steps", () => {
    const paid = chainStatus({ ...base, invoice: { status: "paid", sent: true }, invoicedCents: 4_000_000 })
    expect(paid).toMatchObject({ closed: true, brokenAt: null, alert: false, atRiskCents: 0 })
    const draft = chainStatus({ ...base, invoice: { status: "draft", sent: false } })
    expect(draft).toMatchObject({ brokenAt: "approved", alert: true })
    const late = chainStatus({ ...base, weeksApproved: 3, daysCovered: 10, openMismatches: 2 })
    expect(late.steps).toMatchObject({ weekApproved: "partial", clientSheet: "partial", reconciled: "partial" })
    expect(late.brokenAt).toBe("weekApproved")
    const partlyPaid = chainStatus({ ...base, invoice: { status: "partially_paid", sent: true }, invoicedCents: 3_900_000 })
    expect(partlyPaid).toMatchObject({ brokenAt: "paid", atRiskCents: 100_000, alert: false })
    expect(partlyPaid.steps.paid).toBe("partial")
  })

  test("no alert within the grace days or while the period runs; empty periods are not broken", () => {
    expect(chainStatus({ ...base, today: "2026-09-05" }, 7).alert).toBe(false)
    expect(chainStatus({ ...base, today: "2026-09-09" }, 7).alert).toBe(true)
    const running = chainStatus({ ...base, today: "2026-08-20" })
    expect(running).toMatchObject({ ended: false, alert: false })
    const empty = chainStatus({ ...base, daysWithHours: 0, weeksWithHours: 0, weeksApproved: 0, daysCovered: 0, sheets: 0, approvedValueCents: 0 })
    expect(empty).toMatchObject({ empty: true, closed: false, brokenAt: null, alert: false })
    expect(Object.values(empty.steps).every((s) => s === "na")).toBe(true)
  })

  test("billing periods between two dates", () => {
    expect(billingPeriodsBetween("monthly", "2026-07-14", "2026-09-02").map((p) => p.from)).toEqual(["2026-07-01", "2026-08-01", "2026-09-01"])
    expect(billingPeriodsBetween("weekly", "2026-11-04", "2026-11-11")).toEqual([
      { from: "2026-11-02", to: "2026-11-08" },
      { from: "2026-11-09", to: "2026-11-15" },
    ])
  })
})

describe("invoicing: profitability per worker", () => {
  test("wage cost: overtime ×1.5, weekend ×2; trade defaults", () => {
    expect(wageCostCents({ regular: 8, overtime: 2, weekend: 0 }, 2500)).toBe(8 * 2500 + 2 * 3750)
    expect(wageCostCents({ regular: 0, overtime: 0, weekend: 6 }, 2500)).toBe(30000)
    expect(defaultWageCents("WELD-MAG")).toBe(2600)
    expect(defaultWageCents("UNKNOWN")).toBe(defaultWageCents(null))
  })

  test("allocation by weights adds up exactly", () => {
    const a = allocateCents(1000, new Map([["a", 1], ["b", 1], ["c", 1]]))
    expect([...a.values()].reduce((s, x) => s + x, 0)).toBe(1000)
    expect(a.get("a")).toBe(334)
    expect(allocateCents(500, new Map([["a", 0]])).get("a")).toBe(0)
  })

  test("billed value − wages − housing/transport shared by days worked on each project", () => {
    const days: WorkerDayValue[] = [
      // Jonas: 2 days on P1. Petras: 1 day on P1 (two rows that day), 1 day on P2.
      { workerId: "jonas", projectId: "p1", date: "2026-10-05", hours: 8, valueCents: 400_00, wageCents: 200_00 },
      { workerId: "jonas", projectId: "p1", date: "2026-10-06", hours: 8, valueCents: 400_00, wageCents: 200_00 },
      { workerId: "petras", projectId: "p1", date: "2026-10-05", hours: 6, valueCents: 300_00, wageCents: 150_00 },
      { workerId: "petras", projectId: "p1", date: "2026-10-05", hours: 2, valueCents: 100_00, wageCents: 75_00 },
      { workerId: "petras", projectId: "p2", date: "2026-10-06", hours: 8, valueCents: 500_00, wageCents: 300_00 },
    ]
    // P1 housing and transport 300 € over 3 worker-days; P2 nothing.
    const rows = workerProfitability(days, new Map([["p1", 300_00]]))
    const jonas = rows.find((r) => r.workerId === "jonas")!
    const petras = rows.find((r) => r.workerId === "petras")!
    expect(jonas).toMatchObject({ days: 2, hours: 16, billedCents: 800_00, wageCents: 400_00, overheadCents: 200_00, marginCents: 200_00, marginPct: 25 })
    expect(petras).toMatchObject({ days: 2, hours: 16, billedCents: 900_00, wageCents: 525_00, overheadCents: 100_00, marginCents: 275_00, projectIds: ["p1", "p2"] })
    // Worst margin first; the shares add up to the project's costs.
    expect(rows[0]!.workerId).toBe("jonas")
    expect(jonas.overheadCents + petras.overheadCents).toBe(300_00)
  })
})

describe("invoicing: purchase invoices from e-mail", () => {
  const suppliers = [
    { name: "Hotel", emails: ["rechnung@hotel.example"], active: true },
    { name: "Fuel", emails: ["@fuel.example"], active: true },
    { name: "Old", emails: ["old@old.example"], active: false },
  ]

  test("known senders by address or domain; inactive and unknown senders are not known", () => {
    expect(matchSupplier("Hotel <Rechnung@Hotel.example>", suppliers)?.name).toBe("Hotel")
    expect(matchSupplier("e-saskaitos@fuel.example", suppliers)?.name).toBe("Fuel")
    expect(matchSupplier("old@old.example", suppliers)).toBeNull()
    expect(matchSupplier("someone@fuel.example.evil.com", suppliers)).toBeNull()
    expect(emailAddressOf("A B <a@b.lt>")).toBe("a@b.lt")
  })

  test("number, total and date read from the subject and text", () => {
    expect(parseInvoiceEmail("Sąskaita faktūra AN-55821", "Mokėti: 2 238,50 EUR\nData 2026-11-07")).toEqual({ number: "AN-55821", totalCents: 223850, issueDate: "2026-11-07" })
    expect(parseInvoiceEmail("Rechnung HB-2026-1031", "Gesamtbetrag: 3.720,00 €")).toMatchObject({ number: "HB-2026-1031", totalCents: 372000 })
    expect(parseInvoiceEmail("Invoice INV-77", "Total 1,234.56")).toMatchObject({ number: "INV-77", totalCents: 123456 })
    expect(parseInvoiceEmail("Labas", "be sumos")).toEqual({ number: null, totalCents: null, issueDate: null })
    expect(parseMoneyCents("1 210")).toBe(121000)
  })
})

function addDays14(from: string) {
  return new Date(Date.parse(`${from}T00:00:00Z`) + 13 * 86_400_000).toISOString().slice(0, 10)
}
