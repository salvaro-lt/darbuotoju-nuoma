import { describe, expect, test } from "vitest"
import {
  allocateHousingCosts,
  allocateIncoming,
  canLiveTogether,
  commonLanguages,
  dayCostCents,
  flatFlags,
  flatStats,
  groupIssues,
  monthRange,
  nationalityAffinity,
  regionOf,
  suggestMoves,
  vehicleStats,
  weekStarts,
  type HousingFlat,
  type HousingPerson,
  type HousingStay,
} from "../src/logistics/housing"

const person = (workerId: string, nationality: string, languages: string[], extra: Partial<HousingPerson> = {}): HousingPerson => ({ workerId, name: workerId, nationality, languages, canDrive: false, ...extra })
const flat = (id: string, beds: number, extra: Partial<HousingFlat> = {}): HousingFlat => ({ id, name: id, region: "Rotterdam", beds, costCents: 300000, costPeriod: "month", startDate: "2026-01-01", endDate: "2027-12-31", ...extra })
const stay = (workerId: string, accommodationId: string, startDate = "2026-10-01", endDate: string | null = "2027-03-31"): HousingStay => ({ workerId, accommodationId, startDate, endDate })

const UA = (id: string, extra: Partial<HousingPerson> = {}) => person(id, "UA", ["uk", "ru"], extra)
const UA_ONLY = (id: string) => person(id, "UA", ["uk"])
const PH = (id: string, extra: Partial<HousingPerson> = {}) => person(id, "PH", ["tl", "en"], extra)
const PL = (id: string) => person(id, "PL", ["pl", "en"])
const LT = (id: string) => person(id, "LT", ["lt", "ru"])

describe("regions", () => {
  test("cities within ~100 km map to Rotterdam; others are their own region", () => {
    expect(regionOf("Schiedam")).toBe("Rotterdam")
    expect(regionOf(" vlissingen ")).toBe("Rotterdam")
    expect(regionOf("Hamburg")).toBe("Hamburg")
  })
})

describe("grouping rules", () => {
  test("a shared language is required", () => {
    expect(commonLanguages([UA("a"), LT("b")])).toEqual(["ru"])
    expect(canLiveTogether([UA("a"), LT("b")])).toBe(true)
    // Two Ukrainians without English and two English-speaking Filipinos can't communicate.
    expect(groupIssues([UA_ONLY("a"), UA_ONLY("b"), PH("c"), PH("d")])).toEqual(["no_common_language"])
    expect(canLiveTogether([PH("c"), PL("d")])).toBe(true)
  })
  test("one person is always fine; empty language lists never share", () => {
    expect(groupIssues([person("a", "LT", [])])).toEqual([])
    expect(groupIssues([person("a", "LT", []), person("b", "LT", [])])).toEqual(["no_common_language"])
  })
  test("gender only when stored", () => {
    expect(groupIssues([PH("a", { gender: "f" }), PH("b", { gender: "m" })])).toEqual(["mixed_gender"])
    expect(groupIssues([PH("a", { gender: "f" }), PH("b")])).toEqual([])
  })
  test("a flat with a vehicle needs a driver", () => {
    expect(groupIssues([PH("a"), PH("b")], { needsDriver: true })).toEqual(["no_driver"])
    expect(groupIssues([PH("a", { canDrive: true }), PH("b")], { needsDriver: true })).toEqual([])
  })
  test("nationality affinity", () => {
    expect(nationalityAffinity([PH("a"), PL("b")], PH("c"))).toBe(0.5)
    expect(nationalityAffinity([], PH("c"))).toBe(1)
  })
})

describe("occupancy and money", () => {
  test("a full month at a monthly price costs exactly the price; empty beds are the unused share", () => {
    const { from, to } = monthRange("2026-11")
    const s = flatStats(flat("f", 5, { costCents: 250000 }), [stay("a", "f")], from, to)
    expect(s.days).toBe(30)
    expect(s.costCents).toBe(250000)
    expect(s.paidBedNights).toBe(150)
    expect(s.usedBedNights).toBe(30)
    expect(s.occupancy).toBeCloseTo(0.2)
    expect(s.emptyBedCents).toBe(200000)
    // One person pays the whole flat: 2500 € per occupied bed.
    expect(s.costPerOccupiedBedCents).toBe(250000)
  })
  test("per-night prices and partial leases", () => {
    expect(dayCostCents(4500, "night", "2026-11-03")).toBe(4500)
    const s = flatStats(flat("f", 2, { costCents: 4500, costPeriod: "night", startDate: "2026-11-25" }), [], "2026-11-01", "2026-11-30")
    expect(s.days).toBe(6)
    expect(s.costCents).toBe(27000)
    expect(s.costPerOccupiedBedCents).toBeNull()
  })
  test("weeks start on Mondays", () => {
    expect(weekStarts("2026-11-11", 2)).toEqual(["2026-11-09", "2026-11-16"])
  })
  test("flags: 1 person in a 5-bed flat, empty flat, no common language, lease ending", () => {
    const people = new Map([UA_ONLY("a"), PH("b"), PH("c")].map((p) => [p.workerId, p]))
    const today = "2026-11-11"
    const month = (f: HousingFlat, st: HousingStay[]) => flatStats(f, st, "2026-11-01", "2026-11-30")
    const lonely = flat("l", 5)
    expect(flatFlags(lonely, [stay("a", "l")], people, today, month(lonely, [stay("a", "l")])).map((f) => f.kind)).toEqual(["lonely"])
    const empty = flat("e", 4, { endDate: "2026-11-30" })
    expect(flatFlags(empty, [], people, today, month(empty, [])).map((f) => f.kind)).toEqual(["empty", "lease_ending"])
    const mixed = [stay("a", "m"), stay("b", "m"), stay("c", "m")]
    expect(flatFlags(flat("m", 3), mixed, people, today, month(flat("m", 3), mixed)).map((f) => f.kind)).toEqual(["no_common_language"])
  })
})

describe("consolidation optimizer", () => {
  const people = [UA_ONLY("v"), UA("b1"), UA("b2"), UA("b3"), PL("p1"), PL("p2"), PH("j1"), PH("j2"), PH("j3")]

  test("empties the 1-person flat into a compatible occupied flat and reports the saving", () => {
    const flats = [flat("vlaardingen", 5, { costCents: 295000 }), flat("dordrecht", 8), flat("charlois", 4)]
    const stays = [stay("v", "vlaardingen"), stay("b1", "dordrecht"), stay("b2", "dordrecht"), stay("j1", "charlois")]
    const out = suggestMoves({ flats, stays, people, from: "2026-11-12" })
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ sourceId: "vlaardingen", monthlySavingCents: 295000, occupied: 1, beds: 5 })
    // Ukrainian-only speaker goes to the Ukrainians, not to the English-speaking Filipino.
    expect(out[0]!.moves).toEqual([{ workerId: "v", toId: "dordrecht", from: "2026-11-12", to: "2027-03-31" }])
  })

  test("doesn't move anyone when the whole group can't be placed (no partial moves)", () => {
    // Two Poles (pl, en); the only free bed with English speakers is one bed in the Filipino flat.
    const flats = [flat("spijkenisse", 5), flat("maassluis", 4), flat("dordrecht", 4)]
    const stays = [stay("p1", "spijkenisse"), stay("p2", "spijkenisse"), stay("j1", "maassluis"), stay("j2", "maassluis"), stay("j3", "maassluis"), stay("b1", "dordrecht")]
    const out = suggestMoves({ flats, stays, people, from: "2026-11-12" })
    // Spijkenisse (40 %) stays; Dordrecht (25 %) has no compatible target either (Poles/Filipinos don't speak Ukrainian/Russian).
    expect(out.find((s) => s.sourceId === "spijkenisse")).toBeUndefined()
  })

  test("respects capacity on every day of the stay, other regions and legacy project flats", () => {
    const flats = [
      flat("small", 5),
      flat("busy", 2),
      flat("far", 6, { region: "Hamburg" }),
      flat("project", 6, { projectId: "p1" }),
    ]
    // `busy` has one free bed now, but someone arrives in December.
    const stays = [stay("v", "small"), stay("b1", "busy"), stay("b2", "busy", "2026-12-01", "2027-01-31")]
    // Only `small` (1 of 5) is under the threshold; its resident fits nowhere for the whole stay.
    expect(suggestMoves({ flats, stays, people, from: "2026-11-12", minOccupancy: 0.3 })).toEqual([])
    // Without the December arrival he fits.
    expect(suggestMoves({ flats, stays: stays.slice(0, 2), people, from: "2026-11-12", minOccupancy: 0.3 })[0]?.moves).toEqual([{ workerId: "v", toId: "busy", from: "2026-11-12", to: "2027-03-31" }])
  })

  test("a flat that receives people is never emptied afterwards", () => {
    const flats = [flat("a", 5, { costCents: 100000 }), flat("b", 5, { costCents: 200000 }), flat("c", 6)]
    const stays = [stay("b1", "a"), stay("b2", "b"), stay("b3", "c"), stay("v", "c"), stay("p1", "c")]
    // c is at 50 % but also a target; a and b move into c (no Pole/Ukrainian-only conflict: p1 speaks no uk/ru).
    const out = suggestMoves({ flats, stays, people: [UA("b1"), UA("b2"), UA("b3"), UA("v"), UA("p1")], from: "2026-11-12" })
    const sources = out.map((s) => s.sourceId)
    expect(sources).toContain("a")
    expect(sources).toContain("b")
    expect(sources).not.toContain("c")
  })
})

describe("incoming team allocation", () => {
  test("fills paid beds in occupied flats first, keeps language rules, opens an empty flat only when needed", () => {
    const flats = [flat("empty", 6), flat("ua", 4), flat("pl", 5), flat("other-region", 6, { region: "Hamburg" })]
    const stays = [stay("b1", "ua"), stay("b2", "ua"), stay("p1", "pl"), stay("p2", "pl")]
    const people = [UA("b1"), UA("b2"), PL("p1"), PL("p2"), PH("n1"), PH("n2"), PH("n3"), PH("n4", { canDrive: true })]
    const incoming = ["n1", "n2", "n3", "n4"].map((workerId) => ({ workerId, projectId: "p", region: "Rotterdam", startDate: "2026-11-16", endDate: "2027-01-31" }))
    const res = allocateIncoming({ flats, stays, people, incoming })
    expect(res.unplaced).toEqual([])
    const where = Object.fromEntries(res.placed.map((p) => [p.workerId, p.accommodationId]))
    // 3 paid beds in the Polish flat (shared English) are used before the empty flat; nobody goes to the Ukrainian flat.
    expect(Object.values(where).filter((f) => f === "pl")).toHaveLength(3)
    expect(Object.values(where).filter((f) => f === "empty")).toHaveLength(1)
    expect(Object.values(where)).not.toContain("ua")
    expect(Object.values(where)).not.toContain("other-region")
  })

  test("reports why someone has no bed", () => {
    const res = allocateIncoming({
      flats: [flat("ua", 2)],
      stays: [stay("b1", "ua")],
      people: [UA("b1"), PH("n1"), UA("n2")],
      incoming: [
        { workerId: "n1", projectId: "p", region: "Rotterdam", startDate: "2026-11-16", endDate: "2026-12-31" },
        { workerId: "n2", projectId: "p", region: "Antwerpen", startDate: "2026-11-16", endDate: "2026-12-31" },
      ],
    })
    expect(res.placed).toEqual([])
    expect(res.unplaced).toEqual(
      expect.arrayContaining([
        { workerId: "n1", reason: "no_compatible_flat" },
        { workerId: "n2", reason: "no_flat_in_region" },
      ]),
    )
  })
})

describe("vehicles and project costs", () => {
  test("monthly vehicle cost, cost per km and consumption", () => {
    const v = { id: "van", costCents: 93000, costPeriod: "month" as const, startDate: "2026-01-01", endDate: "2027-01-01" }
    const logs = [
      { vehicleId: "van", date: "2026-11-03", kind: "fuel" as const, km: 600, litres: 60, costCents: 11340 },
      { vehicleId: "van", date: "2026-11-20", kind: "service" as const, km: 0, litres: 0, costCents: 42000 },
      { vehicleId: "van", date: "2026-10-20", kind: "fuel" as const, km: 500, litres: 50, costCents: 9450 },
    ]
    const s = vehicleStats(v, logs, "2026-11-01", "2026-11-30")
    expect(s).toMatchObject({ fixedCents: 93000, fuelCents: 11340, serviceCents: 42000, totalCents: 146340, km: 600, litresPer100Km: 10 })
    expect(s.costPerKmCents).toBe(Math.round(146340 / 600))
  })

  test("a flat's rent is shared by its residents' projects, empty beds included; empty pool flats are unallocated", () => {
    const flats = [flat("shared", 4, { costCents: 300000 }), flat("idle", 3, { costCents: 150000 })]
    const stays = [stay("a", "shared"), stay("b", "shared")]
    const spans = [
      { workerId: "a", projectId: "P1", startDate: "2026-01-01", endDate: null },
      { workerId: "b", projectId: "P2", startDate: "2026-01-01", endDate: null },
    ]
    const vehicles = [{ id: "van", costCents: 60000, costPeriod: "month" as const, startDate: "2026-01-01", endDate: "2027-01-01", accommodationId: "shared" }]
    const out = allocateHousingCosts({ flats, stays, spans, vehicles, logs: [], from: "2026-11-01", to: "2026-11-30" })
    const p1 = out.projects.find((p) => p.projectId === "P1")!
    expect(p1.accommodationCents).toBe(150000)
    expect(p1.emptyBedCents).toBe(75000)
    expect(p1.vehicleCents).toBe(30000)
    expect(p1.bedNights).toBe(30)
    expect(out.unallocatedCents).toBe(150000)
    expect(out.totalCents).toBe(300000 + 150000 + 60000)
  })
})
