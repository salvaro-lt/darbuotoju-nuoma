import { StaffingCompliancePermissions } from "@digimuza/staffing/compliance/manifest"
import { requireSession } from "@/lib/system-server"
import { ProjectPackageView } from "../../../_components/package"

export default async function ProjectPackagePage({ params }: { params: Promise<{ id: string }> }) {
  await requireSession({ permission: StaffingCompliancePermissions.readinessRead })
  const { id } = await params
  return <ProjectPackageView projectId={id} />
}
