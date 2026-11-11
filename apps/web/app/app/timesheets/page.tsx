import { StaffingTimesheetsPermissions } from "@digimuza/staffing/timesheets/manifest"
import { requireSession } from "@/lib/system-server"
import { TimesheetsOverview } from "./_components/overview"

export default async function TimesheetsPage() {
  await requireSession({ permission: StaffingTimesheetsPermissions.read })
  return <TimesheetsOverview />
}
