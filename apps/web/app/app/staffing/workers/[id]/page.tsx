import { StaffingPermissions } from "@digimuza/staffing/manifest"
import { requireSession } from "@/lib/system-server"
import { WorkerCardView } from "../../_components/worker-card"

export default async function WorkerPage({ params }: { params: Promise<{ id: string }> }) {
  await requireSession({ permission: StaffingPermissions.workerRead })
  const { id } = await params
  return <WorkerCardView workerId={id} />
}
