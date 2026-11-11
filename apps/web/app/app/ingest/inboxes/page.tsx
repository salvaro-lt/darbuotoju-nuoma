import { IngestPermissions } from "@digimuza/system-core/ingest"
import { InboxesPage } from "@/components/ingest/inboxes"
import { requireSession } from "@/lib/system-server"

export default async function Page() {
  await requireSession({ permission: IngestPermissions.read })
  return <InboxesPage />
}
