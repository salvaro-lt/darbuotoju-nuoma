"use client"
// The "planning" area's sidebar entry (one line in nav.tsx) and its shared pieces.
import { StaffingPlanningPermissions, STAFFING_PLANNING_MODULE_ID } from "@digimuza/staffing/planning/manifest"
import type { CellState, WorkerPlanStatus } from "@digimuza/staffing/planning/pure"
import { useCan, useVisibleModules } from "@digimuza/system-core/react"
import { CalendarRange } from "lucide-react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { LinkPending } from "@/components/app/link-pending"
import { Badge } from "@/components/ui/badge"
import { SidebarMenuButton, SidebarMenuItem, useSidebar } from "@/components/ui/sidebar"
import { useT } from "@/lib/i18n/client"

export function usePlanningEnabled() {
  return useVisibleModules().some((m) => m.id === STAFFING_PLANNING_MODULE_ID && m.effective)
}

export function PlanningNavItem() {
  const { t } = useT()
  const on = usePlanningEnabled()
  const can = useCan(StaffingPlanningPermissions.boardRead)
  const path = usePathname()
  const { isMobile, setOpenMobile } = useSidebar()
  if (!on || !can) return null
  const href = "/app/planning"
  const active = path === href || path.startsWith(`${href}/`)
  const label = t("planning.nav")
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={active} tooltip={label}>
        <Link href={href} aria-current={active ? "page" : undefined} onNavigate={() => isMobile && setOpenMobile(false)}>
          <CalendarRange />
          <span className="min-w-0 flex-1 truncate">{label}</span>
          <LinkPending className="group-data-[collapsible=icon]:hidden" />
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}

/** "11-16" from "2026-11-16". */
export const shortDate = (d: string | null | undefined) => (d ? d.slice(5) : "")

/*
 * Worker state as a plate: form carries the state, colour confirms it.
 *   working      solid ink plate
 *   resting      marking-yellow plate (home, comes back)
 *   unavailable  hollow red-oxide frame
 *   reserve      steel-green bar (ready to go)
 */
const STATE_CLASS: Record<WorkerPlanStatus["state"], string> = {
  working: "bg-secondary text-secondary-foreground",
  resting: "border-transparent bg-marking text-marking-foreground",
  unavailable: "border-destructive/70 bg-transparent text-destructive",
  reserve: "border-transparent bg-steel-green/15 text-foreground",
}

/** Dirba (iki …) / Namuose, ilsisi iki … / Nepasiekiamas / Rezerve, pasiruošęs. */
export function WorkerStateBadge({ status, short = false }: { status: Pick<WorkerPlanStatus, "state" | "until" | "projectCode">; short?: boolean }) {
  const { t } = useT()
  const until = status.until ? ` ${t("planning.state.until")} ${shortDate(status.until)}` : ""
  const label =
    status.state === "working"
      ? `${t("planning.state.working")}${!short && status.projectCode ? ` · ${status.projectCode}` : ""}${until}`
      : status.state === "resting"
        ? `${t("planning.state.resting")}${until}`
        : status.state === "unavailable"
          ? `${t("planning.state.unavailable")}${until}`
          : t("planning.state.reserve")
  return (
    <Badge variant="outline" className={STATE_CLASS[status.state]}>
      {status.state === "reserve" && <span className="h-2.5 w-[3px] shrink-0 bg-steel-green" aria-hidden />}
      {label}
    </Badge>
  )
}

/** Week cells of the workers × weeks grid. */
export const CELL_CLASS: Record<CellState, string> = {
  project: "bg-secondary text-secondary-foreground",
  ending: "bg-secondary text-secondary-foreground border-r-4 border-r-steel-green",
  proposed: "border border-dashed border-foreground/40 text-muted-foreground",
  rest: "bg-marking/70 text-marking-foreground",
  unavailable: "border border-destructive/60 text-destructive",
  free: "bg-steel-green/15 text-foreground",
}
