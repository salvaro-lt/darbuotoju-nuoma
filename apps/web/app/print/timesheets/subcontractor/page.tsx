// Printable subcontractor timesheet, outside the app shell (no sidebar).
import { StaffingTimesheetsPermissions } from "@digimuza/staffing/timesheets/manifest"
import { SubcontractorPrint } from "@/app/app/timesheets/_components/subcontractors"
import { requireSession } from "@/lib/system-server"

export default async function SubcontractorPrintPage() {
  await requireSession({ permission: StaffingTimesheetsPermissions.export })
  return <SubcontractorPrint />
}
