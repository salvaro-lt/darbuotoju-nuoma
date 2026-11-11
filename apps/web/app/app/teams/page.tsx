import { StaffingTeamsPermissions } from "@digimuza/staffing/teams/manifest"
import { requireSession } from "@/lib/system-server"
import { RequestsList } from "./_components/requests-list"

export default async function TeamsPage() {
  await requireSession({ permission: StaffingTeamsPermissions.requestRead })
  return <RequestsList />
}
