import { AutomationsPermissions } from "@digimuza/system-core/automations"
import { requireSession } from "@/lib/system-server"
import { AutomationsList } from "./automations-list"

export default async function AutomationsPage() {
  await requireSession({ permission: AutomationsPermissions.read })
  return <AutomationsList />
}
