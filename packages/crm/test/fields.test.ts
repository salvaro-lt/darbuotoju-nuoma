import { manifestProblems } from "@digimuza/system-core/modules"
import { describe, expect, test } from "vitest"
import { blueprintProblems, crm, emptyBlueprint, extendBlueprint, standardBlueprint } from "../src/index"
import { compareValues, keyFromLabel, matchesFilter, normalizeValue, settingsProblems, type FieldDefinition } from "../src/fields"

const f = (type: FieldDefinition["type"], settings: FieldDefinition["settings"] = {}): FieldDefinition => ({ key: "x", label: "X", type, settings, required: false })
const ok = (field: FieldDefinition, raw: unknown) => {
  const r = normalizeValue(field, raw)
  if (!r.ok) throw new Error(r.reason)
  return r.value
}
const reason = (field: FieldDefinition, raw: unknown) => {
  const r = normalizeValue(field, raw)
  return r.ok ? "OK" : r.reason
}

const stage = f("select", {
  options: [
    { value: "new", label: "New", color: "gray" },
    { value: "won", label: "Won", color: "green" },
  ],
})

describe("manifest and blueprints", () => {
  test("the manifest is valid for system-core", () => {
    expect(manifestProblems(crm)).toEqual([])
  })

  test("standard blueprints are consistent in both languages", () => {
    expect(blueprintProblems(standardBlueprint("lt"))).toEqual([])
    expect(blueprintProblems(standardBlueprint("en"))).toEqual([])
    expect(blueprintProblems(emptyBlueprint)).toEqual([])
  })

  test("extendBlueprint adds objects and fields; problems name the culprit", () => {
    const bp = extendBlueprint(standardBlueprint("en"), {
      objects: [{ key: "project", nameSingular: "Project", namePlural: "Projects", icon: "folder", labelFieldKey: "title", fields: [{ key: "title", label: "Title", type: "text" }] }],
      fields: { company: [{ key: "tier", label: "Tier", type: "rating", settings: { scale: 3 } }] },
    })
    expect(blueprintProblems(bp)).toEqual([])
    expect(bp.objects.find((o) => o.key === "company")!.fields.some((x) => x.key === "tier")).toBe(true)
    // The base is not mutated.
    expect(standardBlueprint("en").objects.find((o) => o.key === "company")!.fields.some((x) => x.key === "tier")).toBe(false)

    const broken = extendBlueprint(emptyBlueprint, {
      objects: [{ key: "ticket", nameSingular: "T", namePlural: "Ts", icon: "x", labelFieldKey: "n", fields: [{ key: "owner", label: "O", type: "relation", settings: { objectKey: "nobody" } }] }],
    })
    expect(blueprintProblems(broken)).toEqual(['ticket.owner: relation target "nobody" is not in the blueprint', 'ticket: labelFieldKey "n" must be a text field'])
  })
})

describe("keys", () => {
  test("keyFromLabel folds Lithuanian letters and camelCases", () => {
    expect(keyFromLabel("Metinė apyvarta (€)")).toBe("metineApyvarta")
    expect(keyFromLabel("PVM kodas")).toBe("pvmKodas")
    expect(keyFromLabel("2024 tikslas")).toBe("tikslas")
    expect(keyFromLabel("!!!")).toBe("")
  })
})

describe("normalizeValue", () => {
  test("empty input clears", () => {
    for (const raw of [null, undefined, "", []]) expect(ok(f("text"), raw)).toBeUndefined()
  })

  test("text, email, url, phone", () => {
    expect(ok(f("text"), "  Acme  ")).toBe("Acme")
    expect(reason(f("text", { maxLength: 3 }), "abcd")).toBe("too_long")
    expect(ok(f("email"), " Jonas@Acme.LT ")).toBe("jonas@acme.lt")
    expect(reason(f("email"), "nope")).toBe("invalid_email")
    expect(ok(f("url"), "acme.lt")).toBe("https://acme.lt")
    expect(reason(f("url"), "javascript:alert(1)")).toBe("invalid_url")
    expect(ok(f("phone"), "+370 600 00000")).toBe("+370 600 00000")
    expect(reason(f("phone"), "call me")).toBe("invalid_phone")
  })

  test("numbers respect decimals and bounds; currency is integer minor units", () => {
    expect(ok(f("number", { decimals: 0 }), "12,6")).toBe(13)
    expect(reason(f("number", { min: 0, max: 100 }), 101)).toBe("above_max")
    expect(ok(f("currency", { defaultCurrency: "EUR" }), { amount: 1250 })).toEqual({ amount: 1250, currency: "EUR" })
    expect(reason(f("currency"), { amount: 12.5 })).toBe("not_minor_units")
    expect(reason(f("currency"), { amount: 1, currency: "euro" })).toBe("invalid_currency")
  })

  test("selects accept only configured options", () => {
    expect(ok(stage, "won")).toBe("won")
    expect(reason(stage, "lost")).toBe("unknown_option")
    const tags = { ...stage, type: "multiSelect" as const }
    expect(ok(tags, ["won", "new", "won"])).toEqual(["won", "new"])
    expect(reason(tags, ["won", "x"])).toBe("unknown_option")
  })

  test("dates, booleans, ratings", () => {
    expect(ok(f("date"), "2026-11-10")).toBe("2026-11-10")
    expect(reason(f("date"), "10/11/2026")).toBe("invalid_date")
    expect(reason(f("boolean"), "true")).toBe("not_boolean")
    expect(ok(f("rating", { scale: 3 }), 3)).toBe(3)
    expect(reason(f("rating", { scale: 3 }), 4)).toBe("invalid_rating")
  })
})

describe("settings", () => {
  test("select options must be unique and coloured", () => {
    expect(settingsProblems("select", { options: [] })).toEqual(["options"])
    expect(settingsProblems("select", { options: [{ value: "a", label: "A", color: "blue" }, { value: "a", label: "B", color: "red" }] })).toEqual(["options"])
    expect(settingsProblems("relation", {})).toEqual(["objectKey"])
    expect(settingsProblems("number", { min: 5, max: 1 })).toEqual(["min"])
  })
})

describe("filters and sorting", () => {
  test("operators by type", () => {
    expect(matchesFilter(f("text"), "Acme UAB", { fieldKey: "x", operator: "contains", value: "acme" })).toBe(true)
    expect(matchesFilter(f("number"), 10, { fieldKey: "x", operator: "gte", value: 10 })).toBe(true)
    expect(matchesFilter(f("number"), undefined, { fieldKey: "x", operator: "lt", value: 10 })).toBe(false)
    expect(matchesFilter(stage, "won", { fieldKey: "x", operator: "in", value: ["won", "new"] })).toBe(true)
    expect(matchesFilter(f("currency"), { amount: 500, currency: "EUR" }, { fieldKey: "x", operator: "gt", value: 100 })).toBe(true)
    expect(matchesFilter(f("date"), "2026-01-02", { fieldKey: "x", operator: "lt", value: "2026-02-01" })).toBe(true)
    expect(matchesFilter(f("text"), "", { fieldKey: "x", operator: "isEmpty" })).toBe(true)
  })

  test("select sorts by option order, empties last", () => {
    const rows = ["won", undefined, "new"]
    expect([...rows].sort((a, b) => compareValues(stage, a, b))).toEqual(["new", "won", undefined])
    expect([...rows].sort((a, b) => compareValues(stage, a, b, "desc"))).toEqual(["won", "new", undefined])
  })
})
