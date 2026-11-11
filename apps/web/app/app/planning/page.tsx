import { StaffingPlanningPermissions } from "@digimuza/staffing/planning/manifest"
import { requireSession } from "@/lib/system-server"
import { PlanningBoard } from "./_components/board"

export default async function PlanningPage() {
  await requireSession({ permission: StaffingPlanningPermissions.boardRead })
  return <PlanningBoard />
}
