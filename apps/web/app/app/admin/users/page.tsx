import { SystemPermissions } from "@digimuza/system-core/modules"
import { requireSession } from "@/lib/system-server"
import { UsersView } from "./users-view"

export default async function UsersPage() {
  await requireSession({ permission: SystemPermissions.usersRead })
  return <UsersView />
}
