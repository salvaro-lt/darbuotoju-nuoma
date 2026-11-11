import { describe, expect, test } from "vitest"
import { clientDraftText, describeGap, proposeTeam, rankForLine, teamGaps, type Candidate, type MatchContext, type TeamLine } from "../src/teams/matching"

const PASS = "passport"
const WELD = "iso9606"
const ctx: MatchContext = { startDate: "2030-03-01", endDate: "2030-04-30", mandatoryTypeIds: [PASS], languages: ["en"] }

const cand = (id: string, over: Partial<Candidate> = {}): Candidate => ({
  id,
  name: id,
  source: "own",
  languages: ["lt"],
  trades: [{ tradeId: "MAG", level: "skilled" }],
  driverLicenseCategories: [],
  driverLicenseExpiresAt: null,
  clothingSizes: { jacket: "L", trousers: "50", shoes: "43" },
  certificates: { [PASS]: null, [WELD]: "2031-01-01" },
  previousClientAssignments: 0,
  ...over,
})

describe("teams: ranking", () => {
  const line: TeamLine = { tradeId: "MAG", count: 2, certificateTypeIds: [WELD], drivers: 1 }

  test("level, earlier work for the client, language and licence raise the score; unfit go last", () => {
    const ranked = rankForLine(
      line,
      [
        cand("plain"),
        cand("senior", { trades: [{ tradeId: "MAG", level: "senior" }] }),
        cand("returning", { previousClientAssignments: 2, languages: ["lt", "en"], driverLicenseCategories: ["B"] }),
        cand("expired", { trades: [{ tradeId: "MAG", level: "foreman" }], certificates: { [PASS]: null, [WELD]: "2030-02-01" } }),
        cand("fitter", { trades: [{ tradeId: "FIT", level: "senior" }] }),
      ],
      ctx,
    )
    expect(ranked.map((r) => r.workerId)).toEqual(["returning", "senior", "plain", "expired"])
    expect(ranked.at(-1)!.eligible).toBe(false)
    expect(ranked.at(-1)!.warnings.map((w) => w.code)).toContain("cert_expired")
  })

  test("certificate running out during the project is a warning, not a block", () => {
    const [r] = rankForLine(line, [cand("a", { certificates: { [PASS]: null, [WELD]: "2030-04-01" } })], ctx)
    expect(r!.eligible).toBe(true)
    expect(r!.warnings).toContainEqual({ code: "cert_expires_during", certificateTypeId: WELD, date: "2030-04-01" })
  })
})

describe("teams: proposal and gaps", () => {
  test("swaps in a driver, reports missing people, drivers and certificate-blocked workers", () => {
    const lines: TeamLine[] = [
      { tradeId: "MAG", count: 2, certificateTypeIds: [WELD], drivers: 1 },
      { tradeId: "TIG", count: 2, certificateTypeIds: [], drivers: 1 },
    ]
    const candidates = [
      cand("best", { trades: [{ tradeId: "MAG", level: "senior" }] }),
      cand("second", { trades: [{ tradeId: "MAG", level: "senior" }] }),
      cand("driver", { driverLicenseCategories: ["B"] }),
      cand("tig", { trades: [{ tradeId: "TIG", level: "skilled" }] }),
      cand("tigNoPass", { trades: [{ tradeId: "TIG", level: "senior" }], certificates: {} }),
    ]
    const ranked = lines.map((l) => rankForLine(l, candidates, ctx))
    const picks = proposeTeam(lines, ranked)
    const mag = picks.filter((p) => p.lineIndex === 0)
    expect(mag.map((p) => p.workerId).sort()).toEqual(["best", "driver"])
    expect(mag.find((p) => p.workerId === "driver")!.isDriver).toBe(true)
    expect(picks.filter((p) => p.lineIndex === 1).map((p) => p.workerId)).toEqual(["tig"])

    const gaps = teamGaps(lines, picks, ranked)
    expect(gaps).toContainEqual({ kind: "people", lineIndex: 1, tradeId: "TIG", missing: 1 })
    expect(gaps).toContainEqual({ kind: "drivers", lineIndex: 1, tradeId: "TIG", needed: 1, have: 0 })
    expect(gaps).toContainEqual({ kind: "blocked_by_certificate", lineIndex: 1, tradeId: "TIG", certificateTypeId: PASS, workers: 1 })
    expect(gaps.some((g) => g.kind === "people" && g.lineIndex === 0)).toBe(false)

    const names = { trade: (id: string) => id, certificate: (id: string) => id }
    expect(describeGap(gaps.find((g) => g.kind === "people")!, names, "lt")).toBe("TIG: trūksta 1 žm. → ieškoti per subrangą")
  })

  test("a picked worker who is no longer free is reported busy", () => {
    const lines: TeamLine[] = [{ tradeId: "MAG", count: 1, certificateTypeIds: [], drivers: 0 }]
    const gaps = teamGaps(lines, [{ lineIndex: 0, workerId: "gone", isDriver: false }], [[]], { gone: "Jonas" })
    expect(gaps).toEqual([{ kind: "busy", lineIndex: 0, workerId: "gone", name: "Jonas" }])
  })
})

describe("teams: client draft", () => {
  test("lists the team and the open positions", () => {
    const text = clientDraftText({
      clientName: "Demo Yard",
      contactName: "Ola",
      projectLabel: "Hull blocks",
      site: "Bergen, NO",
      startDate: "2030-03-01",
      endDate: "2030-04-30",
      lines: [{ trade: "MAG welder", count: 2, members: [{ name: "Jonas", level: "senior", isDriver: true, certificates: ["EN ISO 9606-1"] }] }],
      openPositions: ["MAG welder: 1 more needed"],
    })
    expect(text).toContain("Dear Ola,")
    expect(text).toContain("We can offer 1 of the 2")
    expect(text).toContain("• Jonas (senior; driver; EN ISO 9606-1)")
    expect(text).toContain("• MAG welder: 1 more needed")
  })
})
