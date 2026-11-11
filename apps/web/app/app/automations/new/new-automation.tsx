"use client"
import { ArrowLeft } from "lucide-react"
import Link from "next/link"
import { PageHeader } from "@/components/app/page-header"
import { AutomationBuilder, emptyDraft } from "@/components/automations/builder"
import { useT } from "@/lib/i18n/client"

export function NewAutomation() {
  const { t } = useT()
  return (
    <>
      <Link href="/app/automations" className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" />
        {t("auto.nav.list")}
      </Link>
      <PageHeader title={t("auto.new.title")} lead={t("auto.new.lead")} />
      <AutomationBuilder initial={emptyDraft()} />
    </>
  )
}
