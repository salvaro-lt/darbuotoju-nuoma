import { describe, expect, test } from "vitest"
import { rowsFromAiAnswer } from "../src/timesheets/ai"
import { hoursProblem, lastCompletedPeriodEnd, matchWorker, parseCsv, parseDateCell, parseHoursCell, reconcile, rowsFromTable, splitHours, timesheetDue, weekStartOf } from "../src/timesheets/pure"

const W = [
  { id: "w1", firstName: "Jonas", lastName: "Pavyzdys" },
  { id: "w2", firstName: "Serhii", lastName: "Zrazkovych" },
  { id: "w3", firstName: "Krzysztof", lastName: "Próbny" },
  { id: "w4", firstName: "Petras", lastName: "Bandomasis" },
]

describe("timesheets: weeks and hours", () => {
  test("week starts on Monday; totals split at 8 h", () => {
    expect(weekStartOf("2026-11-11")).toBe("2026-11-09")
    expect(weekStartOf("2026-11-15")).toBe("2026-11-09")
    expect(splitHours(10)).toEqual({ regular: 8, overtime: 2 })
    expect(splitHours(7.6)).toEqual({ regular: 7.5, overtime: 0 })
    expect(hoursProblem(8, 2)).toBeNull()
    expect(hoursProblem(20, 5)).toBe("too_many_hours")
    expect(hoursProblem(8.1, 0)).toBe("invalid_hours_step")
  })

  test("cells: dates and hours in client formats", () => {
    expect(parseDateCell("03.11.2026")).toBe("2026-11-03")
    expect(parseDateCell("3/11/26")).toBe("2026-11-03")
    expect(parseDateCell("03.11.", 2026)).toBe("2026-11-03")
    expect(parseDateCell(46329)).toBe("2026-11-03")
    expect(parseDateCell("31.02.2026")).toBeNull()
    expect(parseHoursCell("7,5")).toBe(7.5)
    expect(parseHoursCell("7:30")).toBe(7.5)
    expect(parseHoursCell("8h")).toBe(8)
    expect(parseHoursCell("x")).toBeNull()
  })
})

describe("timesheets: reading client tables", () => {
  test("long CSV with a title row and semicolons", () => {
    const csv = 'Timeliste uke 45;;\nNavn;Dato;Timer\n"PAVYZDYS Jonas";03.11.2026;10\nJ. Pavyzdys;04.11.2026;8\n'
    expect(rowsFromTable(parseCsv(csv))).toEqual([
      { name: "PAVYZDYS Jonas", date: "2026-11-03", hours: 10 },
      { name: "J. Pavyzdys", date: "2026-11-04", hours: 8 },
    ])
  })

  test("wide sheet: one row per worker, a column per day, totals skipped", () => {
    const table = [
      ["Name", "02.11.", "03.11.", "Sum"],
      ["Zrazkovich Sergii", 8, "", 8],
      ["Total", 8, 0, 8],
    ]
    expect(rowsFromTable(table, { year: 2026 })).toEqual([{ name: "Zrazkovich Sergii", date: "2026-11-02", hours: 8 }])
  })

  test("AI answers keep only well-formed rows", () => {
    expect(rowsFromAiAnswer('```json\n{"rows":[{"name":"A B","date":"2026-11-03","hours":8},{"name":"","date":"2026-11-03","hours":8},{"name":"C","date":"3.11","hours":8}]}\n```')).toEqual([{ name: "A B", date: "2026-11-03", hours: 8 }])
    expect(rowsFromAiAnswer("not json")).toEqual([])
  })
})

describe("timesheets: name matching and reconciliation", () => {
  test("fuzzy names: order, initials, case, accents and typos", () => {
    expect(matchWorker("PAVYZDYS Jonas", W)?.worker.id).toBe("w1")
    expect(matchWorker("J. Pavyzdys", W)?.worker.id).toBe("w1")
    expect(matchWorker("Zrazkovich Sergii", W)?.worker.id).toBe("w2")
    expect(matchWorker("Probny, Krzysztof", W)?.worker.id).toBe("w3")
    expect(matchWorker("Nobody Known", W)).toBeNull()
  })

  test("per worker per day: ok, diff, missing in ours, missing in theirs, unknown", () => {
    const r = reconcile({
      from: "2026-11-02",
      to: "2026-11-08",
      workers: W,
      ours: [
        { workerId: "w1", date: "2026-11-02", hours: 8 },
        { workerId: "w1", date: "2026-11-03", hours: 8 },
        { workerId: "w3", date: "2026-11-06", hours: 8 },
        { workerId: "w4", date: "2026-11-02", hours: 8 },
      ],
      theirs: [
        { name: "PAVYZDYS Jonas", date: "2026-11-02", hours: 8 },
        { name: "PAVYZDYS Jonas", date: "2026-11-03", hours: 10 },
        { name: "Zrazkovich Sergii", date: "2026-11-07", hours: 6 },
        { name: "Mystery Man", date: "2026-11-02", hours: 8 },
        { name: "B. Petras", date: "2026-11-02", hours: 8 },
        { name: "PAVYZDYS Jonas", date: "2026-11-20", hours: 8 },
      ],
      nameMap: { "B. Petras": "w4" },
    })
    const kinds = Object.fromEntries(r.lines.map((l) => [`${l.workerId ?? l.clientName}|${l.date}`, l.kind]))
    expect(kinds).toEqual({
      "w4|2026-11-02": "ok",
      "w1|2026-11-02": "ok",
      "w1|2026-11-03": "diff",
      "w3|2026-11-06": "missing_theirs",
      "w2|2026-11-07": "missing_ours",
      "Mystery Man|2026-11-02": "unknown_worker",
    })
    expect(r.lines.find((l) => l.kind === "diff")?.diff).toBe(2)
    expect(r.totals).toEqual({ ours: 32, theirs: 40, mismatches: 4 })
  })
})

describe("timesheets: late client timesheets", () => {
  test("weekly: due two days after Sunday", () => {
    expect(lastCompletedPeriodEnd("weekly", "2026-09-01", "2026-11-11")).toBe("2026-11-08")
    expect(lastCompletedPeriodEnd("monthly", "2026-09-01", "2026-11-11")).toBe("2026-10-31")
    const onTime = timesheetDue({ cadence: "weekly", graceDays: 2, projectStart: "2026-09-01", lastReceivedTo: "2026-11-08", today: "2026-11-11" })
    expect(onTime.late).toBe(false)
    const late = timesheetDue({ cadence: "weekly", graceDays: 2, projectStart: "2026-09-01", lastReceivedTo: "2026-10-18", today: "2026-11-11" })
    expect(late).toMatchObject({ late: true, missingFrom: "2026-10-19", expectedTo: "2026-11-08", dueDate: "2026-11-10", daysLate: 1 })
    expect(timesheetDue({ cadence: "weekly", graceDays: 2, projectStart: "2026-11-10", lastReceivedTo: null, today: "2026-11-11" }).late).toBe(false)
  })
})
