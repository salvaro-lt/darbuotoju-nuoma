import { StaffingTeamsPermissions } from "@digimuza/staffing/teams/manifest"
import { requireSession } from "@/lib/system-server"
import { TeamProposal } from "../_components/team-proposal"

export default async function TeamRequestPage({ params }: { params: Promise<{ id: string }> }) {
  await requireSession({ permission: StaffingTeamsPermissions.requestRead })
  const { id } = await params
  return <TeamProposal requestId={id} />
}
