import { StaffingTimesheetsPermissions } from "@digimuza/staffing/timesheets/manifest"
import { requireSession } from "@/lib/system-server"
import { ProjectTimesheet } from "../_components/week-grid"

export default async function ProjectTimesheetPage({ params }: { params: Promise<{ projectId: string }> }) {
  await requireSession({ permission: StaffingTimesheetsPermissions.read })
  const { projectId } = await params
  return <ProjectTimesheet projectId={projectId} />
}
