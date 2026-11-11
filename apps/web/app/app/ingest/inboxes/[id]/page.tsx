import { IngestPermissions } from "@digimuza/system-core/ingest"
import { InboxDetail } from "@/components/ingest/inboxes"
import { requireSession } from "@/lib/system-server"

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  await requireSession({ permission: IngestPermissions.read })
  const { id } = await params
  return <InboxDetail inboxId={id} />
}
