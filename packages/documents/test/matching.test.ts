import { describe, expect, test } from "vitest"
import { matches, matchingIds, ruleProblem, ruleWords, type MatchRule } from "../src/matching"

const r = (algorithm: MatchRule["algorithm"], match: string, caseSensitive = false): MatchRule => ({ algorithm, match, caseSensitive })
const text = "PVM sąskaita faktūra SF-1024\nPardavėjas: UAB „Telia Lietuva“\nSuma: 42,50 EUR"

describe("matching rules", () => {
  test("words and quoted phrases", () => {
    expect(ruleWords('telia "pvm sąskaita" bitė')).toEqual(["telia", "pvm sąskaita", "bitė"])
  })

  test("any: one word is enough, whole words only", () => {
    expect(matches(r("any", "bite telia"), text)).toBe(true)
    expect(matches(r("any", "tel"), text)).toBe(false)
    expect(matches(r("any", '"sąskaita faktūra"'), text)).toBe(true)
  })

  test("all: every word must appear", () => {
    expect(matches(r("all", "telia faktūra"), text)).toBe(true)
    expect(matches(r("all", "telia bitė"), text)).toBe(false)
  })

  test("literal and case sensitivity", () => {
    expect(matches(r("literal", "uab „telia"), text)).toBe(true)
    expect(matches(r("literal", "uab „telia", true), text)).toBe(false)
  })

  test("regex, and invalid regex never matches", () => {
    expect(matches(r("regex", "SF-\\d{4}"), text)).toBe(true)
    expect(ruleProblem(r("regex", "("))).toBe("invalid_regex")
    expect(matches(r("regex", "("), text)).toBe(false)
  })

  test("fuzzy tolerates OCR noise", () => {
    expect(matches(r("fuzzy", "Telia Lietuva"), "Pardavejas: UAB Te1ia Lietuva")).toBe(true)
    expect(matches(r("fuzzy", "Telia Lietuva"), "UAB Bitė Lietuva")).toBe(false)
  })

  test("none and auto never match by rule", () => {
    expect(matches(r("none", "telia"), text)).toBe(false)
    expect(matches(r("auto", "telia"), text)).toBe(false)
  })

  test("matchingIds", () => {
    expect(matchingIds([{ id: "a", ...r("any", "telia") }, { id: "b", ...r("any", "bitė") }], text)).toEqual(["a"])
  })
})
