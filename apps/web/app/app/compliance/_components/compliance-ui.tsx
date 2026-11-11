"use client"
// Shared pieces of the compliance pages (staffing area "Dokumentai ir sutartys").
import { STAFFING_COMPLIANCE_MODULE_ID, StaffingCompliancePermissions } from "@digimuza/staffing/compliance/manifest"
import type { Readiness } from "@digimuza/staffing/compliance/pure"
import { useCan, useVisibleModules } from "@digimuza/system-core/react"
import { ShieldCheck } from "lucide-react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import type { ComponentType, ReactNode } from "react"
import { Badge } from "@/components/ui/badge"
import { useT } from "@/lib/i18n/client"
import type { MessageKey } from "@/lib/i18n/messages"
import { useStaffingEnabled } from "../../staffing/_components/staffing-ui"

export function useComplianceEnabled() {
  const staffingOn = useStaffingEnabled()
  return useVisibleModules().some((m) => m.id === STAFFING_COMPLIANCE_MODULE_ID && m.effective) && staffingOn
}

/** The sidebar entry; rendered by app/app/nav.tsx with its own NavItem. */
export function ComplianceNavItem({ Item }: { Item: ComponentType<{ href: string; icon: ReactNode; label: string }> }) {
  const { t } = useT()
  const on = useComplianceEnabled()
  const canReadiness = useCan(StaffingCompliancePermissions.readinessRead)
  const canContracts = useCan(StaffingCompliancePermissions.contractRead)
  if (!on || !(canReadiness || canContracts)) return null
  return <Item href="/app/compliance" icon={<ShieldCheck />} label={t("compliance.nav")} />
}

/** `{name}` placeholders in a UI string. */
export const fmt = (s: string, vars: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m))

const TABS = [
  { href: "/app/compliance", key: "compliance.tab.readiness", exact: false, also: "/app/compliance/projects" },
  { href: "/app/compliance/expiring", key: "compliance.tab.expiring" },
  { href: "/app/compliance/contracts", key: "compliance.tab.contracts" },
  { href: "/app/compliance/requirements", key: "compliance.tab.requirements" },
] as const

export function ComplianceTabs() {
  const { t } = useT()
  const path = usePathname()
  const active = (tab: (typeof TABS)[number]) => (tab.href === "/app/compliance" ? path === tab.href || path.startsWith("/app/compliance/projects") : path.startsWith(tab.href))
  return (
    <nav className="mb-5 flex flex-wrap gap-1 border-b" aria-label={t("compliance.nav")}>
      {TABS.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          aria-current={active(tab) ? "page" : undefined}
          className={`-mb-px border-b-2 px-3 py-2 text-sm transition-colors ${active(tab) ? "border-primary font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
        >
          {t(tab.key as MessageKey)}
        </Link>
      ))}
    </nav>
  )
}

const READINESS_STYLE: Record<Readiness, { variant: "secondary" | "outline" | "destructive"; dot: string }> = {
  ready: { variant: "secondary", dot: "bg-steel-green/80" },
  warning: { variant: "outline", dot: "bg-marking" },
  blocked: { variant: "destructive", dot: "bg-destructive/80" },
}

export function ReadinessBadge({ readiness }: { readiness: Readiness }) {
  const { t } = useT()
  const s = READINESS_STYLE[readiness]
  return (
    <Badge variant={s.variant}>
      <span className={`size-1.5 rounded-full ${s.dot}`} aria-hidden />
      {t(`compliance.readiness.${readiness}` as MessageKey)}
    </Badge>
  )
}

export function ComplianceDisabled() {
  const { t } = useT()
  return <p className="text-sm text-muted-foreground">{t("compliance.disabled")}</p>
}

/** Opens a printable HTML document in a new tab and starts printing. */
export function openPrintable(html: string) {
  const w = window.open("", "_blank")
  if (!w) return
  w.document.open()
  w.document.write(html)
  w.document.close()
  w.focus()
  setTimeout(() => w.print(), 400)
}

export const complianceProjectHref = (id: string) => `/app/compliance/projects/${id}`
