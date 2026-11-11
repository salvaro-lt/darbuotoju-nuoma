import { DocumentsPermissions } from "@digimuza/documents/manifest"
import { requireSession } from "@/lib/system-server"
import { LabelsSettings } from "../_components/labels-settings"

export default async function DocumentLabelsPage() {
  await requireSession({ permission: DocumentsPermissions.manageLabels })
  return <LabelsSettings />
}
