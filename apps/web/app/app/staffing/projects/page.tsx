import { StaffingPermissions } from "@digimuza/staffing/manifest"
import { requireSession } from "@/lib/system-server"
import { ProjectsList } from "../_components/projects"

export default async function ProjectsPage() {
  await requireSession({ permission: StaffingPermissions.projectRead })
  return <ProjectsList />
}
