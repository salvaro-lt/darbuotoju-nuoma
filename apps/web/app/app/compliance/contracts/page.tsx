import { StaffingCompliancePermissions } from "@digimuza/staffing/compliance/manifest"
import { requireSession } from "@/lib/system-server"
import { ContractsView } from "../_components/contracts"

export default async function ContractsPage() {
  await requireSession({ permission: StaffingCompliancePermissions.contractRead })
  return <ContractsView />
}
