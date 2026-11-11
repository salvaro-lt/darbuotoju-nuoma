import { AutomationsPermissions } from "@digimuza/system-core/automations"
import { requireSession } from "@/lib/system-server"
import { AutomationDetail } from "./automation-detail"

export default async function AutomationPage({ params }: { params: Promise<{ id: string }> }) {
  await requireSession({ permission: AutomationsPermissions.read })
  const { id } = await params
  return <AutomationDetail id={id} />
}
