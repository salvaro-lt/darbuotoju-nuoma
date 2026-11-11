import { StaffingLogisticsPermissions } from "@digimuza/staffing/logistics/manifest"
import { requireSession } from "@/lib/system-server"
import { LogisticsList } from "./_components/logistics-list"

export default async function LogisticsPage() {
  await requireSession({ permission: StaffingLogisticsPermissions.planRead })
  return <LogisticsList />
}
