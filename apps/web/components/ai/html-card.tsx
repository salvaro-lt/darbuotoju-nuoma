"use client"
import { AI_CARD_RESIZE_MESSAGE, AI_CARD_THEME_VARS, cardDocument, type CardTheme } from "@digimuza/system-core/ai/card"
import { LayoutTemplate } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { Skeleton } from "@/components/ui/skeleton"
import { useT } from "@/lib/i18n/client"

const MIN_HEIGHT = 48
const MAX_HEIGHT = 720

/** Current theme: the app's computed CSS variables, font and light/dark. Updates when the theme class changes. */
function useCardTheme() {
  const [state, setState] = useState<{ theme: CardTheme; dark: boolean; font: string } | null>(null)
  useEffect(() => {
    const root = document.documentElement
    const read = () => {
      const css = getComputedStyle(root)
      const theme: CardTheme = {}
      for (const name of AI_CARD_THEME_VARS) {
        const v = css.getPropertyValue(`--${name}`).trim()
        if (v) theme[name] = v
      }
      setState({ theme, dark: root.classList.contains("dark"), font: getComputedStyle(document.body).fontFamily })
    }
    read()
    const obs = new MutationObserver(read)
    obs.observe(root, { attributes: true, attributeFilter: ["class", "style"] })
    return () => obs.disconnect()
  }, [])
  return state
}

/**
 * Model-made HTML in a sandboxed iframe (`allow-scripts` only: opaque origin,
 * no access to the app). The document's CSP blocks all network; the only thing
 * read back is the content height, accepted from this frame alone and clamped.
 */
export function HtmlCard({ id, title, html, ready }: { id: string; title?: string | undefined; html: string; ready: boolean }) {
  const { t } = useT()
  const frame = useRef<HTMLIFrameElement>(null)
  const [height, setHeight] = useState<number | null>(null)
  const look = useCardTheme()

  const srcDoc = useMemo(() => (look && ready ? cardDocument({ html, id, theme: look.theme, dark: look.dark, fontFamily: look.font }) : null), [look, ready, html, id])

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (e.source !== frame.current?.contentWindow) return
      const d = e.data as { type?: unknown; id?: unknown; height?: unknown } | null
      if (!d || d.type !== AI_CARD_RESIZE_MESSAGE || typeof d.height !== "number" || !Number.isFinite(d.height)) return
      setHeight(Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, Math.ceil(d.height))))
    }
    window.addEventListener("message", onMessage)
    return () => window.removeEventListener("message", onMessage)
  }, [])

  return (
    <figure className="my-3 overflow-hidden rounded-xl border bg-card text-card-foreground shadow-sm">
      {title && (
        <figcaption className="flex items-center gap-2 border-b px-4 py-2.5 text-sm font-medium">
          <LayoutTemplate className="size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 truncate">{title}</span>
        </figcaption>
      )}
      {srcDoc ? (
        <div className="relative">
          {height === null && <Skeleton className="absolute inset-4 h-auto" />}
          <iframe
            ref={frame}
            title={title || t("ai.card.frame")}
            sandbox="allow-scripts"
            referrerPolicy="no-referrer"
            srcDoc={srcDoc}
            className="block w-full border-0 bg-transparent transition-[height] duration-200 ease-out"
            style={{ height: height ?? 160, colorScheme: look?.dark ? "dark" : "light" }}
            scrolling={height === MAX_HEIGHT ? "yes" : "no"}
          />
        </div>
      ) : (
        <div className="grid gap-2 p-4" aria-live="polite">
          <p className="text-xs text-muted-foreground">{t("ai.card.loading")}</p>
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-20 w-full" />
        </div>
      )}
    </figure>
  )
}
