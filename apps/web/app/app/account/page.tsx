import { KeySquare } from "lucide-react"
import type { Metadata } from "next"
import { brand } from "@/brand"
import { PageHeader } from "@/components/app/page-header"
import { getT } from "@/lib/i18n/server"
import { requireSession } from "@/lib/system-server"
import { AccessTag, AccountWidgets, PermissionList, Section } from "./account-widgets"

export const metadata: Metadata = { title: `Paskyra · ${brand.name}` }

/**
 * Personal account. Identity, password/MFA and sessions are WorkOS's (widgets);
 * what the person may do here is system-core's, shown read-only.
 */
export default async function AccountPage() {
  const session = await requireSession()
  const { t } = await getT()
  return (
    <div className="max-w-4xl">
      <PageHeader title={t("account.title")} lead={t("account.lead")} />
      <AccountWidgets />
      <Section icon={<KeySquare />} title={t("account.access")} lead={t("account.accessLead")}>
        <dl className="mb-4 grid gap-2.5 text-sm">
          <div className="grid grid-cols-[8rem_1fr] gap-4">
            <dt className="text-muted-foreground">{t("common.email")}</dt>
            <dd>{session.actor.email}</dd>
          </div>
          {session.actor.isSuper && (
            <div className="grid grid-cols-[8rem_1fr] gap-4">
              <dt className="text-muted-foreground">{t("common.status")}</dt>
              <dd>
                <AccessTag>Super</AccessTag>
              </dd>
            </div>
          )}
        </dl>
        <PermissionList label={t("account.permissions")} permissions={session.permissions} />
      </Section>
    </div>
  )
}
