import { describe, expect, test } from "vitest"
import {
  aggregateRawRows,
  compareSources,
  disputeAmountCents,
  disputeTotals,
  matchIntake,
  minutesBetween,
  rawRowsFromAiAnswer,
  senderDomain,
  threeWay,
  WORKER_TOKEN,
  type RawClientRow,
} from "../src/timesheets/pure"
import { demoWorkerToken } from "../src/timesheets/seed-sources"

describe("timesheets: many-row client exports", () => {
  test("20 scan lines of 13 minutes plus setup lines sum to one day per worker", () => {
    const raw: RawClientRow[] = [
      ...Array.from({ length: 20 }, (_, i) => ({ name: "KOVALENKO Taras", date: "2026-10-21", minutes: 13, ref: `Teil 4711-${i}` })),
      { name: "KOVALENKO Taras", date: "2026-10-21", minutes: 110, ref: "Rüstzeit" },
      { name: "KOVALENKO  Taras ", date: "2026-10-21", minutes: 110, ref: "Reinigung" },
      { name: "KOVALENKO Taras", date: "2026-10-22", minutes: 13 * 18 + 220 },
      { name: "J. Pavyzdys", date: "2026-10-21", minutes: 480 },
      { name: "", date: "2026-10-21", minutes: 60 },
      { name: "X", date: "21.10.", minutes: 60 },
      { name: "Y", date: "2026-10-21", minutes: 0 },
    ]
    expect(aggregateRawRows(raw)).toEqual([
      { name: "J. Pavyzdys", date: "2026-10-21", hours: 8 },
      { name: "KOVALENKO Taras", date: "2026-10-21", hours: 8 },
      // 454 minutes = 7.57 h → quarter hour
      { name: "KOVALENKO Taras", date: "2026-10-22", hours: 7.5 },
    ])
  })

  test("the AI answer is read line by line: hours, minutes or start/end; junk dropped", () => {
    const text = JSON.stringify({
      rows: [
        { name: "Kovalenko", date: "2026-10-21", minutes: 13, ref: "Teil 1" },
        { name: "Kovalenko", date: "2026-10-21", start: "07:00", end: "07:13" },
        { name: "Kovalenko", date: "2026-10-21", hours: 0.5 },
        { name: "Nightshift", date: "2026-10-21", start: "22:00", end: "06:00" },
        { name: "Bad", date: "yesterday", hours: 8 },
        { name: "Bad", date: "2026-10-21" },
        { name: "", date: "2026-10-21", hours: 8 },
      ],
    })
    const raw = rawRowsFromAiAnswer("```json\n" + text + "\n```")
    expect(raw).toEqual([
      { name: "Kovalenko", date: "2026-10-21", minutes: 13, ref: "Teil 1" },
      { name: "Kovalenko", date: "2026-10-21", minutes: 13 },
      { name: "Kovalenko", date: "2026-10-21", minutes: 30 },
      { name: "Nightshift", date: "2026-10-21", minutes: 480 },
    ])
    expect(aggregateRawRows(raw).find((r) => r.name === "Kovalenko")?.hours).toBe(1)
    expect(rawRowsFromAiAnswer("not json")).toEqual([])
    expect(minutesBetween("7:00", "15:30")).toBe(510)
    expect(minutesBetween("25:00", "15:30")).toBeNull()
  })
})

describe("timesheets: three sources", () => {
  test("which source disagrees", () => {
    expect(compareSources({ worker: 8, ours: 8, client: 8 }).kind).toBe("agree")
    expect(compareSources({ worker: 10, ours: 8, client: 8 })).toEqual({ kind: "worker_differs", claimed: 10, diff: -2 })
    expect(compareSources({ worker: 8, ours: 8, client: 7.5 })).toEqual({ kind: "client_differs", claimed: 8, diff: -0.5 })
    expect(compareSources({ worker: 10, ours: 8, client: 10 })).toEqual({ kind: "ours_differs", claimed: 10, diff: 0 })
    expect(compareSources({ worker: 10, ours: 8, client: 6 }).kind).toBe("all_differ")
    // The worker hasn't entered anything: ours vs client.
    expect(compareSources({ worker: null, ours: 8, client: 0 })).toEqual({ kind: "client_differs", claimed: 8, diff: -8 })
    expect(compareSources({ worker: null, ours: 8, client: null }).kind).toBe("single")
    // A missing coordinator entry counts as 0 when someone else has hours.
    expect(compareSources({ worker: 6, ours: null, client: null })).toEqual({ kind: "worker_differs", claimed: 6, diff: 0 })
    expect(compareSources({ worker: null, ours: null, client: 0 }).kind).toBe("empty")
  })

  test("a week per worker: client-covered days count missing rows as 0; problems first", () => {
    const days = ["2026-11-02", "2026-11-03", "2026-11-04"]
    const res = threeWay({
      days,
      people: [
        { workerId: "a", name: "Aaa Jonas" },
        { workerId: "b", name: "Bbb Petras" },
      ],
      ours: [
        { workerId: "a", date: "2026-11-02", hours: 8 },
        { workerId: "a", date: "2026-11-03", hours: 8 },
        { workerId: "b", date: "2026-11-02", hours: 8 },
        { workerId: "b", date: "2026-11-03", hours: 8 },
      ],
      worker: [
        { workerId: "b", date: "2026-11-02", hours: 8 },
        { workerId: "b", date: "2026-11-03", hours: 10 },
      ],
      client: [
        { workerId: "a", date: "2026-11-02", hours: 8 },
        { workerId: "b", date: "2026-11-02", hours: 8 },
        { workerId: "b", date: "2026-11-03", hours: 10 },
      ],
      clientCovered: ["2026-11-02", "2026-11-03"],
      flags: [{ workerId: "a", date: "2026-11-03", comment: "dirbau" }],
    })
    const [first, second] = res.rows
    // Jonas: client has nothing on the 3rd (covered → 0) and he flagged it.
    expect(first!.workerId).toBe("a")
    expect(first!.days["2026-11-03"]).toMatchObject({ client: 0, kind: "client_differs", diff: -8, flag: "dirbau" })
    expect(first!.days["2026-11-04"]).toMatchObject({ client: null, kind: "empty" })
    expect(first!.totals).toMatchObject({ ours: 16, client: 8, diff: -8 })
    // Petras: our coordinator missed 2 h the worker and the client agree on.
    expect(second!.days["2026-11-03"]!.kind).toBe("ours_differs")
    expect(res.totals).toMatchObject({ disagreements: 2, flags: 1, ours: 32, client: 26, worker: 18 })
  })
})

describe("timesheets: disputes", () => {
  test("amounts and the open total", () => {
    expect(disputeAmountCents(66.25, 4550)).toBe(301_438)
    expect(disputeAmountCents(-2, 4550)).toBe(9100)
    const t = disputeTotals([
      { status: "open", hours: 40, amountCents: 180_000 },
      { status: "waiting_client", hours: 93.5, amountCents: 420_000 },
      { status: "resolved_accepted", hours: 4, amountCents: 18_000 },
      { status: "resolved_compensated", hours: 6, amountCents: 27_000 },
      { status: "rejected", hours: 1, amountCents: 4_500 },
    ])
    expect(t).toEqual({ open: 2, openHours: 133.5, openCents: 600_000, resolved: 3, recoveredCents: 18_000, compensatedCents: 27_000, rejectedCents: 4_500 })
  })
})

describe("timesheets: email intake", () => {
  const clients = [
    { id: "c1", emails: ["pm@nordic-yard.example"] },
    { id: "c2", emails: ["Anna <planning@bst.example>"] },
  ]
  const projects = [
    { id: "p1", code: "NDS-2026-07", clientId: "c1", status: "active" },
    { id: "p2", code: "BST-2026-03", clientId: "c2", status: "active" },
    { id: "p3", code: "BST-2025-11", clientId: "c2", status: "finished" },
  ]

  test("project code wins, then sender domain with one active project", () => {
    expect(matchIntake({ from: "someone@gmail.com", subject: "Stundennachweis KW44 – BST-2026-03", fileNames: [] }, clients, projects)).toEqual({ clientId: "c2", projectId: "p2", by: "project_code" })
    expect(matchIntake({ from: "x@other.example", subject: "Timesheet", fileNames: ["nds-2026-07_week44.pdf"] }, clients, projects)).toMatchObject({ projectId: "p1", by: "project_code" })
    expect(matchIntake({ from: "Lars <lars@Nordic-Yard.example>", subject: "Timeliste uke 44", fileNames: ["export.pdf"] }, clients, projects)).toEqual({ clientId: "c1", projectId: "p1", by: "sender_domain" })
    expect(matchIntake({ from: "x@unknown.example", subject: "Urenstaat", fileNames: [] }, clients, projects)).toEqual({ clientId: null, projectId: null, by: null })
    // Codes are matched whole: NDS-2026-070 is not NDS-2026-07.
    expect(matchIntake({ from: "x@unknown.example", subject: "NDS-2026-070", fileNames: [] }, clients, projects).projectId).toBeNull()
    expect(senderDomain("someone@gmail.com")).toBeNull()
  })

  test("several active projects of the client: the client only", () => {
    const more = [...projects, { id: "p4", code: "NDS-2026-12", clientId: "c1", status: "active" }]
    expect(matchIntake({ from: "pm@nordic-yard.example", subject: "Timeliste", fileNames: [] }, clients, more)).toEqual({ clientId: "c1", projectId: null, by: "sender_domain" })
  })
})

describe("timesheets: worker links", () => {
  test("demo tokens pass the token guard; junk does not", () => {
    const t = demoWorkerToken({ firstName: "Jonas", lastName: "Pavyzdys" })
    expect(t).toMatch(/^demo-pavyzdys-[0-9a-f]{12}$/)
    expect(WORKER_TOKEN.test(t)).toBe(true)
    expect(WORKER_TOKEN.test(demoWorkerToken({ firstName: "Krzysztof", lastName: "Próbny" }))).toBe(true)
    for (const bad of ["", "short", "x".repeat(65), "demo-pavyzdys-1234567/../..", "demo pavyzdys 123456789"]) expect(WORKER_TOKEN.test(bad)).toBe(false)
  })
})
