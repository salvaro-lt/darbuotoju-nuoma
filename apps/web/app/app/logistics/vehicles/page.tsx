import { StaffingLogisticsPermissions } from "@digimuza/staffing/logistics/manifest"
import { requireSession } from "@/lib/system-server"
import { FleetDashboard } from "../_components/fleet"

export default async function VehiclesPage() {
  await requireSession({ permission: StaffingLogisticsPermissions.planRead })
  return <FleetDashboard />
}
