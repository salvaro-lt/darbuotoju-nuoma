"use client"
// Renders a PDF's pages at the container's width, each in a box sized from the
// known page sizes (no layout shift while pdf.js loads), with an overlay layer
// on top for fields. Pages render when they come near the viewport.
import type { PDFDocumentProxy } from "pdfjs-dist"
import { useEffect, useRef, useState, type ReactNode } from "react"
import { Skeleton } from "@/components/ui/skeleton"
import { openPdf, renderPage, type PageSize } from "@/lib/documents/pdf"
import { cn } from "@/lib/utils"

export interface PageBox {
  index: number
  width: number
  height: number
}

export function PdfPages({
  url,
  pages,
  maxWidth = 900,
  overlay,
  pageClassName,
  onError,
}: {
  url: string | null
  pages: PageSize[]
  maxWidth?: number
  overlay?: (page: PageBox) => ReactNode
  pageClassName?: string
  onError?: () => void
}) {
  const wrap = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setWidth(Math.min(maxWidth, Math.floor(e!.contentRect.width))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [maxWidth])

  useEffect(() => {
    if (!url) return
    let alive = true
    let doc: PDFDocumentProxy | null = null
    openPdf(url)
      .then((d) => {
        doc = d
        if (alive) setPdf(d)
        else void d.cleanup()
      })
      .catch(() => {
        if (alive) {
          setFailed(true)
          onError?.()
        }
      })
    return () => {
      alive = false
      void doc?.cleanup()
    }
  }, [url, onError])

  return (
    <div ref={wrap} className="flex w-full flex-col items-center gap-4">
      {width > 0 &&
        pages.map((p, i) => {
          const height = (width * p.height) / p.width
          return (
            <div key={i} className={cn("relative bg-white shadow-[0_1px_3px_rgb(0_0_0/0.12),0_4px_16px_-4px_rgb(0_0_0/0.08)]", pageClassName)} style={{ width, height }} data-page={i}>
              <PageCanvas pdf={pdf} index={i} width={width} failed={failed} />
              {overlay && <div className="absolute inset-0">{overlay({ index: i, width, height })}</div>}
            </div>
          )
        })}
    </div>
  )
}

function PageCanvas({ pdf, index, width, failed }: { pdf: PDFDocumentProxy | null; index: number; width: number; failed: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [near, setNear] = useState(false)
  const [done, setDone] = useState(false)

  useEffect(() => {
    const el = canvas.current?.parentElement
    if (!el) return
    const io = new IntersectionObserver(([e]) => e!.isIntersecting && setNear(true), { rootMargin: "800px 0px" })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  useEffect(() => {
    if (!pdf || !near || !canvas.current) return
    let alive = true
    const t = setTimeout(() => {
      renderPage(pdf, index + 1, canvas.current!, width)
        .then(() => alive && setDone(true))
        .catch(() => undefined)
    }, 60)
    return () => {
      alive = false
      clearTimeout(t)
    }
  }, [pdf, near, index, width])

  return (
    <>
      {!done && !failed && <Skeleton className="absolute inset-0 rounded-none bg-muted/60" />}
      <canvas ref={canvas} aria-hidden="true" className={cn("absolute inset-0 transition-opacity duration-200", done ? "opacity-100" : "opacity-0")} />
    </>
  )
}
