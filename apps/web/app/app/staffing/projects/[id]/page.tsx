import { StaffingPermissions } from "@digimuza/staffing/manifest"
import { requireSession } from "@/lib/system-server"
import { ProjectDetailView } from "../../_components/projects"

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  await requireSession({ permission: StaffingPermissions.projectRead })
  const { id } = await params
  return <ProjectDetailView projectId={id} />
}
