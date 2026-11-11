import "./globals.css"
import type { Metadata } from "next"
import { Barlow, Barlow_Condensed, Big_Shoulders_Stencil, Geist_Mono } from "next/font/google"
import type { CSSProperties, ReactNode } from "react"
import { withAuth } from "@workos-inc/authkit-nextjs"
import { brand } from "@/brand"
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import { getPublicEnv } from "@/env"
import { LocaleProvider } from "@/lib/i18n/client"
import { getLocale } from "@/lib/i18n/server"
import { cn } from "@/lib/utils"
import { Providers } from "./providers"

// Hull-marking world: Barlow (DIN-like workhorse) for UI, Barlow Condensed for
// labels and table heads, a stencil face for page titles only.
const sans = Barlow({ subsets: ["latin", "latin-ext"], weight: ["400", "500", "600", "700"], variable: "--font-sans" })
const condensed = Barlow_Condensed({ subsets: ["latin", "latin-ext"], weight: ["500", "600", "700"], variable: "--font-condensed" })
const stencil = Big_Shoulders_Stencil({ subsets: ["latin", "latin-ext"], weight: ["700", "800"], variable: "--font-stencil" })
const mono = Geist_Mono({ subsets: ["latin", "latin-ext"], variable: "--font-mono" })

// Every page depends on the session and on runtime config (one image, many
// environments), so nothing is prerendered at build time.
export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: brand.name,
  robots: { index: false, follow: false },
}

// The client's accent, from brand.ts, becomes shadcn's --primary (globals.css).
const brandVars = {
  "--brand-accent-light": brand.accent.light,
  "--brand-accent-dark": brand.accent.dark,
  "--brand-accent-text-light": brand.accentText.light,
  "--brand-accent-text-dark": brand.accentText.dark,
} as CSSProperties

// Follows the OS light/dark setting before first paint (no flash) and live
// afterwards, via the `dark` class shadcn's tokens key off. Also marks browsers
// without View Transitions (`no-vt`) so route changes get a CSS fade instead.
const themeScript = `(function(){var m=window.matchMedia("(prefers-color-scheme: dark)");function a(){document.documentElement.classList.toggle("dark",m.matches)}a();m.addEventListener("change",a);if(!document.startViewTransition)document.documentElement.classList.add("no-vt")})()`

export default async function RootLayout({ children }: { children: ReactNode }) {
  // The access token stays on the server; the client fetches its own.
  const { accessToken: _token, ...initialAuth } = await withAuth()
  const locale = await getLocale()
  return (
    <html lang={locale} style={brandVars} className={cn(sans.variable, condensed.variable, stencil.variable, mono.variable)} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="antialiased">
        <LocaleProvider locale={locale}>
          <Providers convexUrl={getPublicEnv().CONVEX_URL} initialAuth={initialAuth}>
            <TooltipProvider>{children}</TooltipProvider>
            <Toaster richColors closeButton position="top-center" />
          </Providers>
        </LocaleProvider>
      </body>
    </html>
  )
}
