import { CrmPermissions } from "@digimuza/crm/manifest"
import { requireSession } from "@/lib/system-server"
import { DataModel } from "../_components/data-model"

export default async function CrmSettingsPage() {
  await requireSession({ permission: CrmPermissions.manageSchema })
  return <DataModel />
}
