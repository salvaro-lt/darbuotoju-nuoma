import { StaffingPermissions } from "@digimuza/staffing/manifest"
import { requireSession } from "@/lib/system-server"
import { WorkersList } from "../_components/workers-list"

export default async function WorkersPage() {
  await requireSession({ permission: StaffingPermissions.workerRead })
  return <WorkersList />
}
