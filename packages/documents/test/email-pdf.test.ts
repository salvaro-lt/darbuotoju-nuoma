import { PDFDocument, StandardFonts } from "pdf-lib"
import { describe, expect, test } from "vitest"
import { asciiOnly, htmlToText, renderEmailPdf, wrapText } from "../src/email-pdf"

describe("email PDF", () => {
  test("long bodies wrap and flow onto more pages; metadata keeps Lithuanian letters", async () => {
    const text = Array.from({ length: 400 }, (_, i) => `Eilutė ${i}: ${"labai ilgas sakinys ".repeat(6)}`).join("\n")
    const bytes = await renderEmailPdf({ subject: "Sąskaita už spalį", from: "Jonas <jonas@example.com>", to: ["a@x.lt"], date: "2026 m. lapkričio 11 d.", inbox: "Užklausos", text, attachments: ["a.pdf"] })
    const doc = await PDFDocument.load(bytes)
    expect(doc.getPageCount()).toBeGreaterThan(5)
    expect(doc.getTitle()).toBe("Sąskaita už spalį")
  })

  test("without a font, text is transliterated; long words are broken to fit", async () => {
    expect(asciiOnly("Ąžuolas „šaunus“ — 😀")).toBe('Azuolas "saunus" - ?')
    const font = await (await PDFDocument.create()).embedFont(StandardFonts.Helvetica)
    const lines = wrapText(font, `trumpas ${"x".repeat(300)}`, 10, 100)
    expect(lines.length).toBeGreaterThan(3)
    for (const l of lines) expect(font.widthOfTextAtSize(l, 10)).toBeLessThanOrEqual(100)
  })

  test("HTML bodies become readable text", () => {
    expect(htmlToText("<style>p{}</style><p>Sveiki,</p><p>priede&nbsp;<b>sutartis</b>.</p>")).toBe("Sveiki,\npriede sutartis.")
  })
})
