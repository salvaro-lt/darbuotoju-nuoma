import { AutomationsPermissions } from "@digimuza/system-core/automations"
import { requireSession } from "@/lib/system-server"
import { NewAutomation } from "./new-automation"

export default async function NewAutomationPage() {
  await requireSession({ permission: AutomationsPermissions.manage })
  return <NewAutomation />
}
