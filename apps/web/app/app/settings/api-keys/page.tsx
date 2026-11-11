import { SystemPermissions } from "@digimuza/system-core/modules"
import { requireSession } from "@/lib/system-server"
import { ApiKeysView } from "./api-keys-view"

export default async function ApiKeysPage() {
  await requireSession({ permission: SystemPermissions.ownKeysRead })
  return <ApiKeysView />
}
