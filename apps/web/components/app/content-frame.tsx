"use client"
import { usePathname } from "next/navigation"
import { ViewTransition, type ReactNode } from "react"

// Routes that are a workspace (they fill the viewport and manage their own scroll)
// instead of a document page with the usual centred column.
const FULL_BLEED = ["/app/ai"]
// Wide workspaces (CRM lists, boards, records) use the whole width but keep the page padding.
// Their settings pages are forms and keep the readable column.
const WIDE = ["/app/crm", "/app/documents"]
const COLUMN = ["/app/crm/settings", "/app/documents/labels"]
// The signing template builder fills the viewport (pages on the left, fields on the right).
const isBuilder = (pathname: string) => /^\/app\/documents\/templates\/[^/]+$/.test(pathname)
const under = (pathname: string, p: string) => pathname === p || pathname.startsWith(`${p}/`)

/**
 * Page frame inside the app shell: centred column by default, wide or
 * full-bleed for workspaces. Route changes animate here and only here (the
 * sidebar and header stay put): the old page fades out, the new one fades in
 * and rises a few px. Keyed by pathname, so search-param changes (filters)
 * don't count as a page change; a full-bleed workspace keeps one key so
 * switching threads doesn't re-animate its shell. See globals.css → "Route transitions".
 */
export function ContentFrame({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const workspace = FULL_BLEED.find((p) => under(pathname, p)) ?? (isBuilder(pathname) ? "builder" : undefined)
  const wide = WIDE.some((p) => under(pathname, p)) && !COLUMN.some((p) => under(pathname, p))
  const frame = workspace
    ? "flex min-h-0 flex-1 flex-col"
    : wide
      ? "w-full min-w-0 px-4 pt-6 pb-24 md:px-8 md:pt-8"
      : // pb-24 keeps the floating Super toolbar off the last row.
        "mx-auto w-full max-w-6xl px-4 pt-6 pb-24 md:px-8 md:pt-8"
  return (
    <ViewTransition key={workspace ?? pathname} enter="page-in" exit="page-out" default="none">
      <div data-page-transition className={frame}>
        {children}
      </div>
    </ViewTransition>
  )
}
