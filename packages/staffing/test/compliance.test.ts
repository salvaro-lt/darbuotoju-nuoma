import { describe, expect, test } from "vitest"
import { crc32, digestThreshold, fillTemplate, pickDigest, projectRequirements, readinessCell, requirementApplies, rowReadiness, unknownPlaceholders, zipStore } from "../src/compliance/pure"

describe("compliance: requirements and readiness", () => {
  test("a project's requirements merge its country's and client's; work permits only for non-EEA workers", () => {
    const req = projectRequirements(
      [
        { certificateTypeId: "a1", country: "NL", scope: "all" as const },
        { certificateTypeId: "permit", country: "NL", scope: "nonEea" as const },
        { certificateTypeId: "hot", clientId: "c1", scope: "all" as const },
        { certificateTypeId: "hms", country: "NO", scope: "all" as const },
      ],
      { country: "NL", clientId: "c1" },
    )
    expect([...req.keys()].sort()).toEqual(["a1", "hot", "permit"])
    expect(requirementApplies(req.get("permit")!, "LT")).toBe(false)
    expect(requirementApplies(req.get("permit")!, "UA")).toBe(true)
  })

  test("cells are checked from the start through the end of the work", () => {
    expect(readinessCell(undefined, "2026-12-01", "2027-02-01")).toEqual({ status: "missing", expiresDuring: false })
    expect(readinessCell({ expiresAt: "2026-11-20" }, "2026-12-01", "2027-02-01").status).toBe("expired")
    expect(readinessCell({ expiresAt: "2027-01-10" }, "2026-12-01", "2027-02-01")).toEqual({ status: "expiring60", expiresDuring: true })
    expect(readinessCell({ expiresAt: "2028-01-01" }, "2026-12-01", "2027-02-01")).toEqual({ status: "valid", expiresDuring: false })
    expect(readinessCell(undefined, "2026-12-01", null, false).status).toBe("notRequired")
  })

  test("a row is blocked by missing or expired, warned by expiring", () => {
    expect(rowReadiness([{ status: "valid", expiresDuring: false }, { status: "notRequired", expiresDuring: false }])).toBe("ready")
    expect(rowReadiness([{ status: "valid", expiresDuring: true }])).toBe("warning")
    expect(rowReadiness([{ status: "expiring30", expiresDuring: false }, { status: "missing", expiresDuring: false }])).toBe("blocked")
  })
})

describe("compliance: expiry digest", () => {
  test("thresholds at 60 and 30 days and expired; each reported once", () => {
    expect([61, 60, 31, 30, 0, -1].map(digestThreshold)).toEqual([null, "60", "60", "30", "30", "expired"])
    const certs = [
      { certificateId: "x", expiresAt: "2026-12-06" }, // 25 days
      { certificateId: "y", expiresAt: "2026-12-31" }, // 50 days
      { certificateId: "z", expiresAt: "2027-06-01" }, // far
    ]
    const first = pickDigest(certs, "2026-11-11", new Set())
    expect(first.map((c) => [c.certificateId, c.threshold, c.daysLeft])).toEqual([
      ["x", "30", 25],
      ["y", "60", 50],
    ])
    expect(pickDigest(certs, "2026-11-11", new Set(["x:30", "y:60"]))).toEqual([])
    // y crosses 30 days later: reported again, for the new threshold.
    expect(pickDigest(certs, "2026-12-05", new Set(["x:30", "y:60"])).map((c) => `${c.certificateId}:${c.threshold}`)).toEqual(["y:30"])
  })
})

describe("compliance: templates and zip", () => {
  test("placeholders fill; missing required ones are reported, optional ones vanish", () => {
    const { text, missing } = fillTemplate("{{worker.fullName}} ({{worker.personalCode?}}) – {{project.name}}, {{hourlyRate}} EUR", { "worker.fullName": "Jonas Pavyzdys", "project.name": "Korpusas" })
    expect(text).toBe("Jonas Pavyzdys () – Korpusas, [hourlyRate] EUR")
    expect(missing).toEqual(["hourlyRate"])
    expect(unknownPlaceholders("{{worker.fullName}} {{worker.shoeSize}}")).toEqual(["worker.shoeSize"])
  })

  test("zip has the right signatures and CRC", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926)
    const zip = zipStore([{ name: "a/ž.txt", data: new TextEncoder().encode("hello") }])
    const dv = new DataView(zip.buffer)
    expect(dv.getUint32(0, true)).toBe(0x04034b50)
    expect(dv.getUint32(zip.length - 22, true)).toBe(0x06054b50)
    expect(dv.getUint16(zip.length - 22 + 10, true)).toBe(1)
  })
})
