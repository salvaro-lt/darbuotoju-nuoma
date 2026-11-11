"use client"
import "@radix-ui/themes/styles.css"
import "@workos-inc/widgets/styles.css"
import { useAccessToken } from "@workos-inc/authkit-nextjs/components"
import { UserProfile, UserSecurity, UserSessions, WorkOsWidgets } from "@workos-inc/widgets"
import { WorkOsLocaleProvider } from "@workos-inc/widgets-i18n"
import { ChevronDown, MonitorSmartphone, ShieldCheck, UserRound } from "lucide-react"
import { useCallback, useState, useSyncExternalStore, type ReactNode } from "react"
import { brand } from "@/brand"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { useT } from "@/lib/i18n/client"

/** Tracks the `dark` class the theme script keeps in sync with the OS. */
function useDark() {
  return useSyncExternalStore(
    (cb) => {
      const mo = new MutationObserver(cb)
      mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] })
      return () => mo.disconnect()
    },
    () => document.documentElement.classList.contains("dark"),
    () => false,
  )
}

/**
 * WorkOS widgets for the user's own identity: profile, password/MFA, sessions.
 * They call the WorkOS API from the browser with the user's access token, so
 * the site's origin must be allowed in WorkOS (dashboard → CORS / allowed origins).
 * Users, roles, invites and API keys are NOT managed here: system-core owns them.
 */
export function AccountWidgets() {
  // Widgets follow the app language (lt / en) via @workos-inc/widgets-i18n.
  const { t, locale } = useT()
  const dark = useDark()
  const { getAccessToken } = useAccessToken()
  const authToken = useCallback(async () => {
    const token = await getAccessToken()
    if (!token) throw new Error("No WorkOS access token")
    return token
  }, [getAccessToken])

  return (
    <WorkOsLocaleProvider locale={locale}>
      <WorkOsWidgets
        className="account-widgets"
        theme={{
          appearance: dark ? "dark" : "light",
          accentColor: brand.widgetAccent,
          grayColor: "gray",
          radius: "medium",
          scaling: "100%",
          panelBackground: "solid",
          hasBackground: false,
          fontFamily: "var(--font-sans)",
        }}
      >
        <Section icon={<UserRound />} title={t("account.profile")}>
          <UserProfile authToken={authToken} />
        </Section>
        <Section icon={<ShieldCheck />} title={t("account.security")} lead={t("account.securityLead")}>
          <UserSecurity authToken={authToken} />
        </Section>
        <Section icon={<MonitorSmartphone />} title={t("account.sessions")} lead={t("account.sessionsLead")}>
          <UserSessions authToken={authToken} />
        </Section>
      </WorkOsWidgets>
    </WorkOsLocaleProvider>
  )
}

/** Label column + content, divided by hairlines (the settings pattern). */
export function Section({ icon, title, lead, children }: { icon: ReactNode; title: string; lead?: string; children: ReactNode }) {
  return (
    <section className="grid gap-4 border-t py-8 first:border-t-0 first:pt-2 lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-10">
      <div>
        <h2 className="flex items-center gap-2 text-base font-semibold [&_svg]:size-4 [&_svg]:text-muted-foreground">
          {icon}
          {title}
        </h2>
        {lead && <p className="mt-1.5 max-w-[30ch] text-sm text-muted-foreground">{lead}</p>}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  )
}

export function AccessTag({ children }: { children: ReactNode }) {
  return <Badge>{children}</Badge>
}

/** The person's current permissions (system-core), collapsed by default. */
export function PermissionList({ label, permissions }: { label: string; permissions: string[] }) {
  const [open, setOpen] = useState(false)
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <Button variant="ghost" size="sm" className="-ml-3">
          {label} <span className="text-muted-foreground">({permissions.length})</span>
          <ChevronDown className={open ? "rotate-180 transition-transform" : "transition-transform"} />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-3 flex flex-wrap gap-1.5">
        {permissions.map((p) => (
          <Badge key={p} variant="outline" className="font-mono text-[11px] font-normal">
            {p}
          </Badge>
        ))}
      </CollapsibleContent>
    </Collapsible>
  )
}
