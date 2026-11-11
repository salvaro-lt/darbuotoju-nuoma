import { StaffingTimesheetsPermissions } from "@digimuza/staffing/timesheets/manifest"
import { requireSession } from "@/lib/system-server"
import { SubcontractorExport } from "../_components/subcontractors"

export default async function SubcontractorTimesheetsPage() {
  await requireSession({ permission: StaffingTimesheetsPermissions.export })
  return <SubcontractorExport />
}
