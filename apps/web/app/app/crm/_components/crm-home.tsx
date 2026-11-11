"use client"
import { CrmPermissions } from "@digimuza/crm/manifest"
import { useCan } from "@digimuza/system-core/react"
import { useMutation } from "convex/react"
import { Database } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect } from "react"
import { EmptyState } from "@/components/app/empty-state"
import { useAction } from "@/components/app/use-action"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { api } from "@/convex/_generated/api"
import { useT } from "@/lib/i18n/client"
import { useCrmSchema } from "./use-crm"

/** /app/crm opens the first object. With no objects yet, schema managers can install the standard model. */
export function CrmHome() {
  const { t } = useT()
  const router = useRouter()
  const { enabled, objects } = useCrmSchema()
  const canSchema = useCan(CrmPermissions.manageSchema)
  const install = useMutation(api.crm.applyBlueprint)
  const { run, busy } = useAction()
  const first = objects?.[0]

  useEffect(() => {
    if (first) router.replace(`/app/crm/${first.key}`)
  }, [first, router])

  if (!enabled) return <p className="text-sm text-muted-foreground">{t("crm.disabled")}</p>
  if (objects === undefined || first) return <Skeleton className="h-80 w-full rounded-xl" />
  return (
    <EmptyState
      icon={<Database />}
      title={t("crm.empty.title")}
      body={canSchema ? t("crm.empty.body") : t("crm.empty.reader")}
      action={
        canSchema ? (
          <div className="flex flex-wrap justify-center gap-2">
            <Button disabled={busy} onClick={() => void run(() => install({}), { success: t("crm.installed") })}>
              {t("crm.empty.install")}
            </Button>
            <Button variant="outline" asChild>
              <Link href="/app/crm/settings">{t("crm.empty.settings")}</Link>
            </Button>
          </div>
        ) : undefined
      }
    />
  )
}
