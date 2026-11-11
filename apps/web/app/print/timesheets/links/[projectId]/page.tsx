// Printable QR list of a project's personal hours links, outside the app shell (no sidebar).
import { StaffingTimesheetsPermissions } from "@digimuza/staffing/timesheets/manifest"
import { WorkerLinksPrint } from "@/app/app/timesheets/_components/worker-links-print"
import { requireSession } from "@/lib/system-server"

export default async function WorkerLinksPrintPage({ params }: { params: Promise<{ projectId: string }> }) {
  await requireSession({ permission: StaffingTimesheetsPermissions.write })
  const { projectId } = await params
  return <WorkerLinksPrint projectId={projectId} />
}
