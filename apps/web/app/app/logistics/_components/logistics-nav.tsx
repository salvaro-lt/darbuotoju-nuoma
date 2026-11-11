"use client"
// The logistics entry in the "Darbuotojai ir projektai" sidebar group (nav.tsx renders it).
import { StaffingLogisticsPermissions } from "@digimuza/staffing/logistics/manifest"
import { useCan } from "@digimuza/system-core/react"
import { BedDouble } from "lucide-react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { LinkPending } from "@/components/app/link-pending"
import { SidebarMenuButton, SidebarMenuItem, useSidebar } from "@/components/ui/sidebar"
import { useT } from "@/lib/i18n/client"
import { useLogisticsEnabled } from "./logistics-ui"

export function LogisticsNavItem() {
  const { t } = useT()
  const on = useLogisticsEnabled()
  const can = useCan(StaffingLogisticsPermissions.planRead)
  const path = usePathname()
  const { isMobile, setOpenMobile } = useSidebar()
  if (!on || !can) return null
  const href = "/app/logistics"
  const active = path === href || path.startsWith(`${href}/`)
  const label = t("logistics.nav")
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={active} tooltip={label}>
        <Link href={href} aria-current={active ? "page" : undefined} onNavigate={() => isMobile && setOpenMobile(false)}>
          <BedDouble />
          <span className="min-w-0 flex-1 truncate">{label}</span>
          <LinkPending className="group-data-[collapsible=icon]:hidden" />
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}
