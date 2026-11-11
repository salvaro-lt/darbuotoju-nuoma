// Pure logic of the compliance area (documents and contracts): readiness of a
// team for a project, expiry digest thresholds, contract templates, and a
// tiny ZIP writer for the client document package. No Convex, no I/O: safe to
// import from the browser and from tests (`@digimuza/staffing/compliance/pure`).
import { CERTIFICATE_STATUS_RANK, certificateStatus, daysBetween, isUsableCertificateStatus, worstCertificateStatus, type CertificateStatus } from "../pure"

// ---------------------------------------------------------------- requirements

/** Who a requirement applies to: everyone, or only workers who need a work permit (outside the EU/EEA/CH). */
export const REQUIREMENT_SCOPES = ["all", "nonEea"] as const
export type RequirementScope = (typeof REQUIREMENT_SCOPES)[number]

/** EU + EEA + Switzerland (ISO-2): citizens need no work permit for postings inside it. */
export const EEA_COUNTRIES: ReadonlySet<string> = new Set(
  "AT BE BG HR CY CZ DK EE FI FR DE GR HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE IS LI NO CH".split(" "),
)

export interface RequirementLike {
  certificateTypeId: string
  /** ISO-2 country of the project, or missing when the requirement belongs to a client. */
  country?: string | undefined
  /** Client the requirement belongs to, or missing when it belongs to a country. */
  clientId?: string | undefined
  scope: RequirementScope
}

/** The requirements of a project: its country's plus its client's (several rows of one type merge; `all` wins over `nonEea`). */
export function projectRequirements<R extends RequirementLike>(reqs: readonly R[], project: { country: string; clientId: string }): Map<string, RequirementScope> {
  const out = new Map<string, RequirementScope>()
  for (const r of reqs) {
    if (!((r.country && r.country === project.country) || (r.clientId && r.clientId === project.clientId))) continue
    const cur = out.get(r.certificateTypeId)
    out.set(r.certificateTypeId, cur === "all" || r.scope === "all" ? "all" : "nonEea")
  }
  return out
}

/** Does the requirement apply to a worker of this nationality? */
export const requirementApplies = (scope: RequirementScope, nationality: string): boolean => scope === "all" || !EEA_COUNTRIES.has(nationality.toUpperCase())

// ---------------------------------------------------------------- readiness

export interface ReadinessCell {
  /** Status on the first day the worker is (still) on the project. */
  status: CertificateStatus | "notRequired"
  /** The certificate expires before the worker's last day on the project. */
  expiresDuring: boolean
}

/**
 * One cell of the readiness matrix: the worker's latest certificate of a type,
 * checked on `from` (the later of today and the assignment start) and through
 * `to` (the assignment's or project's end; missing = open-ended, checked on `from` only).
 */
export function readinessCell(cert: { expiresAt?: string | null | undefined } | null | undefined, from: string, to: string | null | undefined, required = true): ReadinessCell {
  if (!required) return { status: "notRequired", expiresDuring: false }
  const status = certificateStatus(cert, from)
  const expiresDuring = Boolean(cert?.expiresAt && isUsableCertificateStatus(status) && to && cert.expiresAt < to)
  return { status, expiresDuring }
}

export type Readiness = "ready" | "warning" | "blocked"

/** Blocked: something missing or expired. Warning: expires within 60 days or during the project. */
export function rowReadiness(cells: readonly ReadinessCell[]): Readiness {
  const relevant = cells.filter((c): c is ReadinessCell & { status: CertificateStatus } => c.status !== "notRequired")
  const worst = worstCertificateStatus(relevant.map((c) => c.status))
  if (!isUsableCertificateStatus(worst)) return "blocked"
  if (worst !== "valid" || relevant.some((c) => c.expiresDuring)) return "warning"
  return "ready"
}

export const READINESS_RANK: Record<Readiness, number> = { ready: 0, warning: 1, blocked: 2 }
export const worstReadiness = (xs: Iterable<Readiness>): Readiness => {
  let w: Readiness = "ready"
  for (const x of xs) if (READINESS_RANK[x] > READINESS_RANK[w]) w = x
  return w
}

/** The later of two ISO days. */
export const laterDay = (a: string, b: string): string => (a > b ? a : b)

// ---------------------------------------------------------------- expiry digest

/** Digest thresholds: a certificate is reported once per threshold it reaches. */
export const DIGEST_THRESHOLDS = ["60", "30", "expired"] as const
export type DigestThreshold = (typeof DIGEST_THRESHOLDS)[number]

/** The threshold reached `daysLeft` days before expiry; `null` when more than 60 days are left. */
export function digestThreshold(daysLeft: number): DigestThreshold | null {
  if (daysLeft < 0) return "expired"
  if (daysLeft <= 30) return "30"
  if (daysLeft <= 60) return "60"
  return null
}

export interface DigestCandidate {
  certificateId: string
  expiresAt: string
}

/** Certificates to report today: those that reached a threshold not reported yet (`sent` holds `certificateId:threshold`). */
export function pickDigest<C extends DigestCandidate>(certs: readonly C[], today: string, sent: ReadonlySet<string>): (C & { daysLeft: number; threshold: DigestThreshold })[] {
  const out: (C & { daysLeft: number; threshold: DigestThreshold })[] = []
  for (const c of certs) {
    const daysLeft = daysBetween(today, c.expiresAt)
    const threshold = digestThreshold(daysLeft)
    if (threshold && !sent.has(digestKey(c.certificateId, threshold))) out.push({ ...c, daysLeft, threshold })
  }
  return out.sort((a, b) => a.daysLeft - b.daysLeft)
}
export const digestKey = (certificateId: string, threshold: DigestThreshold) => `${certificateId}:${threshold}`

// ---------------------------------------------------------------- contract templates

export const TEMPLATE_LANGUAGES = ["lt", "en"] as const
export type TemplateLanguage = (typeof TEMPLATE_LANGUAGES)[number]

/** Placeholders a template may use. `{{name?}}` marks an optional one (empty when unknown, never reported missing). */
export const TEMPLATE_PLACEHOLDERS = [
  "today",
  "company.name",
  "worker.fullName",
  "worker.firstName",
  "worker.lastName",
  "worker.personalCode",
  "worker.nationality",
  "worker.phone",
  "worker.email",
  "worker.homeCity",
  "worker.homeCountry",
  "project.name",
  "project.code",
  "project.country",
  "project.city",
  "project.siteAddress",
  "project.startDate",
  "project.endDate",
  "client.name",
  "client.country",
  "client.address",
  "client.vatCode",
  "assignment.startDate",
  "assignment.endDate",
  "trade",
  "tradeEn",
  "hourlyRate",
  "currency",
] as const
export type TemplatePlaceholder = (typeof TEMPLATE_PLACEHOLDERS)[number]
export type TemplateValues = Partial<Record<TemplatePlaceholder, string | null | undefined>>

const PLACEHOLDER = /\{\{\s*([a-zA-Z][\w.]*)(\?)?\s*\}\}/g

/**
 * Fills `{{placeholder}}`s. Unknown or empty required ones stay visible as
 * `[placeholder]` and are listed in `missing`; optional ones (`{{x?}}`) become empty.
 */
export function fillTemplate(body: string, values: TemplateValues): { text: string; missing: string[] } {
  const missing = new Set<string>()
  const text = body.replace(PLACEHOLDER, (_m, name: string, optional?: string) => {
    const value = (values as Record<string, string | null | undefined>)[name]
    if (value !== undefined && value !== null && value !== "") return value
    if (optional) return ""
    missing.add(name)
    return `[${name}]`
  })
  return { text, missing: [...missing] }
}

/** Placeholder names used by a template that the system does not know. */
export function unknownPlaceholders(body: string): string[] {
  const known = new Set<string>(TEMPLATE_PLACEHOLDERS)
  return [...new Set([...body.matchAll(PLACEHOLDER)].map((m) => m[1]!).filter((n) => !known.has(n)))]
}

export const escapeHtml = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;")

/**
 * A filled contract (plain text) as HTML: lines starting with `# ` are
 * headings, `## ` subheadings, blank lines split paragraphs. Everything is escaped.
 */
export function contractTextToHtml(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      if (block.startsWith("## ")) return `<h2>${escapeHtml(block.slice(3))}</h2>`
      if (block.startsWith("# ")) return `<h1>${escapeHtml(block.slice(2))}</h1>`
      return `<p>${block.split("\n").map(escapeHtml).join("<br>")}</p>`
    })
    .join("\n")
}

/** A full printable HTML page (A4, serif) around a body fragment. */
export function printableHtml(title: string, bodyHtml: string, lang = "lt"): string {
  return `<!doctype html><html lang="${escapeHtml(lang)}"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>
@page{size:A4;margin:20mm}body{font-family:Georgia,"Times New Roman",serif;font-size:11.5pt;line-height:1.5;color:#111;max-width:180mm;margin:0 auto;padding:12mm 0}
h1{font-size:16pt;text-align:center;margin:0 0 12pt}h2{font-size:12.5pt;margin:14pt 0 6pt}p{margin:0 0 8pt}
table{border-collapse:collapse;width:100%;font-size:9.5pt;font-family:Arial,sans-serif}th,td{border:1px solid #999;padding:3pt 5pt;text-align:left;vertical-align:top}th{background:#eee}
.muted{color:#666}.bad{color:#b00;font-weight:bold}.sign{display:flex;gap:30mm;margin-top:24pt}.sign div{flex:1;border-top:1px solid #333;padding-top:4pt;font-size:9.5pt}
@media print{.noprint{display:none}}</style></head><body>${bodyHtml}</body></html>`
}

// ---------------------------------------------------------------- formatting

/** "42.50" from cents; `null` stays `null`. */
export const centsText = (cents: number | null | undefined): string | null => (cents === null || cents === undefined ? null : (cents / 100).toFixed(2))

export const statusRank = (s: CertificateStatus | "notRequired") => (s === "notRequired" ? -1 : CERTIFICATE_STATUS_RANK[s])

// ---------------------------------------------------------------- zip (stored, no compression)

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]!) & 0xff]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/**
 * A ZIP archive of the files, stored without compression (scans and PDFs are
 * compressed already). Names are UTF-8. Enough for a few hundred files < 4 GB.
 */
export function zipStore(files: readonly { name: string; data: Uint8Array }[]): Uint8Array {
  const enc = new TextEncoder()
  const locals: Uint8Array[] = []
  const centrals: Uint8Array[] = []
  let offset = 0
  for (const f of files) {
    const name = enc.encode(f.name)
    const crc = crc32(f.data)
    const local = new Uint8Array(30 + name.length)
    const lv = new DataView(local.buffer)
    lv.setUint32(0, 0x04034b50, true)
    lv.setUint16(4, 20, true)
    lv.setUint16(6, 0x0800, true) // UTF-8 names
    lv.setUint16(8, 0, true) // stored
    lv.setUint32(14, crc, true)
    lv.setUint32(18, f.data.length, true)
    lv.setUint32(22, f.data.length, true)
    lv.setUint16(26, name.length, true)
    local.set(name, 30)
    const central = new Uint8Array(46 + name.length)
    const cv = new DataView(central.buffer)
    cv.setUint32(0, 0x02014b50, true)
    cv.setUint16(4, 20, true)
    cv.setUint16(6, 20, true)
    cv.setUint16(8, 0x0800, true)
    cv.setUint32(16, crc, true)
    cv.setUint32(20, f.data.length, true)
    cv.setUint32(24, f.data.length, true)
    cv.setUint16(28, name.length, true)
    cv.setUint32(42, offset, true)
    central.set(name, 46)
    locals.push(local, f.data)
    centrals.push(central)
    offset += local.length + f.data.length
  }
  const centralSize = centrals.reduce((s, c) => s + c.length, 0)
  const end = new Uint8Array(22)
  const ev = new DataView(end.buffer)
  ev.setUint32(0, 0x06054b50, true)
  ev.setUint16(8, files.length, true)
  ev.setUint16(10, files.length, true)
  ev.setUint32(12, centralSize, true)
  ev.setUint32(16, offset, true)
  const out = new Uint8Array(offset + centralSize + 22)
  let p = 0
  for (const part of [...locals, ...centrals, end]) {
    out.set(part, p)
    p += part.length
  }
  return out
}

/** A file name safe on every OS: no path separators or reserved characters. */
export const safeFileName = (s: string): string =>
  [...s]
    .map((ch) => (ch.charCodeAt(0) < 32 ? "_" : ch))
    .join("")
    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120) || "file"

// ---------------------------------------------------------------- demo PDF

const pdfText = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7e]/g, "?")
    .replace(/[\\()]/g, (m) => `\\${m}`)

/** A one-page A4 PDF with a title and text lines (ASCII only: accents are dropped). For demo certificate scans. */
export function simplePdf(title: string, lines: readonly string[]): Uint8Array {
  const content = [
    "0.85 0.2 0.2 RG 2 w 40 40 515 762 re S",
    "BT /F1 20 Tf 60 750 Td",
    `(${pdfText(title)}) Tj`,
    "/F1 12 Tf",
    ...lines.flatMap((l) => ["0 -26 Td", `(${pdfText(l)}) Tj`]),
    "ET",
  ].join("\n")
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ]
  let out = "%PDF-1.4\n"
  const offsets: number[] = []
  objects.forEach((o, i) => {
    offsets.push(out.length)
    out += `${i + 1} 0 obj\n${o}\nendobj\n`
  })
  const xref = out.length
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return new TextEncoder().encode(out)
}
