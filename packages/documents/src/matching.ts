// Matching rules for tags, correspondents and document types, in the spirit of
// Paperless-ngx: every label has a `match` text and an algorithm that decides
// whether a document's content selects it. Pure functions: the module runs them
// on upload and after text recognition; the UI uses them to preview a rule.
//
//   none     never matches automatically
//   any      at least one of the words (or "quoted phrases") appears
//   all      every word (or "quoted phrase") appears
//   literal  the exact text appears
//   regex    the regular expression matches
//   fuzzy    the text appears with small typos (OCR noise)
//   auto     the AI chooses from the labels set to `auto` (flag documents:ai)

export const MATCH_ALGORITHMS = ["none", "any", "all", "literal", "regex", "fuzzy", "auto"] as const
export type MatchAlgorithm = (typeof MATCH_ALGORITHMS)[number]

export interface MatchRule {
  match: string
  algorithm: MatchAlgorithm
  caseSensitive: boolean
}

const MAX_PATTERN = 500

/** Words of a rule: whitespace separated, "quoted phrases" kept together. */
export function ruleWords(match: string): string[] {
  const out: string[] = []
  const re = /"([^"]+)"|(\S+)/g
  for (let m = re.exec(match); m; m = re.exec(match)) {
    const w = (m[1] ?? m[2] ?? "").trim()
    if (w) out.push(w)
  }
  return out
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
const wordRe = (w: string, flags: string) => new RegExp(`(?<![\\p{L}\\p{N}])${escape(w).replace(/\s+/g, "\\s+")}(?![\\p{L}\\p{N}])`, flags)

/** Why a rule is invalid, or null. Only regex rules can be invalid. */
export function ruleProblem(rule: MatchRule): string | null {
  if (rule.match.length > MAX_PATTERN) return "too_long"
  if (rule.algorithm === "none" || rule.algorithm === "auto") return null
  if (!rule.match.trim()) return "empty"
  if (rule.algorithm === "regex") {
    try {
      new RegExp(rule.match, rule.caseSensitive ? "u" : "iu")
    } catch {
      return "invalid_regex"
    }
  }
  return null
}

/** Levenshtein distance, capped: returns `max + 1` once it is exceeded. */
function distance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    let rowMin = i
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1))
      cur.push(v)
      rowMin = Math.min(rowMin, v)
    }
    if (rowMin > max) return max + 1
    prev = cur
  }
  return prev[b.length]!
}

const tokens = (s: string) => s.split(/[^\p{L}\p{N}]+/u).filter(Boolean)

/** The rule's text appears as a run of words, each within ~15% edits. */
function fuzzyMatch(text: string, pattern: string): boolean {
  const p = tokens(pattern)
  if (p.length === 0) return false
  const t = tokens(text)
  outer: for (let i = 0; i + p.length <= t.length; i++) {
    for (let k = 0; k < p.length; k++) {
      const want = p[k]!
      const max = want.length <= 3 ? 0 : Math.max(1, Math.floor(want.length * 0.15))
      if (distance(t[i + k]!, want, max) > max) continue outer
    }
    return true
  }
  return false
}

/** Does this rule select a document with this content? `auto` and `none` never do here. */
export function matches(rule: MatchRule, content: string): boolean {
  if (!content || ruleProblem(rule)) return false
  const flags = rule.caseSensitive ? "u" : "iu"
  switch (rule.algorithm) {
    case "none":
    case "auto":
      return false
    case "any":
      return ruleWords(rule.match).some((w) => wordRe(w, flags).test(content))
    case "all": {
      const words = ruleWords(rule.match)
      return words.length > 0 && words.every((w) => wordRe(w, flags).test(content))
    }
    case "literal":
      return rule.caseSensitive ? content.includes(rule.match) : content.toLocaleLowerCase().includes(rule.match.toLocaleLowerCase())
    case "regex":
      return new RegExp(rule.match, flags).test(content)
    case "fuzzy":
      return rule.caseSensitive ? fuzzyMatch(content, rule.match) : fuzzyMatch(content.toLocaleLowerCase(), rule.match.toLocaleLowerCase())
  }
}

/** IDs of the labels whose rule selects the content. */
export function matchingIds<T extends MatchRule & { id: string }>(labels: readonly T[], content: string): string[] {
  return labels.filter((l) => matches(l, content)).map((l) => l.id)
}
