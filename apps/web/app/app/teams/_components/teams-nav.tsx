"use client"
// The "teams" area's entry in the staffing sidebar group (one line in nav.tsx).
import { StaffingTeamsPermissions, STAFFING_TEAMS_MODULE_ID } from "@digimuza/staffing/teams/manifest"
import { useCan, useVisibleModules } from "@digimuza/system-core/react"
import { UsersRound } from "lucide-react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { LinkPending } from "@/components/app/link-pending"
import { SidebarMenuButton, SidebarMenuItem, useSidebar } from "@/components/ui/sidebar"
import { useT } from "@/lib/i18n/client"

export function useTeamsEnabled() {
  return useVisibleModules().some((m) => m.id === STAFFING_TEAMS_MODULE_ID && m.effective)
}

export function TeamsNavItem() {
  const { t } = useT()
  const on = useTeamsEnabled()
  const can = useCan(StaffingTeamsPermissions.requestRead)
  const path = usePathname()
  const { isMobile, setOpenMobile } = useSidebar()
  if (!on || !can) return null
  const href = "/app/teams"
  const active = path === href || path.startsWith(`${href}/`)
  const label = t("teams.nav")
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={active} tooltip={label}>
        <Link href={href} aria-current={active ? "page" : undefined} onNavigate={() => isMobile && setOpenMobile(false)}>
          <UsersRound />
          <span className="min-w-0 flex-1 truncate">{label}</span>
          <LinkPending className="group-data-[collapsible=icon]:hidden" />
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}
