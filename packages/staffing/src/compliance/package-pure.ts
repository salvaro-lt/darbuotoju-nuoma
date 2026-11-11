// Pure logic of the client document package (DIG-113): the package rule
// (complete → ready, else needs approval), the attachment size cap, the email
// (subject, text, HTML) in LT / EN / NL, and the public download link guard.
// No Convex, no I/O: safe in the browser and in tests.
import { isUsableCertificateStatus, type CertificateStatus } from "../pure"

// ---------------------------------------------------------------- statuses

/**
 * `needs_approval`: something is missing, a person decides (send anyway / cancel).
 * `ready`: complete, waiting for one click (or sent at once with "siųsti automatiškai").
 * `queued` → `sending` → `sent` | `failed` | `not_configured` (no n8n: still downloadable).
 */
export const PACKAGE_STATUSES = ["needs_approval", "ready", "queued", "sending", "sent", "failed", "not_configured", "cancelled"] as const
export type PackageStatus = (typeof PACKAGE_STATUSES)[number]
/** Statuses a person may still send from (send / send anyway / retry). */
export const SENDABLE_PACKAGE_STATUSES: readonly PackageStatus[] = ["needs_approval", "ready", "failed", "not_configured"]
/** Statuses that may still be cancelled. */
export const CANCELLABLE_PACKAGE_STATUSES: readonly PackageStatus[] = ["needs_approval", "ready", "failed", "not_configured"]

export const PACKAGE_LANGUAGES = ["lt", "en", "nl"] as const
export type PackageLanguage = (typeof PACKAGE_LANGUAGES)[number]
export const PACKAGE_TRIGGERS = ["ui", "ai", "seed"] as const
export type PackageTrigger = (typeof PACKAGE_TRIGGERS)[number]
export const MISSING_REASONS = ["missing", "expired", "noFile"] as const
export type MissingReason = (typeof MISSING_REASONS)[number]
export const PACKAGE_DELIVERIES = ["attachments", "link"] as const
export type PackageDelivery = (typeof PACKAGE_DELIVERIES)[number]

/** LT clients get Lithuanian, NL/BE clients a Dutch greeting (English body), everyone else English. */
export const defaultPackageLanguage = (country: string | null | undefined): PackageLanguage => {
  const c = (country ?? "").toUpperCase()
  if (c === "LT") return "lt"
  if (c === "NL" || c === "BE") return "nl"
  return "en"
}

// ---------------------------------------------------------------- the rule

export interface PackageDocInput {
  name: string
  nameEn?: string | null | undefined
  status: CertificateStatus | "notRequired"
  expiresAt?: string | null | undefined
  /** Expires before the worker's last day on the project. */
  expiresDuring?: boolean | undefined
  hasFile: boolean
  /** File size in bytes (0 when unknown). */
  size?: number | undefined
}
export interface PackageMemberInput {
  workerId: string
  workerName: string
  documents: readonly PackageDocInput[]
}
export interface PackageGap {
  workerId: string
  workerName: string
  document: string
  documentEn: string | null
  reason: MissingReason
  expiresAt: string | null
}
export interface PackageEvaluation {
  complete: boolean
  missing: PackageGap[]
  /** Valid now but expiring within 60 days or during the project: told, not blocking. */
  warnings: PackageGap[]
  fileCount: number
  totalBytes: number
}

/**
 * The package rule: complete when every required document of every member is
 * usable (valid or expiring) and has a stored file. Missing, expired, or
 * without a scan → listed in `missing` (the package then needs approval).
 * No members → not complete.
 */
export function evaluatePackage(members: readonly PackageMemberInput[]): PackageEvaluation {
  const missing: PackageGap[] = []
  const warnings: PackageGap[] = []
  let fileCount = 0
  let totalBytes = 0
  for (const m of members)
    for (const d of m.documents) {
      if (d.status === "notRequired") continue
      const gap = (reason: MissingReason): PackageGap => ({ workerId: m.workerId, workerName: m.workerName, document: d.name, documentEn: d.nameEn ?? null, reason, expiresAt: d.expiresAt ?? null })
      if (!isUsableCertificateStatus(d.status)) {
        missing.push(gap(d.status === "expired" ? "expired" : "missing"))
        continue
      }
      if (!d.hasFile) missing.push(gap("noFile"))
      else {
        fileCount++
        totalBytes += Math.max(0, d.size ?? 0)
      }
      if (d.status === "expiring30" || d.status === "expiring60" || d.expiresDuring) warnings.push(gap("missing"))
    }
  return { complete: members.length > 0 && missing.length === 0, missing, warnings, fileCount, totalBytes }
}

/** Status of a freshly built package: complete → `ready`, else `needs_approval`. */
export const initialPackageStatus = (e: Pick<PackageEvaluation, "complete">): PackageStatus => (e.complete ? "ready" : "needs_approval")

/** Default attachment cap: 15 MB of files (Resend allows 40 MB after base64), at most 40 files. */
export const DEFAULT_ATTACHMENT_CAP_BYTES = 15 * 1024 * 1024
export const MAX_ATTACHMENT_FILES = 40

/** Attach the files when they fit under the cap; otherwise send a time-limited link to a ZIP. */
export function planDelivery(totalBytes: number, fileCount: number, capBytes = DEFAULT_ATTACHMENT_CAP_BYTES, maxFiles = MAX_ATTACHMENT_FILES): PackageDelivery {
  return totalBytes > capBytes || fileCount > maxFiles ? "link" : "attachments"
}

/** "1.2 MB", "830 KB". */
export function formatBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${Math.max(1, Math.round(n / 1024))} KB`
}

// ---------------------------------------------------------------- the link

/** Days a public download link stays valid by default. */
export const DEFAULT_LINK_DAYS = 14
export type LinkState = "ok" | "not_found" | "expired" | "revoked"

/** Guard of the public `/d/<token>` link. */
export function linkState(link: { expiresAt: number; revokedAt?: number | null | undefined } | null | undefined, now: number): LinkState {
  if (!link) return "not_found"
  if (link.revokedAt) return "revoked"
  if (now >= link.expiresAt) return "expired"
  return "ok"
}

/** A URL-safe random token (`bytes` of entropy). */
export function randomToken(bytes = 24): string {
  const b = new Uint8Array(bytes)
  crypto.getRandomValues(b)
  let s = ""
  for (const x of b) s += String.fromCharCode(x)
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

/** Hex SHA-256: only this is stored; the token itself travels in the email. */
export async function sha256Hex(s: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))
  return [...d].map((x) => x.toString(16).padStart(2, "0")).join("")
}

/** Shape check before hashing: anything else is `not_found` without a lookup. */
export const looksLikeToken = (s: string): boolean => /^[A-Za-z0-9_-]{16,64}$/.test(s)

// ---------------------------------------------------------------- the email

export interface PackageEmailInput {
  language: PackageLanguage
  project: { code: string; name: string; city: string; country: string; startDate: string; endDate: string | null }
  clientName: string
  companyName: string
  contactName?: string | null | undefined
  members: readonly { workerName: string; tradeName: string; tradeNameEn?: string | null | undefined; documents: readonly { name: string; nameEn?: string | null | undefined; status: CertificateStatus | "notRequired"; expiresAt?: string | null | undefined; number?: string | null | undefined }[] }[]
  missing: readonly PackageGap[]
  warnings: readonly PackageGap[]
  delivery: PackageDelivery
  fileCount: number
  totalBytes: number
  /** Public download link and its expiry (YYYY-MM-DD); missing in previews. */
  link?: { url: string; expiresOn: string } | null | undefined
  note?: string | null | undefined
}
export interface PackageEmail {
  subject: string
  text: string
  /** Inner HTML (n8n wraps it in the mail layout). */
  html: string
}

const STR = {
  lt: {
    subject: (code: string, name: string) => `Darbuotojų dokumentai – ${code} ${name}`,
    hello: (n?: string | null) => `Laba diena${n ? `, ${n}` : ""},`,
    intro: (name: string, code: string, city: string, people: number, files: number) => `siunčiame projekto „${name}“ (${code}, ${city}) komandos dokumentus: ${people} darb., ${files} dok.`,
    team: "Komanda",
    validUntil: "galioja iki",
    noExpiry: "neterminuotas",
    none: "NĖRA",
    expired: "NEGALIOJA",
    missingTitle: "Trūksta",
    reason: { missing: "nėra dokumento", expired: "nebegalioja", noFile: "nėra skenuotos kopijos" } as Record<MissingReason, string>,
    missingOutro: "Trūkstamus dokumentus atsiųsime, kai tik juos gausime.",
    warningsTitle: "Atkreipkite dėmesį",
    warning: (d: string, until: string | null) => `${d} galioja iki ${until ?? "?"}`,
    attached: (n: number) => `Dokumentai (${n}) pridėti prie laiško.`,
    big: (size: string) => `Dokumentų rinkinys didelis (${size}), todėl jo neprisegame – atsisiųskite ZIP:`,
    linkAlso: "Visus dokumentus vienu ZIP taip pat galite atsisiųsti:",
    linkUntil: (d: string) => `(nuoroda galioja iki ${d})`,
    linkLater: "[atsisiuntimo nuoroda bus sugeneruota siunčiant]",
    bye: "Pagarbiai,",
    period: "Laikotarpis",
  },
  en: {
    subject: (code: string, name: string) => `Worker documents – ${code} ${name}`,
    hello: (n?: string | null) => `Dear ${n || "Sir or Madam"},`,
    intro: (name: string, code: string, city: string, people: number, files: number) => `please find the documents of the team for "${name}" (${code}, ${city}): ${people} workers, ${files} documents.`,
    team: "Team",
    validUntil: "valid until",
    noExpiry: "no expiry",
    none: "MISSING",
    expired: "EXPIRED",
    missingTitle: "Missing",
    reason: { missing: "no document", expired: "expired", noFile: "no scan on file" } as Record<MissingReason, string>,
    missingOutro: "We will send the missing documents as soon as we receive them.",
    warningsTitle: "Please note",
    warning: (d: string, until: string | null) => `${d} valid until ${until ?? "?"}`,
    attached: (n: number) => `The documents (${n}) are attached.`,
    big: (size: string) => `The documents are too large to attach (${size}); please download the ZIP:`,
    linkAlso: "You can also download all documents as one ZIP:",
    linkUntil: (d: string) => `(link valid until ${d})`,
    linkLater: "[download link is generated when sending]",
    bye: "Kind regards,",
    period: "Period",
  },
}
const NL = { hello: (n?: string | null) => `Geachte ${n || "heer/mevrouw"},`, bye: "Met vriendelijke groet," }

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")

/** Subject, plain text and HTML of the package email. NL = Dutch greeting and closing, English body. */
export function packageEmail(i: PackageEmailInput): PackageEmail {
  const s = i.language === "lt" ? STR.lt : STR.en
  const hello = i.language === "nl" ? NL.hello(i.contactName) : s.hello(i.contactName)
  const bye = i.language === "nl" ? NL.bye : s.bye
  const en = i.language !== "lt"
  const docName = (d: { name: string; nameEn?: string | null | undefined; documentEn?: string | null; document?: string }) => (en ? (d.nameEn ?? d.name) : d.name)
  const gapName = (g: PackageGap) => (en ? (g.documentEn ?? g.document) : g.document)
  const docLine = (d: PackageEmailInput["members"][number]["documents"][number]) => {
    if (d.status === "missing") return `${docName(d)}: ${s.none}`
    if (d.status === "expired") return `${docName(d)}: ${s.expired} (${d.expiresAt ?? ""})`
    return `${docName(d)}: ${d.expiresAt ? `${s.validUntil} ${d.expiresAt}` : s.noExpiry}`
  }
  const members = i.members.map((m) => ({ ...m, docs: m.documents.filter((d) => d.status !== "notRequired") }))
  const trade = (m: (typeof members)[number]) => (en ? (m.tradeNameEn ?? m.tradeName) : m.tradeName)
  const period = `${i.project.startDate} – ${i.project.endDate ?? "…"}`
  const subject = s.subject(i.project.code, i.project.name)
  const intro = s.intro(i.project.name, i.project.code, i.project.city, members.length, i.fileCount)
  const deliveryLine = i.delivery === "link" ? s.big(formatBytes(i.totalBytes)) : i.fileCount > 0 ? s.attached(i.fileCount) : null
  const linkLine = i.link ? `${i.link.url} ${s.linkUntil(i.link.expiresOn)}` : s.linkLater

  const text: string[] = [hello, "", intro, `${s.period}: ${period}`, ""]
  if (i.note?.trim()) text.push(i.note.trim(), "")
  text.push(`${s.team}:`)
  members.forEach((m, n) => {
    text.push(`${n + 1}. ${m.workerName} – ${trade(m)}`)
    if (m.docs.length) text.push(`   ${m.docs.map(docLine).join(" · ")}`)
  })
  if (i.missing.length) {
    text.push("", `${s.missingTitle}:`)
    for (const g of i.missing) text.push(`- ${g.workerName}: ${gapName(g)} (${s.reason[g.reason]}${g.reason === "expired" && g.expiresAt ? ` ${g.expiresAt}` : ""})`)
    text.push(s.missingOutro)
  }
  if (i.warnings.length) {
    text.push("", `${s.warningsTitle}:`)
    for (const g of i.warnings) text.push(`- ${g.workerName}: ${s.warning(gapName(g), g.expiresAt)}`)
  }
  text.push("")
  if (i.delivery === "link") text.push(s.big(formatBytes(i.totalBytes)), linkLine)
  else {
    if (deliveryLine) text.push(deliveryLine)
    text.push(s.linkAlso, linkLine)
  }
  text.push("", bye, i.companyName)

  const p = (x: string) => `<p style="margin:0 0 12px">${x}</p>`
  const cell = (x: string, bad = false) => `<td style="border-bottom:1px solid #eef1f0;padding:6px;vertical-align:top${bad ? ";color:#b42318;font-weight:bold" : ""}">${x}</td>`
  const rows = members
    .map(
      (m) =>
        `<tr>${cell(`<b>${esc(m.workerName)}</b><br><span style="color:#6b7a74">${esc(trade(m))}</span>`)}${cell(
          m.docs.map((d) => (d.status === "missing" || d.status === "expired" ? `<span style="color:#b42318;font-weight:bold">${esc(docLine(d))}</span>` : esc(docLine(d)))).join("<br>"),
        )}</tr>`,
    )
    .join("")
  const linkHtml = i.link ? `<a href="${esc(i.link.url)}" style="color:#9a3412">${esc(i.link.url)}</a> ${esc(s.linkUntil(i.link.expiresOn))}` : `<i>${esc(s.linkLater)}</i>`
  const html = [
    p(esc(hello)),
    p(`${esc(intro)}<br><span style="color:#6b7a74">${esc(s.period)}: ${esc(period)}</span>`),
    i.note?.trim() ? p(esc(i.note.trim()).replace(/\n/g, "<br>")) : "",
    `<h3 style="font-size:15px;margin:16px 0 8px">${esc(s.team)}</h3>`,
    `<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:13px">${rows}</table>`,
    i.missing.length
      ? `<h3 style="font-size:15px;margin:16px 0 8px;color:#b42318">${esc(s.missingTitle)}</h3><ul style="margin:0 0 8px;padding-left:20px">${i.missing
          .map((g) => `<li>${esc(g.workerName)}: <b>${esc(gapName(g))}</b> (${esc(s.reason[g.reason])}${g.reason === "expired" && g.expiresAt ? ` ${esc(g.expiresAt)}` : ""})</li>`)
          .join("")}</ul>${p(esc(s.missingOutro))}`
      : "",
    i.warnings.length
      ? `<h3 style="font-size:15px;margin:16px 0 8px">${esc(s.warningsTitle)}</h3><ul style="margin:0 0 8px;padding-left:20px">${i.warnings.map((g) => `<li>${esc(g.workerName)}: ${esc(s.warning(gapName(g), g.expiresAt))}</li>`).join("")}</ul>`
      : "",
    i.delivery === "link" ? p(`${esc(s.big(formatBytes(i.totalBytes)))}<br>${linkHtml}`) : p(`${deliveryLine ? `${esc(deliveryLine)}<br>` : ""}${esc(s.linkAlso)} ${linkHtml}`),
    p(`${esc(bye)}<br>${esc(i.companyName)}`),
  ].join("\n")
  return { subject, text: text.join("\n"), html }
}
