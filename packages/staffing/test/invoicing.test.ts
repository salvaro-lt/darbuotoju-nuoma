import { describe, expect, test } from "vitest"
import {
  agingBucket,
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

function addDays14(from: string) {
  return new Date(Date.parse(`${from}T00:00:00Z`) + 13 * 86_400_000).toISOString().slice(0, 10)
}
