"use client"
// Browser-side PDF work for the documents module (pdf.js): read the text layer
// and page sizes on upload, render a thumbnail and page images of scans for
// text recognition, and render pages for the signing builder and signing page.
// Loaded lazily: pdf.js is large and only these screens need it.
import type { PDFDocumentProxy } from "pdfjs-dist"

let lib: Promise<typeof import("pdfjs-dist")> | null = null

export function loadPdfJs() {
  lib ??= import("pdfjs-dist").then((pdfjs) => {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString()
    return pdfjs
  })
  return lib
}

export async function openPdf(data: ArrayBuffer | string): Promise<PDFDocumentProxy> {
  const pdfjs = await loadPdfJs()
  return pdfjs.getDocument(typeof data === "string" ? { url: data } : { data: new Uint8Array(data) }).promise
}

export interface PageSize {
  width: number
  height: number
}

export async function pageSizes(pdf: PDFDocumentProxy): Promise<PageSize[]> {
  const out: PageSize[] = []
  for (let i = 1; i <= pdf.numPages; i++) {
    const vp = (await pdf.getPage(i)).getViewport({ scale: 1 })
    out.push({ width: Math.round(vp.width * 100) / 100, height: Math.round(vp.height * 100) / 100 })
  }
  return out
}

/** The text layer of the first `maxPages` pages, one paragraph per line. */
export async function extractText(pdf: PDFDocumentProxy, maxPages = 50): Promise<string> {
  const parts: string[] = []
  for (let i = 1; i <= Math.min(pdf.numPages, maxPages); i++) {
    const content = await (await pdf.getPage(i)).getTextContent()
    let line = ""
    for (const item of content.items) {
      if (!("str" in item)) continue
      line += item.str
      if (item.hasEOL) {
        parts.push(line)
        line = ""
      } else line += " "
    }
    if (line.trim()) parts.push(line)
    parts.push("")
  }
  return parts
    .join("\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

/** Renders one page (1-based) into a canvas at the given CSS width. */
export async function renderPage(pdf: PDFDocumentProxy, pageNumber: number, canvas: HTMLCanvasElement, cssWidth: number) {
  const page = await pdf.getPage(pageNumber)
  const base = page.getViewport({ scale: 1 })
  const dpr = typeof window === "undefined" ? 1 : Math.min(window.devicePixelRatio || 1, 2)
  const viewport = page.getViewport({ scale: (cssWidth / base.width) * dpr })
  canvas.width = Math.floor(viewport.width)
  canvas.height = Math.floor(viewport.height)
  canvas.style.width = `${cssWidth}px`
  canvas.style.height = `${(viewport.height / dpr).toFixed(1)}px`
  await page.render({ canvas, viewport }).promise
}

/** One page as a JPEG blob, `width` pixels wide. */
export async function pageImage(pdf: PDFDocumentProxy, pageNumber: number, width: number, quality = 0.8): Promise<Blob> {
  const page = await pdf.getPage(pageNumber)
  const base = page.getViewport({ scale: 1 })
  const viewport = page.getViewport({ scale: width / base.width })
  const canvas = document.createElement("canvas")
  canvas.width = Math.floor(viewport.width)
  canvas.height = Math.floor(viewport.height)
  const ctx = canvas.getContext("2d")!
  ctx.fillStyle = "#fff"
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  await page.render({ canvas, viewport }).promise
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("render_failed"))), "image/jpeg", quality))
}

/** A thumbnail of an image file, `width` pixels wide. */
export async function imageThumbnail(file: Blob, width: number): Promise<Blob> {
  const bmp = await createImageBitmap(file)
  const scale = Math.min(1, width / bmp.width)
  const canvas = document.createElement("canvas")
  canvas.width = Math.round(bmp.width * scale)
  canvas.height = Math.round(bmp.height * scale)
  canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height)
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("render_failed"))), "image/jpeg", 0.8))
}

/** Uploads one blob to a Convex upload URL; returns the storage ID. */
export async function uploadBlob(url: string, blob: Blob): Promise<string> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": blob.type || "application/octet-stream" }, body: blob })
  if (!res.ok) throw new Error(`upload_failed_${res.status}`)
  return ((await res.json()) as { storageId: string }).storageId
}
