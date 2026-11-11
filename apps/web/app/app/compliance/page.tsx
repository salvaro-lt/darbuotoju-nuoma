import { StaffingCompliancePermissions } from "@digimuza/staffing/compliance/manifest"
import { requireSession } from "@/lib/system-server"
import { ReadinessList } from "./_components/readiness"

export default async function CompliancePage() {
  await requireSession({ permission: StaffingCompliancePermissions.readinessRead })
  return <ReadinessList />
}
