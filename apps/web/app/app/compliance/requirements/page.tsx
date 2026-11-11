import { StaffingCompliancePermissions } from "@digimuza/staffing/compliance/manifest"
import { requireSession } from "@/lib/system-server"
import { RequirementsView } from "../_components/requirements"

export default async function RequirementsPage() {
  await requireSession({ permission: StaffingCompliancePermissions.readinessRead })
  return <RequirementsView />
}
