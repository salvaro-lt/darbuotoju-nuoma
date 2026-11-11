"use client"
import { AutomationsPermissions } from "@digimuza/system-core/automations"
import { useCan } from "@digimuza/system-core/react"
import { useQuery } from "convex/react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { useT } from "@/lib/i18n/client"
import { cn } from "@/lib/utils"
import { convexApi as api } from "./shared"

/** Automatizacijos · Laukia patvirtinimo (n) · Istorija */
export function AutomationsSectionNav() {
  const { t } = useT()
  const path = usePathname()
  const canRead = useCan(AutomationsPermissions.read)
  const pending = useQuery(api.automations.countPendingRuns, canRead ? {} : "skip")
  const links = [
    { href: "/app/automations", label: t("auto.nav.list"), active: path === "/app/automations" || (/^\/app\/automations\/(?!review|runs)/.test(path) && path !== "/app/automations/review") },
    { href: "/app/automations/review", label: t("auto.nav.review"), active: path.startsWith("/app/automations/review"), count: pending },
    { href: "/app/automations/runs", label: t("auto.nav.runs"), active: path.startsWith("/app/automations/runs") },
  ]
  return (
    <nav aria-label={t("nav.automations")} className="-mx-1 mb-6 flex gap-1 overflow-x-auto border-b px-1">
      {links.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          aria-current={l.active ? "page" : undefined}
          className={cn(
            "-mb-px flex shrink-0 items-center gap-2 border-b-2 border-transparent px-3 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground",
            l.active && "border-primary font-medium text-foreground",
          )}
        >
          {l.label}
          {!!l.count && <span className="rounded-full bg-amber-500/15 px-1.5 text-xs font-medium tabular-nums text-amber-700 dark:text-amber-300">{l.count > 99 ? "99+" : l.count}</span>}
        </Link>
      ))}
    </nav>
  )
}
