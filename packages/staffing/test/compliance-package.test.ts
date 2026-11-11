import { describe, expect, test } from "vitest"
import {
  DEFAULT_ATTACHMENT_CAP_BYTES,
  defaultPackageLanguage,
  evaluatePackage,
  initialPackageStatus,
  linkState,
  looksLikeToken,
  packageEmail,
  planDelivery,
  randomToken,
  sha256Hex,
  type PackageMemberInput,
} from "../src/compliance/pure"

const doc = (name: string, status: "valid" | "expiring30" | "expiring60" | "expired" | "missing" | "notRequired", over: Partial<{ hasFile: boolean; size: number; expiresAt: string; expiresDuring: boolean }> = {}) => ({
  name,
  nameEn: `${name} EN`,
  status,
  hasFile: status !== "missing",
  size: 1000,
  ...over,
})
const member = (name: string, documents: PackageMemberInput["documents"]): PackageMemberInput => ({ workerId: name, workerName: name, documents })

describe("package rule", () => {
  test("complete: every required document usable and scanned → ready; expiring ones are only warnings", () => {
    const e = evaluatePackage([
      member("Jonas", [doc("Pasas", "valid"), doc("A1", "expiring30", { expiresAt: "2026-12-01" }), doc("Darbo leidimas", "notRequired", { hasFile: false })]),
      member("Petras", [doc("Pasas", "valid"), doc("A1", "valid", { expiresDuring: true, expiresAt: "2027-01-10" })]),
    ])
    expect(e.complete).toBe(true)
    expect(e.missing).toEqual([])
    expect(e.warnings.map((w) => `${w.workerName}:${w.document}`)).toEqual(["Jonas:A1", "Petras:A1"])
    expect(e.fileCount).toBe(4)
    expect(e.totalBytes).toBe(4000)
    expect(initialPackageStatus(e)).toBe("ready")
  })

  test("incomplete: missing, expired or without a scan → needs approval, with the reason", () => {
    const e = evaluatePackage([member("Darius", [doc("VCA", "expired", { expiresAt: "2026-10-30" }), doc("Pasas", "valid", { hasFile: false })]), member("Vasyl", [doc("VCA", "missing")])])
    expect(e.complete).toBe(false)
    expect(e.missing.map((g) => [g.workerName, g.document, g.reason])).toEqual([
      ["Darius", "VCA", "expired"],
      ["Darius", "Pasas", "noFile"],
      ["Vasyl", "VCA", "missing"],
    ])
    expect(e.missing[0]!.expiresAt).toBe("2026-10-30")
    expect(initialPackageStatus(e)).toBe("needs_approval")
    expect(evaluatePackage([]).complete).toBe(false)
  })

  test("size cap: attachments up to the cap, a ZIP link above it (or with too many files)", () => {
    expect(planDelivery(DEFAULT_ATTACHMENT_CAP_BYTES, 10)).toBe("attachments")
    expect(planDelivery(DEFAULT_ATTACHMENT_CAP_BYTES + 1, 10)).toBe("link")
    expect(planDelivery(5_000, 41)).toBe("link")
    expect(planDelivery(5_000, 3, 4_000)).toBe("link")
  })
})

describe("package email", () => {
  const base = {
    project: { code: "VSB-2026-12", name: "Sekcijų dažymas", city: "Vlissingen", country: "NL", startDate: "2026-11-21", endDate: "2027-01-20" },
    clientName: "Voorbeeld",
    companyName: "UAB Demo",
    members: [{ workerName: "Darius D.", tradeName: "Šlifuotojas", tradeNameEn: "Grinder", documents: [{ name: "Pasas", nameEn: "Passport", status: "valid" as const, expiresAt: "2030-01-01" }] }],
    warnings: [],
    fileCount: 1,
    totalBytes: 2048,
  }
  test("LT: team with validity, the Trūksta section and the link", () => {
    const m = packageEmail({ ...base, language: "lt", delivery: "attachments", missing: [{ workerId: "w", workerName: "Darius D.", document: "VCA / SCC", documentEn: "VCA", reason: "expired", expiresAt: "2026-10-30" }], link: { url: "https://app.test/d/abc", expiresOn: "2026-11-25" } })
    expect(m.subject).toBe("Darbuotojų dokumentai – VSB-2026-12 Sekcijų dažymas")
    expect(m.text).toContain("Laba diena,")
    expect(m.text).toContain("1. Darius D. – Šlifuotojas")
    expect(m.text).toContain("Pasas: galioja iki 2030-01-01")
    expect(m.text).toContain("Trūksta:\n- Darius D.: VCA / SCC (nebegalioja 2026-10-30)")
    expect(m.text).toContain("Dokumentai (1) pridėti prie laiško.")
    expect(m.text).toContain("https://app.test/d/abc (nuoroda galioja iki 2026-11-25)")
    expect(m.html).toContain("Trūksta")
  })
  test("NL: Dutch greeting, English body; a big package says ZIP link instead of attachments; HTML is escaped", () => {
    const m = packageEmail({ ...base, language: "nl", delivery: "link", missing: [], contactName: "<Jan>", totalBytes: 30 * 1024 * 1024 })
    expect(m.subject).toBe("Worker documents – VSB-2026-12 Sekcijų dažymas")
    expect(m.text.startsWith("Geachte <Jan>,")).toBe(true)
    expect(m.text).toContain("1. Darius D. – Grinder")
    expect(m.text).toContain("Passport: valid until 2030-01-01")
    expect(m.text).toContain("too large to attach (30.0 MB)")
    expect(m.text).not.toContain("Missing:")
    expect(m.html).toContain("&lt;Jan&gt;")
    expect(m.html).not.toContain("<Jan>")
  })
  test("default language by the client's country", () => {
    expect(defaultPackageLanguage("LT")).toBe("lt")
    expect(defaultPackageLanguage("nl")).toBe("nl")
    expect(defaultPackageLanguage("NO")).toBe("en")
  })
})

describe("public link guard", () => {
  test("ok until it expires; revoked and unknown links are refused", () => {
    const now = 1_000_000
    expect(linkState({ expiresAt: now + 1 }, now)).toBe("ok")
    expect(linkState({ expiresAt: now }, now)).toBe("expired")
    expect(linkState({ expiresAt: now + 1, revokedAt: now - 5 }, now)).toBe("revoked")
    expect(linkState(null, now)).toBe("not_found")
  })
  test("tokens are random, URL-safe and only their hash is stored", async () => {
    const a = randomToken()
    const b = randomToken()
    expect(a).not.toBe(b)
    expect(looksLikeToken(a)).toBe(true)
    expect(looksLikeToken("../../etc")).toBe(false)
    expect(looksLikeToken("short")).toBe(false)
    const h = await sha256Hex(a)
    expect(h).toMatch(/^[0-9a-f]{64}$/)
    expect(await sha256Hex(a)).toBe(h)
  })
})
