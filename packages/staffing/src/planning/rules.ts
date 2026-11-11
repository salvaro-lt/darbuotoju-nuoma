// Team composition rules of the "planning" area: pure, no Convex, unit-tested.
// Safe to import from the browser (`@digimuza/staffing/planning/rules`).
//
// The planner's unwritten rules from the weekly Excel ("bent vienas
// vairuotojas ant tam tikro kiekio žmonių", "kad būtų angliškai kalbantys",
// "kas su kuom gali gyvent"), made explicit and configurable per client
// (`staffing_planning_clientRules`). The teams engine applies them to its own
// proposal (`applyTeamRules`) and the proposal page shows what still breaks
// them (`evaluateTeamRules`).

export const ENGLISH_SCOPES = ["off", "team", "housing"] as const
export type EnglishScope = (typeof ENGLISH_SCOPES)[number]

export interface TeamRules {
  /** At least one driver per this many people (rounded up); 0 turns the rule off. */
  driversPerPeople: number
  /** Someone must speak English: in the whole team, or in every housing group. */
  english: EnglishScope
  /** Every member shares a language with at least one other member. */
  languageCompatibility: boolean
  /** People per flat and car when grouping by nationality (housing hint). */
  housingGroupSize: number
}

export const DEFAULT_TEAM_RULES: TeamRules = { driversPerPeople: 4, english: "team", languageCompatibility: true, housingGroupSize: 4 }

/** Stored rules with defaults for unset fields; values clamped to sane bounds. */
export function resolveTeamRules(stored?: Partial<TeamRules> | null): TeamRules {
  const r = { ...DEFAULT_TEAM_RULES, ...Object.fromEntries(Object.entries(stored ?? {}).filter(([, v]) => v !== undefined && v !== null)) }
  return {
    driversPerPeople: Math.max(0, Math.min(50, Math.round(r.driversPerPeople))),
    english: ENGLISH_SCOPES.includes(r.english) ? r.english : DEFAULT_TEAM_RULES.english,
    languageCompatibility: Boolean(r.languageCompatibility),
    housingGroupSize: Math.max(1, Math.min(20, Math.round(r.housingGroupSize))),
  }
}

export interface RuleMember {
  workerId: string
  name: string
  /** ISO 3166-1 alpha-2. */
  nationality: string
  /** ISO 639-1. */
  languages: readonly string[]
  /** Holds a licence valid on the start day. */
  canDrive: boolean
}

export interface HousingGroup {
  nationality: string
  /** Languages every member of the group speaks. */
  languages: string[]
  memberIds: string[]
  names: string[]
  /** Flats / cars needed for the group (`ceil(size / housingGroupSize)`). */
  units: number
  drivers: number
  english: boolean
}

export type RuleWarning =
  | { code: "drivers"; needed: number; have: number }
  | { code: "no_english" }
  | { code: "no_english_in_group"; nationality: string; names: string[] }
  | { code: "isolated"; workerId: string; name: string; languages: string[] }
  | { code: "housing"; nationality: string; count: number; units: number; languages: string[]; drivers: number }

/** Warning codes that break a rule (the others are hints). */
export const RULE_BREAKS: readonly RuleWarning["code"][] = ["drivers", "no_english", "no_english_in_group", "isolated"]

const speaksEnglish = (m: Pick<RuleMember, "languages">) => m.languages.includes("en")

/** Drivers the team needs: one per `driversPerPeople`, rounded up (0 when the rule is off or the team empty). */
export const driversNeeded = (size: number, rules: TeamRules): number => (rules.driversPerPeople > 0 && size > 0 ? Math.ceil(size / rules.driversPerPeople) : 0)

/** Members who share no language with anyone else in the team. */
export function isolatedMembers<M extends RuleMember>(members: readonly M[]): M[] {
  if (members.length < 2) return []
  return members.filter((m) => !members.some((o) => o !== m && o.languages.some((l) => m.languages.includes(l))))
}

/**
 * Housing groups: people of one nationality live (and drive) together, in
 * flats of `housingGroupSize`. Largest group first.
 */
export function housingGroups(members: readonly RuleMember[], rules: TeamRules): HousingGroup[] {
  const by = new Map<string, RuleMember[]>()
  for (const m of members) by.set(m.nationality, [...(by.get(m.nationality) ?? []), m])
  return [...by.entries()]
    .map(([nationality, ms]) => ({
      nationality,
      languages: ms.reduce<string[]>((acc, m, i) => (i === 0 ? [...m.languages] : acc.filter((l) => m.languages.includes(l))), []),
      memberIds: ms.map((m) => m.workerId),
      names: ms.map((m) => m.name),
      units: Math.ceil(ms.length / rules.housingGroupSize),
      drivers: ms.filter((m) => m.canDrive).length,
      english: ms.some(speaksEnglish),
    }))
    .sort((a, b) => b.memberIds.length - a.memberIds.length || a.nationality.localeCompare(b.nationality))
}

/** Every rule the team breaks, then housing hints (groups of 2+ people of one nationality). */
export function evaluateTeamRules(members: readonly RuleMember[], rules: TeamRules): RuleWarning[] {
  const out: RuleWarning[] = []
  if (!members.length) return out
  const needed = driversNeeded(members.length, rules)
  const have = members.filter((m) => m.canDrive).length
  if (have < needed) out.push({ code: "drivers", needed, have })
  const groups = housingGroups(members, rules)
  if (rules.english === "team" && !members.some(speaksEnglish)) out.push({ code: "no_english" })
  if (rules.english === "housing") {
    if (!members.some(speaksEnglish)) out.push({ code: "no_english" })
    else for (const g of groups) if (!g.english) out.push({ code: "no_english_in_group", nationality: g.nationality, names: g.names })
  }
  if (rules.languageCompatibility) for (const m of isolatedMembers(members)) out.push({ code: "isolated", workerId: m.workerId, name: m.name, languages: [...m.languages] })
  for (const g of groups)
    if (g.memberIds.length >= 2) out.push({ code: "housing", nationality: g.nationality, count: g.memberIds.length, units: g.units, languages: g.languages, drivers: g.drivers })
  return out
}

// ---------------------------------------------------------------- engine

export interface RulePick {
  lineIndex: number
  workerId: string
  isDriver: boolean
}
export interface RuleCandidate extends RuleMember {
  /** May be proposed (no blocking warning). */
  eligible: boolean
  score: number
}

/**
 * Improves an automatic team proposal so it keeps the rules, by swapping the
 * weakest pick of a line for the best fit alternative of the same line:
 * 1. too few drivers → swap in people who can drive;
 * 2. nobody speaks English → swap in one who does;
 * 3. a member shares no language with anyone → swap them for one who does.
 * Picks keep their line; returns new picks (the input is not changed) and
 * what was swapped. When no alternative helps, the pick stays (the warning
 * then shows on the proposal page).
 */
export function applyTeamRules(
  picks: readonly RulePick[],
  ranked: readonly (readonly RuleCandidate[])[],
  rules: TeamRules,
): { picks: RulePick[]; swaps: { lineIndex: number; out: string; in: string; reason: "drivers" | "english" | "language" }[] } {
  const out = picks.map((p) => ({ ...p }))
  const swaps: { lineIndex: number; out: string; in: string; reason: "drivers" | "english" | "language" }[] = []
  const info = new Map<string, RuleCandidate>()
  for (const line of ranked) for (const c of line) info.set(c.workerId, c)
  const members = () => out.map((p) => info.get(p.workerId)).filter((m): m is RuleCandidate => Boolean(m))
  const used = () => new Set(out.map((p) => p.workerId))

  /** Swap the lowest-score pick matching `outOk` for the best alternative matching `inOk`. */
  const swap = (outOk: (m: RuleCandidate, p: RulePick) => boolean, inOk: (c: RuleCandidate) => boolean, reason: "drivers" | "english" | "language"): boolean => {
    const taken = used()
    const options = out
      .map((p, i) => ({ p, i, m: info.get(p.workerId) }))
      .filter((x): x is { p: RulePick; i: number; m: RuleCandidate } => Boolean(x.m) && outOk(x.m!, x.p))
      .sort((a, b) => a.m.score - b.m.score)
    for (const { p, i } of options) {
      const alt = (ranked[p.lineIndex] ?? []).find((c) => c.eligible && !taken.has(c.workerId) && inOk(c))
      if (!alt) continue
      out[i] = { lineIndex: p.lineIndex, workerId: alt.workerId, isDriver: p.isDriver && alt.canDrive }
      swaps.push({ lineIndex: p.lineIndex, out: p.workerId, in: alt.workerId, reason })
      return true
    }
    return false
  }

  // 1. drivers
  for (let guard = 0; guard < out.length; guard++) {
    if (members().filter((m) => m.canDrive).length >= driversNeeded(out.length, rules)) break
    if (!swap((m, p) => !m.canDrive && !p.isDriver, (c) => c.canDrive, "drivers")) break
  }
  // 2. English
  if (rules.english !== "off" && out.length && !members().some(speaksEnglish)) {
    const drivers = members().filter((m) => m.canDrive).length
    const need = driversNeeded(out.length, rules)
    // Keep the driver count: a driver only leaves for an English-speaking driver.
    if (!swap((m) => !m.canDrive || drivers > need, (c) => speaksEnglish(c), "english")) swap(() => true, (c) => speaksEnglish(c) && c.canDrive, "english")
  }
  // 3. language compatibility
  if (rules.languageCompatibility)
    for (let guard = 0; guard < out.length; guard++) {
      const lonely = isolatedMembers(members())
      if (!lonely.length) break
      const team = members()
      const lonelyIds = new Set(lonely.map((m) => m.workerId))
      const needEnglish = rules.english !== "off" && team.filter(speaksEnglish).length === 1 && lonely.some((m) => speaksEnglish(m))
      const shares = (c: RuleCandidate) => team.some((o) => !lonelyIds.has(o.workerId) && o.languages.some((l) => c.languages.includes(l)))
      if (!swap((m) => lonelyIds.has(m.workerId) && !(needEnglish && speaksEnglish(m)), shares, "language")) break
    }
  return { picks: out, swaps }
}

// ---------------------------------------------------------------- text

const NATIONALITY: Record<string, [lt: string, ltPlural: string, en: string]> = {
  LT: ["lietuvis", "lietuviai", "Lithuanians"],
  UA: ["ukrainietis", "ukrainiečiai", "Ukrainians"],
  PH: ["filipinietis", "filipiniečiai", "Filipinos"],
  PL: ["lenkas", "lenkai", "Poles"],
  LV: ["latvis", "latviai", "Latvians"],
  GE: ["gruzinas", "gruzinai", "Georgians"],
  IN: ["indas", "indai", "Indians"],
  RO: ["rumunas", "rumunai", "Romanians"],
  BY: ["baltarusis", "baltarusiai", "Belarusians"],
  EE: ["estas", "estai", "Estonians"],
}

export function nationalityLabel(code: string, count: number, locale: "lt" | "en"): string {
  const n = NATIONALITY[code]
  if (!n) return locale === "lt" ? `${code} piliečiai` : `${code} nationals`
  return locale === "lt" ? (count === 1 ? n[0] : n[1]) : n[2]
}

/** One rule warning in plain text. */
export function describeRuleWarning(w: RuleWarning, locale: "lt" | "en" = "lt"): string {
  const lt = locale === "lt"
  const langs = (l: readonly string[]) => (l.length ? l.join(", ").toUpperCase() : "–")
  switch (w.code) {
    case "drivers":
      return lt ? `Per mažai vairuotojų: reikia ${w.needed}, yra ${w.have}` : `Too few drivers: ${w.needed} needed, ${w.have} in the team`
    case "no_english":
      return lt ? "Komandoje niekas nekalba angliškai" : "Nobody in the team speaks English"
    case "no_english_in_group":
      return lt
        ? `${nationalityLabel(w.nationality, w.names.length, "lt")} (${w.names.join(", ")}): būste niekas nekalba angliškai`
        : `${nationalityLabel(w.nationality, w.names.length, "en")} (${w.names.join(", ")}): nobody in the flat speaks English`
    case "isolated":
      return lt ? `${w.name} (${langs(w.languages)}) neturi bendros kalbos su kitais komandos nariais` : `${w.name} (${langs(w.languages)}) shares no language with the rest of the team`
    case "housing": {
      const who = nationalityLabel(w.nationality, w.count, locale)
      if (lt) {
        const flats = w.units === 1 ? "vienas būstas ir automobilis" : `${w.units} būstai ir automobiliai`
        return `${w.count} ${who} → ${flats}${w.drivers === 0 ? " (tarp jų nėra vairuotojo)" : ""}`
      }
      const flats = w.units === 1 ? "one flat and one car" : `${w.units} flats and cars`
      return `${w.count} ${who} → ${flats}${w.drivers === 0 ? " (no driver among them)" : ""}`
    }
  }
}
