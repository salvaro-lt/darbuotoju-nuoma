import { IngestPermissions } from "@digimuza/system-core/ingest"
import { IntegrationPage } from "@/components/ingest/integration"
import { requireSession } from "@/lib/system-server"

export default async function IngestPage() {
  await requireSession({ permission: IngestPermissions.read })
  return <IntegrationPage />
}
