import { DocumentsPermissions } from "@digimuza/documents/manifest"
import { requireSession } from "@/lib/system-server"
import { SubmissionDetailView } from "../_components/submission-detail"

export default async function SubmissionPage({ params }: { params: Promise<{ id: string }> }) {
  await requireSession({ permission: DocumentsPermissions.signingRead })
  const { id } = await params
  return <SubmissionDetailView submissionId={id} />
}
