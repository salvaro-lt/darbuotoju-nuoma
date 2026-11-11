// A received email as a PDF: headers, then the text body, wrapped over as
// many A4 pages as it needs. With the module's TrueType font Lithuanian
// letters render; without it, Helvetica and letters are transliterated.
import fontkit from "@pdf-lib/fontkit"
import { PDFDocument, rgb, StandardFonts, type PDFFont } from "pdf-lib"

export interface EmailPdfInput {
  subject: string
  from: string
  to: string[]
  /** Already formatted for the reader. */
  date: string
  inbox: string
  text: string
  attachments: string[]
  font?: Uint8Array | null
  lang?: "lt" | "en"
}

const A4 = { w: 595.28, h: 841.89 }
const MARGIN = 50
const LABELS = {
  lt: { from: "Nuo", to: "Kam", date: "Data", inbox: "Pašto dėžutė", attachments: "Priedai", noSubject: "(be temos)", empty: "(laiškas be teksto)" },
  en: { from: "From", to: "To", date: "Date", inbox: "Inbox", attachments: "Attachments", noSubject: "(no subject)", empty: "(no text)" },
}

const LT = "ąčęėįšųūžĄČĘĖĮŠŲŪŽ„“–—’‘…"
const ASCII = ["a", "c", "e", "e", "i", "s", "u", "u", "z", "A", "C", "E", "E", "I", "S", "U", "U", "Z", '"', '"', "-", "-", "'", "'", "..."]
/** Helvetica (WinAnsi) has no Lithuanian letters: transliterate, drop what it cannot draw. */
export function asciiOnly(s: string): string {
  return [...s]
    .map((c) => {
      const i = LT.indexOf(c)
      if (i >= 0) return ASCII[i]!
      const code = c.charCodeAt(0)
      return code === 9 ? "    " : code >= 32 && code < 127 ? c : code >= 160 && code <= 255 ? c : "?"
    })
    .join("")
}

/** Splits text into lines that fit `maxW` (long words are broken). */
export function wrapText(font: PDFFont, text: string, size: number, maxW: number): string[] {
  const out: string[] = []
  for (const para of text.replace(/\r\n?/g, "\n").split("\n")) {
    if (!para.trim()) {
      out.push("")
      continue
    }
    let line = ""
    for (const word of para.split(/(\s+)/)) {
      const next = line + word
      if (font.widthOfTextAtSize(next, size) <= maxW) {
        line = next
        continue
      }
      if (line.trim()) out.push(line.trimEnd())
      line = word.trimStart()
      while (font.widthOfTextAtSize(line, size) > maxW && line.length > 1) {
        let cut = line.length - 1
        while (cut > 1 && font.widthOfTextAtSize(line.slice(0, cut), size) > maxW) cut--
        out.push(line.slice(0, cut))
        line = line.slice(cut)
      }
    }
    if (line.trim()) out.push(line.trimEnd())
  }
  return out
}

export async function renderEmailPdf(input: EmailPdfInput): Promise<Uint8Array> {
  const L = LABELS[input.lang ?? "lt"]
  const doc = await PDFDocument.create()
  let font: PDFFont
  let clean = (s: string) => s
  if (input.font) {
    doc.registerFontkit(fontkit)
    font = await doc.embedFont(input.font, { subset: true })
  } else {
    font = await doc.embedFont(StandardFonts.Helvetica)
    clean = asciiOnly
  }
  const subject = input.subject.trim() || L.noSubject
  doc.setTitle(subject)
  doc.setAuthor(input.from)
  doc.setCreator("Dokumentai")

  const maxW = A4.w - MARGIN * 2
  const ink = rgb(0.1, 0.1, 0.12)
  const muted = rgb(0.4, 0.4, 0.45)
  let page = doc.addPage([A4.w, A4.h])
  let y = A4.h - MARGIN
  const draw = (lines: string[], size: number, color = ink, gap = 1.35) => {
    for (const line of lines) {
      if (y - size < MARGIN) {
        page = doc.addPage([A4.w, A4.h])
        y = A4.h - MARGIN
      }
      y -= size
      if (line) page.drawText(line, { x: MARGIN, y, size, font, color })
      y -= size * (gap - 1)
    }
  }

  draw(wrapText(font, clean(subject), 16, maxW), 16)
  y -= 8
  const header: [string, string][] = [
    [L.from, input.from],
    [L.to, input.to.join(", ")],
    [L.date, input.date],
    [L.inbox, input.inbox],
    ...(input.attachments.length ? ([[L.attachments, input.attachments.join(", ")]] as [string, string][]) : []),
  ]
  for (const [k, val] of header) draw(wrapText(font, clean(`${k}: ${val}`), 9.5, maxW), 9.5, muted)
  y -= 6
  page.drawLine({ start: { x: MARGIN, y }, end: { x: A4.w - MARGIN, y }, thickness: 0.5, color: rgb(0.8, 0.8, 0.82) })
  y -= 14
  draw(wrapText(font, clean(input.text.trim() || L.empty), 10.5, maxW), 10.5)
  return doc.save()
}

/** Readable text of an HTML body, for emails without a text part. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}
