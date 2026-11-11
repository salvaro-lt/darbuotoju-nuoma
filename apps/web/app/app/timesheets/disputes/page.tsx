import { StaffingTimesheetsPermissions } from "@digimuza/staffing/timesheets/manifest"
import { requireSession } from "@/lib/system-server"
import { DisputesPage } from "../_components/disputes"

export default async function TimesheetDisputesPage() {
  await requireSession({ permission: StaffingTimesheetsPermissions.read })
  return <DisputesPage />
}
