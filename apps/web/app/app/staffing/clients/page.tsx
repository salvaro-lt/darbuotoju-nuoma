import { StaffingPermissions } from "@digimuza/staffing/manifest"
import { requireSession } from "@/lib/system-server"
import { ClientsList } from "../_components/clients-list"

export default async function ClientsPage() {
  await requireSession({ permission: StaffingPermissions.clientRead })
  return <ClientsList />
}
