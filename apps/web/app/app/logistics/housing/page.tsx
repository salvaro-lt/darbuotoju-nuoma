import { StaffingLogisticsPermissions } from "@digimuza/staffing/logistics/manifest"
import { requireSession } from "@/lib/system-server"
import { HousingDashboard } from "../_components/housing"

export default async function HousingPage() {
  await requireSession({ permission: StaffingLogisticsPermissions.planRead })
  return <HousingDashboard />
}
