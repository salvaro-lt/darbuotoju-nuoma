import { describe, expect, test } from "vitest"
import { autoAssignBeds, autoAssignSeats, computePlan, diffSnapshots, groupRuns, hasValidLicence, packingList, planSnapshot, type PlanInput, type PlanMember } from "../src/logistics/pure"

const member = (workerId: string, startDate: string, endDate: string | null, extra: Partial<PlanMember> = {}): PlanMember => ({
  workerId,
  name: workerId.toUpperCase(),
  startDate,
  endDate,
  isDriver: false,
  licenceCategories: [],
  licenceExpiresAt: null,
  sizes: { jacket: "L", trousers: "52", shoes: "43" },
  tradeCodes: ["WELD-MAG"],
  ...extra,
})

const base = (over: Partial<PlanInput> = {}): PlanInput => ({
  today: "2026-11-10",
  from: "2026-11-10",
  to: "2026-11-20",
  members: [member("a", "2026-11-01", "2026-11-30", { isDriver: true, licenceCategories: ["B"], licenceExpiresAt: "2030-01-01" }), member("b", "2026-11-01", "2026-11-30"), member("c", "2026-11-15", "2026-11-30")],
  accommodations: [{ id: "flat", name: "Flat", beds: 2, costCents: 3000, costPeriod: "night", startDate: "2026-11-01", endDate: "2026-11-30" }],
  vehicles: [{ id: "van", plate: "AB 1", seats: 2, costCents: 0, costPeriod: "day", startDate: "2026-11-01", endDate: "2026-11-30" }],
  allocations: [
    { workerId: "a", accommodationId: "flat", vehicleId: "van", driver: true },
    { workerId: "b", accommodationId: "flat", vehicleId: "van", driver: false },
  ],
  travelLegs: [],
  ...over,
})

const kinds = (input: PlanInput) => computePlan(input).warnings.map((w) => `${w.kind}:${w.workerId ?? w.resourceId ?? ""}:${w.from ?? ""}..${w.to ?? ""}`)

describe("logistics plan checks", () => {
  test("a newcomer without bed: beds short, no bed, missing travel; nothing before he arrives", () => {
    expect(kinds(base())).toEqual(["beds_short::2026-11-15..2026-11-20", "no_bed:c:2026-11-15..2026-11-20", "travel_missing:c:2026-11-15..2026-11-15"])
    const short = computePlan(base()).warnings[0]!
    expect([short.count, short.capacity]).toEqual([3, 2])
  })

  test("vehicle without a valid driver; seats short; unbooked leg; missing sizes", () => {
    const input = base({
      members: [member("a", "2026-11-01", "2026-11-30", { isDriver: true, licenceCategories: ["B"], licenceExpiresAt: "2026-11-12" }), member("b", "2026-11-01", "2026-11-30", { sizes: { jacket: "M" } }), member("c", "2026-11-01", "2026-11-30")],
      accommodations: [{ id: "flat", name: "Flat", beds: 3, costCents: 0, costPeriod: "night", startDate: "2026-11-01", endDate: "2026-11-30" }],
      allocations: ["a", "b", "c"].map((w) => ({ workerId: w, accommodationId: "flat", vehicleId: "van", driver: w === "a" })),
      travelLegs: [{ id: "leg1", workerId: "c", direction: "departure", date: "2026-11-18", booked: false, ticketCostCents: 10000 }],
    })
    expect(kinds(input)).toEqual(["seats_short:van:2026-11-10..2026-11-20", "vehicle_no_driver:van:2026-11-13..2026-11-20", "travel_unbooked:c:2026-11-18..2026-11-18", "sizes_missing:b:.."])
  })

  test("empty beds that are paid for show as waste", () => {
    const input = base({ members: [member("a", "2026-11-01", "2026-11-30")], allocations: [{ workerId: "a", accommodationId: "flat", vehicleId: null, driver: false }], vehicles: [] })
    const w = computePlan(input).warnings
    expect(w).toHaveLength(1)
    expect(w[0]).toMatchObject({ kind: "empty_beds", resourceId: "flat", count: 1, cents: 11 * 1500 })
  })

  test("licence: category B and not expired", () => {
    expect(hasValidLicence({ licenceCategories: ["B"], licenceExpiresAt: null }, "2026-11-10")).toBe(true)
    expect(hasValidLicence({ licenceCategories: ["B"], licenceExpiresAt: "2026-11-09" }, "2026-11-10")).toBe(false)
    expect(hasValidLicence({ licenceCategories: ["AM"], licenceExpiresAt: null }, "2026-11-10")).toBe(false)
    expect(groupRuns(["2026-11-01", "2026-11-02", "2026-11-04"])).toEqual([
      { from: "2026-11-01", to: "2026-11-02" },
      { from: "2026-11-04", to: "2026-11-04" },
    ])
  })
})

describe("auto-assign", () => {
  test("beds respect capacity over the whole stay; seats give a driver first", () => {
    const members = [member("a", "2026-11-01", "2026-11-30"), member("b", "2026-11-01", "2026-11-14"), member("c", "2026-11-15", "2026-11-30"), member("d", "2026-11-01", "2026-11-30", { isDriver: true, licenceCategories: ["B"] })]
    const beds = autoAssignBeds({
      today: "2026-11-10",
      horizonEnd: "2026-11-30",
      members,
      allocations: [],
      accommodations: [
        { id: "small", name: "S", beds: 2, costCents: 0, costPeriod: "night", startDate: "2026-11-01", endDate: "2026-11-30" },
        { id: "big", name: "B", beds: 5, costCents: 0, costPeriod: "night", startDate: "2026-11-01", endDate: "2026-11-30" },
      ],
    })
    // a and b fill "small"; c takes b's bed after b leaves; d goes to "big".
    expect(Object.fromEntries(beds)).toEqual({ a: "small", b: "small", d: "big", c: "small" })

    const seats = autoAssignSeats({ today: "2026-11-10", horizonEnd: "2026-11-30", members, allocations: [], vehicles: [{ id: "car", plate: "X", seats: 5, costCents: 0, costPeriod: "day", startDate: "2026-11-01", endDate: "2026-11-30" }] })
    expect(seats.get("d")).toEqual({ vehicleId: "car", driver: true })
    expect([...seats.values()].filter((s) => s.driver)).toHaveLength(1)
  })
})

describe("plan changes and workwear", () => {
  test("diff since acknowledgment: added, removed, changed dates", () => {
    const before = planSnapshot([member("a", "2026-11-01", "2026-11-30"), member("b", "2026-11-01", "2026-11-30")])
    const after = planSnapshot([member("a", "2026-11-01", "2026-12-15"), member("c", "2026-11-20", null)])
    const d = diffSnapshots(before, after)
    expect(d.added.map((e) => e.workerId)).toEqual(["c"])
    expect(d.removed.map((e) => e.workerId)).toEqual(["b"])
    expect(d.changed.map((c) => [c.before.ranges, c.after.ranges])).toEqual([["2026-11-01..2026-11-30", "2026-11-01..2026-12-15"]])
  })

  test("packing list counts sizes in order and lists who misses sizes", () => {
    const p = packingList([
      { workerId: "a", name: "A", sizes: { jacket: "XL", trousers: "52", shoes: "44" }, tradeCodes: ["WELD-MAG"] },
      { workerId: "b", name: "B", sizes: { jacket: "M", trousers: "48", shoes: "44" }, tradeCodes: ["SCAFF"] },
      { workerId: "c", name: "C", sizes: {}, tradeCodes: [] },
    ])
    expect(p.jacket).toEqual([
      { size: "M", count: 1 },
      { size: "XL", count: 1 },
    ])
    expect(p.shoes).toEqual([{ size: "44", count: 2 }])
    expect(p.missing).toEqual([{ workerId: "c", name: "C", fields: ["jacket", "trousers", "shoes"] }])
    expect(p.ppe.find((i) => i.item === "helmet")?.qty).toBe(3)
    expect(p.ppe.find((i) => i.item === "weldingHelmet")?.qty).toBe(1)
    expect(p.ppe.find((i) => i.item === "harness")?.qty).toBe(1)
  })
})
