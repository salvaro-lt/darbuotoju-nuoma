"use client"
// Reads one file in the browser before it is filed: the PDF's text layer and
// page count, a thumbnail, and page images of scans for text recognition.
// Every step is best effort: a file pdf.js cannot read is still uploaded.
import { extractText, imageThumbnail, openPdf, pageImage } from "./pdf"

export const MAX_UPLOAD = 50 * 1024 * 1024
/** Below this many characters a PDF counts as a scan: its pages go to text recognition. */
const SCAN_TEXT = 30
const OCR_PAGES = 3

export interface PreparedFile {
  content: string
  pageCount?: number
  thumbnail?: Blob
  ocrImages: Blob[]
}

export const isPdf = (f: { type: string; name: string }) => f.type === "application/pdf" || /\.pdf$/i.test(f.name)
export const isImage = (f: { type: string }) => /^image\/(png|jpe?g|webp|gif)$/.test(f.type)

export async function prepareFile(file: File): Promise<PreparedFile> {
  if (isPdf(file)) {
    try {
      const pdf = await openPdf(await file.arrayBuffer())
      const content = await extractText(pdf).catch(() => "")
      const thumbnail = await pageImage(pdf, 1, 400, 0.75).catch(() => undefined)
      const ocrImages: Blob[] = []
      if (content.trim().length < SCAN_TEXT) {
        for (let p = 1; p <= Math.min(pdf.numPages, OCR_PAGES); p++) {
          const img = await pageImage(pdf, p, 1600, 0.82).catch(() => null)
          if (img) ocrImages.push(img)
        }
      }
      const pageCount = pdf.numPages
      await pdf.cleanup()
      return { content, pageCount, ...(thumbnail ? { thumbnail } : {}), ocrImages }
    } catch {
      return { content: "", ocrImages: [] }
    }
  }
  if (isImage(file)) {
    const thumbnail = await imageThumbnail(file, 400).catch(() => undefined)
    return { content: "", ...(thumbnail ? { thumbnail } : {}), ocrImages: [] }
  }
  if (file.type.startsWith("text/") && file.size < 2 * 1024 * 1024) return { content: await file.text(), ocrImages: [] }
  return { content: "", ocrImages: [] }
}
