import { SystemPermissions } from "@digimuza/system-core/modules"
import { requireSession } from "@/lib/system-server"
import { InvitesView } from "./invites-view"

export default async function InvitesPage() {
  await requireSession({ permission: SystemPermissions.invitesRead })
  return <InvitesView />
}
