"use client"
import { ArrowRight, CircleAlert, Info, Mail, TriangleAlert } from "lucide-react"
import { useRouter } from "next/navigation"
import type { ReactNode } from "react"
import { signOutAction } from "@/app/login/actions"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { setLocale } from "@/lib/i18n/actions"
import { LOCALES, type Locale } from "@/lib/i18n/messages"
import { cn } from "@/lib/utils"

// shadcn Alert variants only.
const TONES = {
  info: { icon: Info, variant: "default" },
  warning: { icon: TriangleAlert, variant: "default" },
  danger: { icon: CircleAlert, variant: "destructive" },
} as const

/** Inline status with its recovery. Warnings and errors are announced. */
export function Notice({ tone, title, children }: { tone: keyof typeof TONES; title: string; children?: ReactNode }) {
  const { icon: Icon, variant } = TONES[tone]
  return (
    <Alert variant={variant} role={tone === "info" ? "status" : "alert"}>
      <Icon />
      <AlertTitle>{title}</AlertTitle>
      {children && <AlertDescription>{children}</AlertDescription>}
    </Alert>
  )
}

/** Primary navigation to /sign-in: a plain link (no prefetch), it sets the PKCE cookie. */
export function PrimaryLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Button asChild size="lg" className="w-full">
      <a href={href}>
        {children}
        <ArrowRight />
      </a>
    </Button>
  )
}

export function SignOutButton({ primary, children }: { primary?: boolean; children: ReactNode }) {
  return (
    <form action={signOutAction} className={cn(!primary && "flex justify-center")}>
      <Button type="submit" variant={primary ? "default" : "link"} size={primary ? "lg" : "default"} className={cn(primary && "w-full")}>
        {children}
      </Button>
    </form>
  )
}

export function InviteSymbol() {
  return (
    <span className="inline-grid size-11 place-items-center rounded-[3px] bg-muted text-foreground" aria-hidden="true">
      <Mail className="size-5" />
    </span>
  )
}

export function LanguageSwitch({ locale, label }: { locale: Locale; label: string }) {
  const router = useRouter()
  return (
    <Tabs
      value={locale}
      aria-label={label}
      onValueChange={async (l) => {
        const fd = new FormData()
        fd.set("locale", l)
        await setLocale(fd)
        router.refresh()
      }}
    >
      <TabsList className="h-8">
        {LOCALES.map((l) => (
          <TabsTrigger key={l} value={l} lang={l} className="px-3 text-xs">
            {l.toUpperCase()}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  )
}
