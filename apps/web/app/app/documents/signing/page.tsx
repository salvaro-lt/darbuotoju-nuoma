import { DocumentsPermissions } from "@digimuza/documents/manifest"
import { requireSession } from "@/lib/system-server"
import { SubmissionsList } from "./_components/submissions-list"

export default async function SigningPage() {
  await requireSession({ permission: DocumentsPermissions.signingRead })
  return <SubmissionsList />
}
