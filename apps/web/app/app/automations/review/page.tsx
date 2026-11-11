import { AutomationsPermissions } from "@digimuza/system-core/automations"
import { PageHeader } from "@/components/app/page-header"
import { ReviewQueue } from "@/components/automations/review"
import { getT } from "@/lib/i18n/server"
import { requireSession } from "@/lib/system-server"

export default async function ReviewPage() {
  await requireSession({ permission: AutomationsPermissions.read })
  const { t } = await getT()
  return (
    <>
      <PageHeader title={t("auto.review.title")} lead={t("auto.review.lead")} />
      <ReviewQueue />
    </>
  )
}
