import { DocumentsPermissions } from "@digimuza/documents/manifest"
import { requireSession } from "@/lib/system-server"
import { TemplateBuilder } from "../_components/template-builder"

export default async function TemplateBuilderPage({ params }: { params: Promise<{ id: string }> }) {
  await requireSession({ permission: DocumentsPermissions.signingRead })
  const { id } = await params
  return <TemplateBuilder templateId={id} />
}
