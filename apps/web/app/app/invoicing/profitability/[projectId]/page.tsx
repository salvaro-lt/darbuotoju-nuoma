import { StaffingInvoicingPermissions } from "@digimuza/staffing/invoicing/manifest"
import { requireSession } from "@/lib/system-server"
import { ProjectProfitView } from "../../_components/profit"

export default async function ProjectProfitPage({ params }: { params: Promise<{ projectId: string }> }) {
  await requireSession({ permission: StaffingInvoicingPermissions.profitRead })
  const { projectId } = await params
  return <ProjectProfitView projectId={projectId} />
}
