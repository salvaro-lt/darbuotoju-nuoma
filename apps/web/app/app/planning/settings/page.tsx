import { StaffingPlanningPermissions } from "@digimuza/staffing/planning/manifest"
import { requireSession } from "@/lib/system-server"
import { PlanningSettings } from "../_components/settings"

export default async function PlanningSettingsPage() {
  await requireSession({ permission: StaffingPlanningPermissions.boardRead })
  return <PlanningSettings />
}
