import { CrmPermissions } from "@digimuza/crm/manifest"
import { requireSession } from "@/lib/system-server"
import { ObjectSettings } from "../../_components/object-settings"

export default async function CrmObjectSettingsPage({ params }: { params: Promise<{ object: string }> }) {
  await requireSession({ permission: CrmPermissions.manageSchema })
  const { object } = await params
  return <ObjectSettings objectKey={object} />
}
