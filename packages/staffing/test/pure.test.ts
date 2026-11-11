import { describe, expect, test } from "vitest"
import {
  addDays,
  addMonths,
  certificateStatus,
  currentAndNext,
  isIsoDate,
  latestCertificateByType,
  overlappingBlocking,
  rangesOverlap,
  sellRateFor,
  worstCertificateStatus,
} from "../src/pure"

describe("dates", () => {
  test("ISO days, adding days and months", () => {
    expect(isIsoDate("2026-02-28")).toBe(true)
    expect(isIsoDate("2026-02-30")).toBe(false)
    expect(isIsoDate("2026-2-3")).toBe(false)
    expect(addDays("2026-12-30", 3)).toBe("2027-01-02")
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28")
    expect(addMonths("2026-03-15", -3)).toBe("2025-12-15")
  })

  test("inclusive overlap, open ends reach forever", () => {
    expect(rangesOverlap({ startDate: "2026-01-01", endDate: "2026-01-10" }, { startDate: "2026-01-10", endDate: "2026-01-20" })).toBe(true)
    expect(rangesOverlap({ startDate: "2026-01-01", endDate: "2026-01-09" }, { startDate: "2026-01-10" })).toBe(false)
    expect(rangesOverlap({ startDate: "2026-01-01" }, { startDate: "2030-01-01", endDate: "2030-01-02" })).toBe(true)
    expect(rangesOverlap({ startDate: "2026-05-01" }, { startDate: "2026-01-01", endDate: "2026-04-30" })).toBe(false)
  })
})

describe("certificate status", () => {
  const on = "2026-06-01"
  test("thresholds", () => {
    expect(certificateStatus(null, on)).toBe("missing")
    expect(certificateStatus({}, on)).toBe("valid")
    expect(certificateStatus({ expiresAt: "2026-05-31" }, on)).toBe("expired")
    expect(certificateStatus({ expiresAt: "2026-06-01" }, on)).toBe("expiring30")
    expect(certificateStatus({ expiresAt: "2026-07-01" }, on)).toBe("expiring30")
    expect(certificateStatus({ expiresAt: "2026-07-02" }, on)).toBe("expiring60")
    expect(certificateStatus({ expiresAt: "2026-07-31" }, on)).toBe("expiring60")
    expect(certificateStatus({ expiresAt: "2026-08-01" }, on)).toBe("valid")
  })

  test("worst status and latest certificate per type", () => {
    expect(worstCertificateStatus([])).toBe("valid")
    expect(worstCertificateStatus(["valid", "expiring30", "expiring60"])).toBe("expiring30")
    expect(worstCertificateStatus(["missing", "expired"])).toBe("expired")
    const latest = latestCertificateByType([
      { certificateTypeId: "a", expiresAt: "2026-01-01" },
      { certificateTypeId: "a", expiresAt: "2027-01-01" },
      { certificateTypeId: "b", expiresAt: "2027-01-01" },
      { certificateTypeId: "b" },
    ])
    expect(latest.get("a")?.expiresAt).toBe("2027-01-01")
    expect(latest.get("b")?.expiresAt).toBeUndefined()
  })
})

describe("assignments", () => {
  const rows = [
    { id: 1, status: "ended" as const, startDate: "2026-01-01", endDate: "2026-02-01" },
    { id: 2, status: "proposed" as const, startDate: "2026-03-01", endDate: "2026-04-01" },
    { id: 3, status: "active" as const, startDate: "2026-03-01", endDate: "2026-04-01" },
    { id: 4, status: "confirmed" as const, startDate: "2026-05-01" },
    { id: 5, status: "cancelled" as const, startDate: "2026-04-10", endDate: "2026-04-20" },
  ]
  test("only confirmed and active ones block", () => {
    expect(overlappingBlocking(rows, { startDate: "2026-03-15", endDate: "2026-03-20" }).map((r) => r.id)).toEqual([3])
    expect(overlappingBlocking(rows, { startDate: "2026-04-02", endDate: "2026-04-30" })).toEqual([])
    expect(overlappingBlocking(rows, { startDate: "2027-01-01" }).map((r) => r.id)).toEqual([4])
  })
  test("current prefers a blocking one; next skips cancelled", () => {
    const { current, next } = currentAndNext(rows, "2026-03-10")
    expect(current?.id).toBe(3)
    expect(next?.id).toBe(4)
  })
})

test("sell rate: project first, then client default", () => {
  expect(sellRateFor("w", [{ tradeId: "w", hourlyRateCents: 4500 }], [{ tradeId: "w", hourlyRateCents: 4000 }])).toBe(4500)
  expect(sellRateFor("w", [], [{ tradeId: "w", hourlyRateCents: 4000 }])).toBe(4000)
  expect(sellRateFor("x", [], [])).toBeNull()
})
