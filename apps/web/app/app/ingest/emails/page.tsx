import { IngestPermissions } from "@digimuza/system-core/ingest"
import { PageHeader } from "@/components/app/page-header"
import { EmailList } from "@/components/ingest/emails"
import { getT } from "@/lib/i18n/server"
import { requireSession } from "@/lib/system-server"

export default async function Page() {
  await requireSession({ permission: IngestPermissions.read })
  const { t } = await getT()
  return (
    <>
      <PageHeader title={t("ingest.emails.title")} lead={t("ingest.emails.lead")} />
      <div className="grid gap-4">
        <EmailList showInbox />
      </div>
    </>
  )
}
