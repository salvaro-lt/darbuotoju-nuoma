import { StaffingCompliancePermissions } from "@digimuza/staffing/compliance/manifest"
import { requireSession } from "@/lib/system-server"
import { ExpiringView } from "../_components/expiring"

export default async function ExpiringPage() {
  await requireSession({ permission: StaffingCompliancePermissions.readinessRead })
  return <ExpiringView />
}
