"use client"
// Links between the logistics pages: projects, housing pool, transport.
import Link from "next/link"
import { usePathname } from "next/navigation"
import { Button } from "@/components/ui/button"
import { useT } from "@/lib/i18n/client"
import type { MessageKey } from "@/lib/i18n/messages"

const LINKS: [href: string, key: MessageKey][] = [
  ["/app/logistics", "logistics.sub.projects"],
  ["/app/logistics/housing", "logistics.sub.housing"],
  ["/app/logistics/vehicles", "logistics.sub.fleet"],
]

export function LogisticsSubnav() {
  const { t } = useT()
  const path = usePathname()
  return (
    <nav aria-label={t("logistics.nav")} className="mb-4 flex flex-wrap gap-1">
      {LINKS.map(([href, key]) => {
        const active = href === "/app/logistics" ? path === href : path.startsWith(href)
        return (
          <Button key={href} asChild size="sm" variant={active ? "secondary" : "ghost"}>
            <Link href={href} aria-current={active ? "page" : undefined}>
              {t(key)}
            </Link>
          </Button>
        )
      })}
    </nav>
  )
}

/** Region + month pickers shared by the housing and transport pages. */
export function RegionMonth({ regions, region, month, onRegion, onMonth }: { regions: string[]; region: string; month: string; onRegion: (r: string) => void; onMonth: (m: string) => void }) {
  const { t } = useT()
  return (
    <div className="flex flex-wrap items-end gap-2">
      <label className="grid gap-1 text-xs text-muted-foreground">
        {t("logistics.region")}
        <select value={region} onChange={(e) => onRegion(e.target.value)} className="h-8 rounded-md border border-input bg-transparent px-2 text-sm text-foreground shadow-xs dark:bg-input/30">
          {regions.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-1 text-xs text-muted-foreground">
        {t("logistics.month")}
        <input type="month" value={month} onChange={(e) => e.target.value && onMonth(e.target.value)} className="h-8 rounded-md border border-input bg-transparent px-2 text-sm text-foreground tabular-nums shadow-xs dark:bg-input/30" />
      </label>
    </div>
  )
}

/** A square KPI plate. */
export function Plate({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "bad" | "warn" | "ok" }) {
  const color = tone === "bad" ? "text-destructive" : tone === "warn" ? "text-marking-foreground dark:text-marking" : tone === "ok" ? "text-steel-green" : "text-foreground"
  return (
    <div className="border bg-card px-4 py-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${color}`}>{value}</div>
      {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
    </div>
  )
}
