import { AutomationsPermissions } from "@digimuza/system-core/automations"
import { PageHeader } from "@/components/app/page-header"
import { RunsList } from "@/components/automations/runs"
import { getT } from "@/lib/i18n/server"
import { requireSession } from "@/lib/system-server"

export default async function RunsPage() {
  await requireSession({ permission: AutomationsPermissions.read })
  const { t } = await getT()
  return (
    <>
      <PageHeader title={t("auto.runs.title")} lead={t("auto.runs.lead")} />
      <RunsList />
    </>
  )
}
