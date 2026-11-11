// The team matching engine of the "teams" area: pure, no Convex, unit-tested.
// Safe to import from the browser (`@digimuza/staffing/teams/matching`).
//
// Input: request lines (trade × count, required certificate types, drivers)
// and the candidates (workers free for the whole period, with their latest
// certificate per type and earlier work for the same client). Output: a
// ranking per line, a proposed team and what is missing ("Ko trūksta").
import { certificateStatus, TRADE_LEVELS, type CertificateStatus, type TradeLevel } from "../pure"

export const REQUEST_STATUSES = ["open", "proposed", "confirmed", "cancelled"] as const
export type RequestStatus = (typeof REQUEST_STATUSES)[number]
export const DRAFT_STATUSES = ["pending", "sent", "not_configured", "failed"] as const
export type DraftStatus = (typeof DRAFT_STATUSES)[number]

export interface TeamLine {
  tradeId: string
  count: number
  minLevel?: TradeLevel | undefined
  certificateTypeIds: readonly string[]
  /** How many of the `count` people must be able to drive the team's car. */
  drivers: number
}

export interface Candidate {
  id: string
  name: string
  source: "own" | "subcontractor"
  languages: readonly string[]
  trades: readonly { tradeId: string; level: TradeLevel }[]
  driverLicenseCategories: readonly string[]
  driverLicenseExpiresAt: string | null
  clothingSizes: { jacket?: string | undefined; trousers?: string | undefined; shoes?: string | undefined }
  /** Latest certificate per type held: type ID → expiry (`null` = never expires). */
  certificates: Readonly<Record<string, string | null>>
  /** Earlier (not cancelled) assignments on this client's projects. */
  previousClientAssignments: number
}

export interface MatchContext {
  startDate: string
  endDate: string | null
  /** Certificate types every worker needs (the catalog's mandatory ones). */
  mandatoryTypeIds: readonly string[]
  /** Languages the client wants; a plus when ranking. */
  languages: readonly string[]
}

export type WarningCode =
  | "cert_missing"
  | "cert_expired"
  | "cert_expires_during"
  | "cert_expiring_soon"
  | "level_below"
  | "license_expires"
  | "sizes_unknown"
  | "subcontractor"
  | "no_common_language"

export interface MatchWarning {
  code: WarningCode
  certificateTypeId?: string
  date?: string
}

/** Warnings that make a candidate unfit for the line (not proposed automatically). */
export const BLOCKING_WARNINGS: readonly WarningCode[] = ["cert_missing", "cert_expired", "level_below"]

export interface RankedCandidate {
  workerId: string
  name: string
  level: TradeLevel
  score: number
  /** No blocking warning: may be proposed. */
  eligible: boolean
  canDrive: boolean
  previousClientAssignments: number
  languageMatch: string[]
  source: "own" | "subcontractor"
  warnings: MatchWarning[]
}

export interface TeamPick {
  lineIndex: number
  workerId: string
  isDriver: boolean
}

const LEVEL_SCORE: Record<TradeLevel, number> = { trainee: 0, skilled: 20, senior: 30, foreman: 34 }
const PENALTY: Partial<Record<WarningCode, number>> = { cert_expires_during: 8, cert_expiring_soon: 2, license_expires: 3, sizes_unknown: 1, no_common_language: 4 }

/** A worker can drive on the start day: holds a licence category that is not expired then. */
export function canDriveOn(c: Pick<Candidate, "driverLicenseCategories" | "driverLicenseExpiresAt">, day: string): boolean {
  return c.driverLicenseCategories.length > 0 && (!c.driverLicenseExpiresAt || c.driverLicenseExpiresAt >= day)
}

/** Score and check one candidate for one line; `null` when the worker lacks the trade. */
export function rankCandidate(line: TeamLine, c: Candidate, ctx: MatchContext): RankedCandidate | null {
  const trade = c.trades.find((t) => t.tradeId === line.tradeId)
  if (!trade) return null
  const warnings: MatchWarning[] = []
  if (line.minLevel && TRADE_LEVELS.indexOf(trade.level) < TRADE_LEVELS.indexOf(line.minLevel)) warnings.push({ code: "level_below" })

  for (const typeId of [...new Set([...ctx.mandatoryTypeIds, ...line.certificateTypeIds])]) {
    const held = typeId in c.certificates
    const expiresAt = held ? c.certificates[typeId]! : undefined
    const status: CertificateStatus = certificateStatus(held ? { expiresAt } : null, ctx.startDate)
    if (status === "missing") warnings.push({ code: "cert_missing", certificateTypeId: typeId })
    else if (status === "expired") warnings.push({ code: "cert_expired", certificateTypeId: typeId, date: expiresAt! })
    else if (expiresAt && ctx.endDate && expiresAt < ctx.endDate) warnings.push({ code: "cert_expires_during", certificateTypeId: typeId, date: expiresAt })
    else if (status !== "valid") warnings.push({ code: "cert_expiring_soon", certificateTypeId: typeId, ...(expiresAt ? { date: expiresAt } : {}) })
  }

  const canDrive = canDriveOn(c, ctx.startDate)
  if (canDrive && c.driverLicenseExpiresAt && ctx.endDate && c.driverLicenseExpiresAt < ctx.endDate) warnings.push({ code: "license_expires", date: c.driverLicenseExpiresAt })
  if (!c.clothingSizes.jacket || !c.clothingSizes.trousers || !c.clothingSizes.shoes) warnings.push({ code: "sizes_unknown" })
  if (c.source === "subcontractor") warnings.push({ code: "subcontractor" })
  const languageMatch = ctx.languages.filter((l) => c.languages.includes(l))
  if (ctx.languages.length > 0 && languageMatch.length === 0) warnings.push({ code: "no_common_language" })

  let score = LEVEL_SCORE[trade.level]
  score += Math.min(c.previousClientAssignments, 3) * 8
  score += languageMatch.length * 6
  if (c.source === "own") score += 5
  if (line.drivers > 0 && canDrive) score += 8
  for (const w of warnings) score -= PENALTY[w.code] ?? 0

  return {
    workerId: c.id,
    name: c.name,
    level: trade.level,
    score,
    eligible: !warnings.some((w) => BLOCKING_WARNINGS.includes(w.code)),
    canDrive,
    previousClientAssignments: c.previousClientAssignments,
    languageMatch,
    source: c.source,
    warnings,
  }
}

/** Candidates with the line's trade: fit ones first, then by score (high first), then by name. */
export function rankForLine(line: TeamLine, candidates: readonly Candidate[], ctx: MatchContext): RankedCandidate[] {
  return candidates
    .map((c) => rankCandidate(line, c, ctx))
    .filter((r): r is RankedCandidate => r !== null)
    .sort((a, b) => Number(b.eligible) - Number(a.eligible) || b.score - a.score || a.name.localeCompare(b.name))
}

/**
 * The proposed team: per line (in order) the best fit candidates not taken by
 * an earlier line; when the line needs drivers and too few picks can drive,
 * the weakest non-driver is swapped for the best fit driver left. The first
 * `drivers` picks able to drive get `isDriver`.
 */
export function proposeTeam(lines: readonly TeamLine[], ranked: readonly (readonly RankedCandidate[])[]): TeamPick[] {
  const used = new Set<string>()
  const picks: TeamPick[] = []
  lines.forEach((line, lineIndex) => {
    const pool = (ranked[lineIndex] ?? []).filter((r) => r.eligible && !used.has(r.workerId))
    const chosen = pool.slice(0, Math.max(0, line.count))
    let rest = pool.slice(chosen.length)
    while (chosen.filter((r) => r.canDrive).length < Math.min(line.drivers, line.count)) {
      const driver = rest.find((r) => r.canDrive)
      if (!driver) break
      const weakest = [...chosen].reverse().find((r) => !r.canDrive)
      if (weakest) chosen.splice(chosen.indexOf(weakest), 1)
      if (chosen.length < line.count) chosen.push(driver)
      rest = rest.filter((r) => r !== driver)
    }
    chosen.sort((a, b) => b.score - a.score)
    let drivers = 0
    for (const r of chosen) {
      used.add(r.workerId)
      const isDriver = r.canDrive && drivers < line.drivers
      if (isDriver) drivers++
      picks.push({ lineIndex, workerId: r.workerId, isDriver })
    }
  })
  return picks
}

export type TeamGap =
  /** Not enough fit people: find them through a subcontractor. */
  | { kind: "people"; lineIndex: number; tradeId: string; missing: number }
  | { kind: "drivers"; lineIndex: number; tradeId: string; needed: number; have: number }
  /** A picked worker's certificate is missing, expired, or runs out during the project. */
  | { kind: "certificate"; lineIndex: number; workerId: string; name: string; code: "cert_missing" | "cert_expired" | "cert_expires_during"; certificateTypeId: string; date?: string }
  /** Free workers of the trade left out only because of this certificate type. */
  | { kind: "blocked_by_certificate"; lineIndex: number; tradeId: string; certificateTypeId: string; workers: number }
  /** A picked worker is no longer free for the whole period (or left the company). */
  | { kind: "busy"; lineIndex: number; workerId: string; name: string }
  | { kind: "sizes"; workerIds: string[]; names: string[] }

/** What the team still lacks for the request: the "Ko trūksta" list. */
export function teamGaps(lines: readonly TeamLine[], picks: readonly TeamPick[], ranked: readonly (readonly RankedCandidate[])[], names: Readonly<Record<string, string>> = {}): TeamGap[] {
  const gaps: TeamGap[] = []
  const sizes: { id: string; name: string }[] = []
  lines.forEach((line, lineIndex) => {
    const mine = picks.filter((p) => p.lineIndex === lineIndex)
    const byId = new Map((ranked[lineIndex] ?? []).map((r) => [r.workerId, r]))
    const missing = line.count - mine.length
    if (missing > 0) gaps.push({ kind: "people", lineIndex, tradeId: line.tradeId, missing })
    const drivers = mine.filter((p) => p.isDriver).length
    if (drivers < line.drivers) gaps.push({ kind: "drivers", lineIndex, tradeId: line.tradeId, needed: line.drivers, have: drivers })
    for (const p of mine) {
      const r = byId.get(p.workerId)
      if (!r) {
        gaps.push({ kind: "busy", lineIndex, workerId: p.workerId, name: names[p.workerId] ?? p.workerId })
        continue
      }
      for (const w of r.warnings)
        if ((w.code === "cert_missing" || w.code === "cert_expired" || w.code === "cert_expires_during") && w.certificateTypeId)
          gaps.push({ kind: "certificate", lineIndex, workerId: r.workerId, name: r.name, code: w.code, certificateTypeId: w.certificateTypeId, ...(w.date ? { date: w.date } : {}) })
      if (r.warnings.some((w) => w.code === "sizes_unknown")) sizes.push({ id: r.workerId, name: r.name })
    }
    if (missing > 0) {
      const picked = new Set(picks.map((p) => p.workerId))
      const blocked = new Map<string, number>()
      for (const r of ranked[lineIndex] ?? []) {
        if (picked.has(r.workerId) || r.eligible) continue
        const certs = r.warnings.filter((w) => w.code === "cert_missing" || w.code === "cert_expired")
        if (certs.length !== r.warnings.filter((w) => BLOCKING_WARNINGS.includes(w.code)).length) continue
        for (const w of certs) blocked.set(w.certificateTypeId!, (blocked.get(w.certificateTypeId!) ?? 0) + 1)
      }
      for (const [certificateTypeId, workers] of blocked) gaps.push({ kind: "blocked_by_certificate", lineIndex, tradeId: line.tradeId, certificateTypeId, workers })
    }
  })
  if (sizes.length) gaps.push({ kind: "sizes", workerIds: sizes.map((s) => s.id), names: sizes.map((s) => s.name) })
  return gaps
}

// ---------------------------------------------------------------- text

export type TeamsLocale = "lt" | "en"
export interface Names {
  trade: (id: string) => string
  certificate: (id: string) => string
}

/** One "Ko trūksta" line in plain text (also sent to n8n as `missing`). */
export function describeGap(g: TeamGap, n: Names, locale: TeamsLocale = "lt"): string {
  const lt = locale === "lt"
  switch (g.kind) {
    case "people":
      return lt ? `${n.trade(g.tradeId)}: trūksta ${g.missing} žm. → ieškoti per subrangą` : `${n.trade(g.tradeId)}: ${g.missing} more needed → ask a subcontractor`
    case "drivers":
      return lt ? `${n.trade(g.tradeId)}: trūksta vairuotojų (reikia ${g.needed}, yra ${g.have})` : `${n.trade(g.tradeId)}: ${g.needed} drivers needed, ${g.have} found`
    case "certificate": {
      const c = n.certificate(g.certificateTypeId)
      if (g.code === "cert_missing") return lt ? `${g.name}: nėra „${c}“` : `${g.name}: no "${c}"`
      if (g.code === "cert_expired") return lt ? `${g.name}: „${c}“ nebegalioja (${g.date})` : `${g.name}: "${c}" expired (${g.date})`
      return lt ? `${g.name}: „${c}“ baigsis projekto metu (${g.date}), reikia atnaujinti` : `${g.name}: "${c}" expires during the project (${g.date}), renew it`
    }
    case "blocked_by_certificate":
      return lt
        ? `${n.trade(g.tradeId)}: dar laisvų darbuotojų, kurie tiktų su galiojančiu „${n.certificate(g.certificateTypeId)}“: ${g.workers}`
        : `${n.trade(g.tradeId)}: ${g.workers} more free workers would fit with a valid "${n.certificate(g.certificateTypeId)}"`
    case "busy":
      return lt ? `${g.name}: nebėra laisvas visam laikotarpiui` : `${g.name}: no longer free for the whole period`
    case "sizes":
      return lt ? `Nežinomi aprangos dydžiai: ${g.names.join(", ")}` : `Clothing sizes unknown: ${g.names.join(", ")}`
  }
}

export interface DraftInput {
  clientName: string
  contactName?: string | null
  projectLabel: string
  site: string
  startDate: string
  endDate: string | null
  lines: { trade: string; count: number; members: { name: string; level: string; isDriver: boolean; certificates: string[] }[] }[]
  /** Gaps the client should know about (people still being found). */
  openPositions: string[]
  senderName?: string | null
}

/**
 * The answer-to-client draft from a template: works without n8n / AI. The
 * planner edits it and sends it as a person (client communication stays human).
 */
export function clientDraftText(d: DraftInput, locale: TeamsLocale = "en"): string {
  const lt = locale === "lt"
  const total = d.lines.reduce((s, l) => s + l.count, 0)
  const found = d.lines.reduce((s, l) => s + l.members.length, 0)
  const period = d.endDate ? `${d.startDate} – ${d.endDate}` : lt ? `nuo ${d.startDate}` : `from ${d.startDate}`
  const out: string[] = []
  out.push(lt ? `Laba diena${d.contactName ? `, ${d.contactName}` : ""},` : `Dear ${d.contactName ?? `${d.clientName} team`},`)
  out.push("")
  out.push(
    lt
      ? `Dėkojame už užklausą (${d.projectLabel}, ${d.site}, ${period}). Galime pasiūlyti ${found} iš ${total} reikalingų specialistų:`
      : `Thank you for your request (${d.projectLabel}, ${d.site}, ${period}). We can offer ${found} of the ${total} specialists you need:`,
  )
  for (const l of d.lines) {
    out.push("")
    out.push(`${l.trade} – ${l.members.length}/${l.count}`)
    for (const m of l.members) {
      const extra = [m.level, m.isDriver ? (lt ? "vairuotojas" : "driver") : null, m.certificates.length ? m.certificates.join(", ") : null].filter(Boolean).join("; ")
      out.push(`  • ${m.name}${extra ? ` (${extra})` : ""}`)
    }
  }
  if (d.openPositions.length) {
    out.push("")
    out.push(lt ? "Likusias pozicijas patvirtinsime per 2 darbo dienas:" : "We will confirm the remaining positions within 2 working days:")
    for (const p of d.openPositions) out.push(`  • ${p}`)
  }
  out.push("")
  out.push(
    lt
      ? "Visi darbuotojai turi galiojančius privalomus dokumentus (A1, saugos instruktažas). Sertifikatų kopijas ir CV atsiųsime patvirtinus komandą."
      : "All workers hold valid mandatory documents (A1, safety induction). Certificate copies and CVs follow once you confirm the team.",
  )
  out.push("")
  out.push(lt ? "Pagarbiai," : "Kind regards,")
  out.push(d.senderName ?? (lt ? "Projektų vadovas" : "Project manager"))
  return out.join("\n")
}
