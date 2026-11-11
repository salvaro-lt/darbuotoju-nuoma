import { DocumentsPermissions } from "@digimuza/documents/manifest"
import { requireSession } from "@/lib/system-server"
import { TemplatesList } from "./_components/templates-list"

export default async function TemplatesPage() {
  await requireSession({ permission: DocumentsPermissions.signingRead })
  return <TemplatesList />
}
