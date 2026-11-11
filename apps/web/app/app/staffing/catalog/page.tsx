import { StaffingPermissions } from "@digimuza/staffing/manifest"
import { requireSession } from "@/lib/system-server"
import { CatalogView } from "../_components/catalog"

export default async function CatalogPage() {
  await requireSession({ permission: StaffingPermissions.catalogManage })
  return <CatalogView />
}
