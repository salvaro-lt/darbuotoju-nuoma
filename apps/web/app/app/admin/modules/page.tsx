import { SystemPermissions } from "@digimuza/system-core/modules"
import { requireSession } from "@/lib/system-server"
import { ModulesView } from "./modules-view"

export default async function ModulesPage() {
  await requireSession({ permission: SystemPermissions.modulesRead })
  return <ModulesView />
}
