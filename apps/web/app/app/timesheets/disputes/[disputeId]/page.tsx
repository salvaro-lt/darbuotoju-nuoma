import { StaffingTimesheetsPermissions } from "@digimuza/staffing/timesheets/manifest"
import { requireSession } from "@/lib/system-server"
import { DisputePage } from "../../_components/disputes"

export default async function TimesheetDisputePage({ params }: { params: Promise<{ disputeId: string }> }) {
  await requireSession({ permission: StaffingTimesheetsPermissions.read })
  const { disputeId } = await params
  return <DisputePage disputeId={disputeId} />
}
