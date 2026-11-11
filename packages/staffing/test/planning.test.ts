import { describe, expect, test } from "vitest"
import { availabilityBlocks } from "../src/pure"
import { capacityAnswer, capacityReply, mondayOf, nextMonday, supplyDemand, weekCell, weeksFrom, workerStatusOn, type PlanData, type PlanWorker } from "../src/planning/pure"
import { applyTeamRules, describeRuleWarning, driversNeeded, evaluateTeamRules, housingGroups, isolatedMembers, resolveTeamRules, DEFAULT_TEAM_RULES, type RuleCandidate, type RuleMember } from "../src/planning/rules"

// ---------------------------------------------------------------- rules

const m = (id: string, nationality: string, languages: string[], canDrive = false): RuleMember => ({ workerId: id, name: id, nationality, languages, canDrive })

describe("planning: team composition rules", () => {
  test("defaults and clamping", () => {
    expect(resolveTeamRules(null)).toEqual(DEFAULT_TEAM_RULES)
    expect(resolveTeamRules({ driversPerPeople: -3, housingGroupSize: 0 })).toMatchObject({ driversPerPeople: 0, housingGroupSize: 1 })
    expect(driversNeeded(9, DEFAULT_TEAM_RULES)).toBe(3)
    expect(driversNeeded(9, { ...DEFAULT_TEAM_RULES, driversPerPeople: 0 })).toBe(0)
  })

  test("at least one driver per N people", () => {
    const team = [m("a", "LT", ["lt"], true), m("b", "LT", ["lt"]), m("c", "LT", ["lt"]), m("d", "LT", ["lt"]), m("e", "LT", ["lt", "en"])]
    expect(evaluateTeamRules(team, DEFAULT_TEAM_RULES)).toContainEqual({ code: "drivers", needed: 2, have: 1 })
    expect(evaluateTeamRules(team, { ...DEFAULT_TEAM_RULES, driversPerPeople: 5 }).some((w) => w.code === "drivers")).toBe(false)
  })

  test("English per team or per housing group", () => {
    const team = [m("ua1", "UA", ["uk", "ru"], true), m("ua2", "UA", ["uk", "ru"]), m("ph1", "PH", ["tl", "en"], true), m("ph2", "PH", ["tl", "en"])]
    expect(evaluateTeamRules(team, DEFAULT_TEAM_RULES).some((w) => w.code === "no_english")).toBe(false)
    const housing = evaluateTeamRules(team, { ...DEFAULT_TEAM_RULES, english: "housing" })
    expect(housing).toContainEqual({ code: "no_english_in_group", nationality: "UA", names: ["ua1", "ua2"] })
    expect(evaluateTeamRules([m("a", "UA", ["uk"])], DEFAULT_TEAM_RULES)).toContainEqual({ code: "no_english" })
    expect(evaluateTeamRules([m("a", "UA", ["uk"])], { ...DEFAULT_TEAM_RULES, english: "off", driversPerPeople: 0 })).toEqual([])
  })

  test("language compatibility: two Ukrainians without English and two English-speaking Filipinos still talk via the leader", () => {
    // The interview's example: technically right, but the halves can't talk to each other.
    const halves = [m("ua1", "UA", ["uk"]), m("ua2", "UA", ["uk"]), m("ph1", "PH", ["tl", "en"]), m("ph2", "PH", ["tl", "en"])]
    expect(isolatedMembers(halves)).toEqual([])
    const lonely = [...halves, m("ro", "RO", ["ro"])]
    expect(isolatedMembers(lonely).map((x) => x.workerId)).toEqual(["ro"])
    expect(evaluateTeamRules(lonely, DEFAULT_TEAM_RULES)).toContainEqual({ code: "isolated", workerId: "ro", name: "ro", languages: ["ro"] })
  })

  test("housing hint: 4 Filipinos → one flat and one car", () => {
    const team = [m("p1", "PH", ["tl", "en"], true), m("p2", "PH", ["tl", "en"]), m("p3", "PH", ["tl", "en"]), m("p4", "PH", ["tl", "en"]), m("l1", "LT", ["lt", "en"], true)]
    const groups = housingGroups(team, DEFAULT_TEAM_RULES)
    expect(groups[0]).toMatchObject({ nationality: "PH", units: 1, drivers: 1, languages: ["tl", "en"] })
    const hint = evaluateTeamRules(team, DEFAULT_TEAM_RULES).find((w) => w.code === "housing")!
    expect(describeRuleWarning(hint, "lt")).toBe("4 filipiniečiai → vienas būstas ir automobilis")
    expect(describeRuleWarning(hint, "en")).toBe("4 Filipinos → one flat and one car")
    // One lone Lithuanian gets no hint.
    expect(evaluateTeamRules(team, DEFAULT_TEAM_RULES).filter((w) => w.code === "housing")).toHaveLength(1)
  })

  test("the engine swaps the weakest pick for a driver, an English speaker, a compatible member", () => {
    const c = (id: string, score: number, languages: string[], canDrive = false, eligible = true): RuleCandidate => ({ workerId: id, name: id, nationality: "XX", languages, canDrive, eligible, score })
    const line = [c("a", 50, ["uk", "ru"]), c("b", 40, ["uk", "ru"]), c("c", 30, ["uk", "ru"]), c("d", 20, ["uk", "ru"]), c("drv", 10, ["uk", "ru"], true), c("eng", 5, ["ru", "en"]), c("unfit", 99, ["en"], true, false)]
    const picks = ["a", "b", "c", "d"].map((workerId) => ({ lineIndex: 0, workerId, isDriver: false }))
    const out = applyTeamRules(picks, [line], DEFAULT_TEAM_RULES)
    expect(out.picks.map((p) => p.workerId).sort()).toEqual(["a", "b", "drv", "eng"])
    expect(out.swaps).toEqual([
      { lineIndex: 0, out: "d", in: "drv", reason: "drivers" },
      { lineIndex: 0, out: "c", in: "eng", reason: "english" },
    ])
    expect(picks.map((p) => p.workerId)).toEqual(["a", "b", "c", "d"]) // input untouched

    const lonely = [c("x", 50, ["lt"]), c("y", 40, ["lt"]), c("ro", 30, ["ro"]), c("z", 5, ["lt", "en"], true)]
    const res = applyTeamRules(
      ["x", "y", "ro"].map((workerId) => ({ lineIndex: 0, workerId, isDriver: false })),
      [lonely],
      { ...DEFAULT_TEAM_RULES, english: "off", driversPerPeople: 0 },
    )
    expect(res.picks.map((p) => p.workerId)).toEqual(["x", "y", "z"])
    expect(res.swaps[0]!.reason).toBe("language")
  })
})

// ---------------------------------------------------------------- board and capacity

const TODAY = "2026-11-11" // Wednesday
const W = (id: string, tradeIds: string[], over: Partial<PlanWorker> = {}): PlanWorker => ({ id, name: id, nationality: "LT", languages: ["lt"], source: "own", subcontractorClientId: null, tradeIds, ...over })

function data(): PlanData {
  return {
    workers: [
      W("reserve", ["MAG"]),
      W("ending", ["MAG"]),
      W("ending-rest", ["MAG"]),
      W("rested", ["TIG"]),
      W("busy", ["MAG"]),
      W("later", ["MAG"]),
      W("fitter", ["FIT"]),
      W("sub1", ["MAG"], { source: "subcontractor", subcontractorClientId: "S1" }),
    ],
    assignments: [
      { workerId: "ending", projectId: "p1", projectCode: "RDW-05", clientId: "c", startDate: "2026-10-01", endDate: "2026-11-13", status: "active" },
      { workerId: "ending-rest", projectId: "p1", projectCode: "RDW-05", clientId: "c", startDate: "2026-10-01", endDate: "2026-11-13", status: "active" },
      { workerId: "busy", projectId: "p2", projectCode: "BST-03", clientId: "c", startDate: "2026-09-01", endDate: null, status: "active" },
      { workerId: "later", projectId: "p3", projectCode: "BDI-09", clientId: "c", startDate: "2026-10-12", endDate: "2026-11-20", status: "active" },
      { workerId: "reserve", projectId: "p4", projectCode: "X-1", clientId: "c", startDate: "2026-11-16", endDate: "2026-12-31", status: "proposed" },
    ],
    availability: [
      { workerId: "ending-rest", kind: "rest", startDate: "2026-11-14", endDate: "2026-11-27", note: "Namo" },
      { workerId: "rested", kind: "rest", startDate: "2026-10-30", endDate: "2026-11-15", note: "" },
    ],
    capacities: [
      { clientId: "S1", clientName: "Sub One", tradeId: "MAG", count: 3, validFrom: "2026-11-01", validTo: null },
      { clientId: "S2", clientName: "Sub Two", tradeId: "TIG", count: 2, validFrom: "2026-12-01", validTo: null },
    ],
    demand: [{ requestId: "r1", clientName: "RDW", label: "Sekcijos", tradeId: "MAG", count: 6, startDate: "2026-11-16", endDate: "2026-12-31" }],
  }
}

describe("planning: weeks, timelines, board", () => {
  test("weeks start on Monday", () => {
    expect(mondayOf(TODAY)).toBe("2026-11-09")
    expect(mondayOf("2026-11-15")).toBe("2026-11-09") // Sunday
    expect(nextMonday(TODAY)).toBe("2026-11-16")
    expect(weeksFrom(TODAY, 2).map((w) => [w.start, w.end, w.number])).toEqual([
      ["2026-11-09", "2026-11-15", 46],
      ["2026-11-16", "2026-11-22", 47],
    ])
  })

  test("available-from blocks every day before it", () => {
    expect(availabilityBlocks({ kind: "available_from", startDate: "2026-11-20" }, { startDate: "2026-11-16", endDate: "2026-11-30" })).toBe(true)
    expect(availabilityBlocks({ kind: "available_from", startDate: "2026-11-20" }, { startDate: "2026-11-20" })).toBe(false)
    expect(availabilityBlocks({ kind: "rest", startDate: "2026-11-20", endDate: "2026-11-27" }, { startDate: "2026-11-28" })).toBe(false)
  })

  test("worker status: Dirba / Namuose iki … / Rezerve", () => {
    const d = data()
    expect(workerStatusOn("ending", TODAY, d)).toMatchObject({ state: "working", until: "2026-11-13", projectCode: "RDW-05" })
    expect(workerStatusOn("ending-rest", "2026-11-18", d)).toMatchObject({ state: "resting", until: "2026-11-27" })
    expect(workerStatusOn("ending-rest", TODAY, d).next).toMatchObject({ kind: "rest", startDate: "2026-11-14" })
    expect(workerStatusOn("reserve", TODAY, d)).toMatchObject({ state: "reserve", next: { kind: "project", label: "X-1" } })
  })

  test("week cells: project, ending, rest, proposed, free", () => {
    const d = data()
    const [w1, w2] = weeksFrom(TODAY, 2) as [ReturnType<typeof weeksFrom>[number], ReturnType<typeof weeksFrom>[number]]
    expect(weekCell("ending", w1, d)).toEqual({ state: "ending", label: "RDW-05", until: "2026-11-13" })
    expect(weekCell("ending", w2, d)).toEqual({ state: "free", label: null, until: null })
    expect(weekCell("ending-rest", w2, d)).toMatchObject({ state: "rest", label: "Namo" })
    expect(weekCell("busy", w2, d)).toMatchObject({ state: "project", label: "BST-03" })
    expect(weekCell("reserve", w2, d)).toMatchObject({ state: "proposed", label: "X-1" })
  })

  test("supply vs demand per week and trade", () => {
    const [, w2, w3] = supplyDemand(weeksFrom(TODAY, 3), data(), ["MAG", "TIG"])
    const mag2 = w2!.trades.find((t) => t.tradeId === "MAG")!
    // Free all week 2: reserve, ending (own); sub1 (registered) vs declared 3 → 3.
    expect(mag2).toEqual({ tradeId: "MAG", own: 2, subcontractor: 3, supply: 5, demand: 6, gap: -1 })
    expect(w3!.trades.find((t) => t.tradeId === "MAG")).toMatchObject({ own: 3, gap: 0 })
    // The project ended on the Friday before: one is free, the other went home to rest.
    expect(w2!.freed).toBe(1)
    expect(w2!.back).toBe(1)
  })
})

describe("planning: quick capacity answer", () => {
  test("own reserve, freed by ending projects, back from rest, subcontractors, shortfall", () => {
    const a = capacityAnswer({ tradeIds: ["MAG", "TIG"], count: 8, from: "2026-11-16", today: TODAY }, data())
    expect(a.question.to).toBe("2026-12-13") // four weeks
    expect(a.ownFree.map((p) => p.workerId)).toEqual(["reserve"])
    expect(a.freedByEnding).toEqual([{ workerId: "ending", name: "ending", date: "2026-11-13", label: "RDW-05" }])
    expect(a.backFromRest.map((p) => p.workerId)).toEqual(["rested"])
    // S1: max(declared 3, registered 1); S2 (TIG) only from December.
    expect(a.subcontractors).toEqual([{ clientId: "S1", name: "Sub One", declared: 3, registered: 1, count: 3 }])
    expect(a.total).toBe(6)
    expect(a.shortfall).toBe(2)
    expect(a.freedLater.map((p) => [p.workerId, p.date])).toEqual([
      ["later", "2026-11-21"],
      ["ending-rest", "2026-11-28"],
    ])

    const r = capacityReply(a, { lt: "suvirintojų", en: "welders" }, "lt")
    expect(r.internal).toBe(
      "Ne visus: nuo pirmadienio (2026-11-16) galime 6 iš 8 suvirintojų, trūksta 2. Iš jų: savi laisvi 1, atsilaisvina iš baigiamų projektų 1, grįžta po poilsio 1, subranga 3. Per 2 sav. atsilaisvins dar 2 (pirmieji nuo 2026-11-21).",
    )
    expect(r.client).toContain("dar 2 – nuo 2026-11-28")
    const yes = capacityReply(capacityAnswer({ tradeIds: ["MAG"], count: 3, from: "2026-11-16", today: TODAY }, data()), { lt: "suvirintojų", en: "welders" }, "en")
    expect(yes.client).toBe("Hello, yes – we can supply 3 welders from Monday 2026-11-16. We will send the team list and documents today.")
  })
})
