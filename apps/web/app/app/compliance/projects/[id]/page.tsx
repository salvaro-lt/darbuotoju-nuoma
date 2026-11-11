import { StaffingCompliancePermissions } from "@digimuza/staffing/compliance/manifest"
import { requireSession } from "@/lib/system-server"
import { ProjectReadinessView } from "../../_components/readiness"

export default async function ProjectReadinessPage({ params }: { params: Promise<{ id: string }> }) {
  await requireSession({ permission: StaffingCompliancePermissions.readinessRead })
  const { id } = await params
  return <ProjectReadinessView projectId={id} />
}
