import { StaffingLogisticsPermissions } from "@digimuza/staffing/logistics/manifest"
import { requireSession } from "@/lib/system-server"
import { ProjectLogistics } from "../_components/project-logistics"

export default async function ProjectLogisticsPage({ params }: { params: Promise<{ projectId: string }> }) {
  await requireSession({ permission: StaffingLogisticsPermissions.planRead })
  const { projectId } = await params
  return <ProjectLogistics projectId={projectId} />
}
