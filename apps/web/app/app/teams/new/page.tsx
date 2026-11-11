import { StaffingTeamsPermissions } from "@digimuza/staffing/teams/manifest"
import { requireSession } from "@/lib/system-server"
import { RequestForm } from "../_components/request-form"

export default async function NewTeamRequestPage() {
  await requireSession({ permission: StaffingTeamsPermissions.requestWrite })
  return <RequestForm />
}
