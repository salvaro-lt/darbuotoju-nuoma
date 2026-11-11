"use client"
// Draw or type a signature; returns a trimmed PNG data URL (≤ 300k characters,
// the backend's limit). Drawing uses pointer events (mouse, pen, touch) with
// midpoint-smoothed curves.
import { Eraser } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

const INK = "#1b2a5a"
const MAX_CHARS = 290_000

export interface PadText {
  draw: string
  type: string
  clear: string
  drawHint: string
  typeLabel: string
  usePrevious: string
  apply: string
  cancel: string
  empty: string
}

/** Crops to the ink, scales to at most 600 px wide, exports PNG under the size limit. */
function exportTrimmed(src: HTMLCanvasElement): string | null {
  const ctx = src.getContext("2d")!
  const { width, height } = src
  const data = ctx.getImageData(0, 0, width, height).data
  let x0 = width
  let y0 = height
  let x1 = -1
  let y1 = -1
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if (data[(y * width + x) * 4 + 3]! > 8) {
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
  if (x1 < 0) return null
  const pad = 6
  x0 = Math.max(0, x0 - pad)
  y0 = Math.max(0, y0 - pad)
  const w = Math.min(width, x1 + pad) - x0
  const h = Math.min(height, y1 + pad) - y0
  let scale = Math.min(1, 600 / w)
  for (let i = 0; i < 6; i++) {
    const out = document.createElement("canvas")
    out.width = Math.max(1, Math.round(w * scale))
    out.height = Math.max(1, Math.round(h * scale))
    out.getContext("2d")!.drawImage(src, x0, y0, w, h, 0, 0, out.width, out.height)
    const url = out.toDataURL("image/png")
    if (url.length <= MAX_CHARS) return url
    scale *= 0.7
  }
  return null
}

export function SignaturePad({
  text,
  initials,
  defaultText,
  handFont,
  previous,
  onDone,
  onCancel,
}: {
  text: PadText
  initials: boolean
  defaultText: string
  handFont: string
  previous: string | null
  onDone: (png: string) => void
  onCancel: () => void
}) {
  const [mode, setMode] = useState<"draw" | "type">("draw")
  const [typed, setTyped] = useState(defaultText)
  const [hasInk, setHasInk] = useState(false)
  const [error, setError] = useState(false)
  const draw = useRef<HTMLCanvasElement>(null)
  const typeCanvas = useRef<HTMLCanvasElement>(null)
  const points = useRef<{ x: number; y: number }[]>([])
  const height = initials ? 140 : 190

  // Size the drawing canvas to its box at device resolution.
  useEffect(() => {
    const c = draw.current
    if (!c) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const w = c.parentElement!.clientWidth
    c.width = Math.round(w * dpr)
    c.height = Math.round(height * dpr)
    c.style.width = `${w}px`
    c.style.height = `${height}px`
    const ctx = c.getContext("2d")!
    ctx.scale(dpr, dpr)
    ctx.lineCap = "round"
    ctx.lineJoin = "round"
    ctx.strokeStyle = INK
    ctx.lineWidth = 2.4
  }, [height, mode])

  // Typed signature: render the text in the hand-written face.
  useEffect(() => {
    if (mode !== "type") return
    const c = typeCanvas.current
    if (!c) return
    let alive = true
    const size = initials ? 64 : 72
    const font = `500 ${size}px ${handFont}`
    void document.fonts.load(font).then(() => {
      if (!alive) return
      const dpr = 2
      const w = c.parentElement!.clientWidth
      c.width = w * dpr
      c.height = height * dpr
      c.style.width = `${w}px`
      c.style.height = `${height}px`
      const ctx = c.getContext("2d")!
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, height)
      let s = size
      ctx.font = font
      while (s > 24 && ctx.measureText(typed).width > w - 32) {
        s -= 4
        ctx.font = `500 ${s}px ${handFont}`
      }
      ctx.fillStyle = INK
      ctx.textBaseline = "middle"
      ctx.textAlign = "center"
      ctx.fillText(typed.trim(), w / 2, height / 2)
    })
    return () => {
      alive = false
    }
  }, [mode, typed, handFont, height, initials])

  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  function down(e: React.PointerEvent<HTMLCanvasElement>) {
    e.currentTarget.setPointerCapture(e.pointerId)
    const p = pos(e)
    points.current = [p]
    const ctx = e.currentTarget.getContext("2d")!
    ctx.beginPath()
    ctx.arc(p.x, p.y, 1.2, 0, Math.PI * 2)
    ctx.fillStyle = INK
    ctx.fill()
    setHasInk(true)
    setError(false)
  }

  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!points.current.length) return
    const ctx = e.currentTarget.getContext("2d")!
    for (const ev of e.nativeEvent.getCoalescedEvents?.() ?? [e.nativeEvent]) {
      const r = e.currentTarget.getBoundingClientRect()
      const p = { x: ev.clientX - r.left, y: ev.clientY - r.top }
      const pts = points.current
      const prev = pts[pts.length - 1]!
      const prev2 = pts[pts.length - 2] ?? prev
      // Curve from the previous midpoint to this midpoint, through the previous point.
      const m1 = { x: (prev2.x + prev.x) / 2, y: (prev2.y + prev.y) / 2 }
      const m2 = { x: (prev.x + p.x) / 2, y: (prev.y + p.y) / 2 }
      ctx.beginPath()
      ctx.moveTo(m1.x, m1.y)
      ctx.quadraticCurveTo(prev.x, prev.y, m2.x, m2.y)
      ctx.stroke()
      pts.push(p)
    }
  }

  const up = () => {
    points.current = []
  }

  function clear() {
    const c = draw.current
    if (!c) return
    c.getContext("2d")!.clearRect(0, 0, c.width, c.height)
    setHasInk(false)
  }

  function apply() {
    const src = mode === "draw" ? draw.current : typeCanvas.current
    const png = src && (mode === "draw" ? hasInk : typed.trim()) ? exportTrimmed(src) : null
    if (!png) return setError(true)
    onDone(png)
  }

  return (
    <div className="grid gap-3">
      <Tabs value={mode} onValueChange={(v) => setMode(v as "draw" | "type")}>
        <TabsList className="w-full">
          <TabsTrigger value="draw">{text.draw}</TabsTrigger>
          <TabsTrigger value="type">{text.type}</TabsTrigger>
        </TabsList>
        <TabsContent value="draw" className="grid gap-2">
          <div className="relative overflow-hidden rounded-lg border bg-white">
            <canvas ref={draw} className="block touch-none cursor-crosshair" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} aria-label={text.drawHint} role="img" />
            <span className="pointer-events-none absolute inset-x-6 bottom-8 border-b border-dashed border-slate-300" aria-hidden="true" />
            {!hasInk && <span className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-sm text-slate-500">{text.drawHint}</span>}
          </div>
          <div className="flex justify-end">
            <Button type="button" variant="ghost" size="sm" onClick={clear} disabled={!hasInk}>
              <Eraser /> {text.clear}
            </Button>
          </div>
        </TabsContent>
        <TabsContent value="type" className="grid gap-2">
          <Input value={typed} onChange={(e) => (setTyped(e.target.value), setError(false))} aria-label={text.typeLabel} maxLength={initials ? 6 : 80} autoFocus />
          <div className="overflow-hidden rounded-lg border bg-white">
            <canvas ref={typeCanvas} className="block" aria-hidden="true" />
          </div>
        </TabsContent>
      </Tabs>
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {text.empty}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {previous && (
          <Button type="button" variant="link" size="sm" className="px-0" onClick={() => onDone(previous)}>
            {text.usePrevious}
          </Button>
        )}
        <div className="ml-auto flex gap-2">
          <Button type="button" variant="outline" onClick={onCancel}>
            {text.cancel}
          </Button>
          <Button type="button" onClick={apply}>
            {text.apply}
          </Button>
        </div>
      </div>
    </div>
  )
}
