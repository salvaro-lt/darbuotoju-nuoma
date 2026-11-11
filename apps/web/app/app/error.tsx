"use client"
import { systemErrorOf } from "@digimuza/system-core/react"
import { CircleAlert, Lock } from "lucide-react"
import Link from "next/link"
import { EmptyState } from "@/components/app/empty-state"
import { Button } from "@/components/ui/button"
import { useT } from "@/lib/i18n/client"

/**
 * Convex queries are live: when a permission or session is revoked, an open
 * query starts failing and `useQuery` throws. This turns that into a message
 * with the operation ID instead of a crashed page.
 */
export default function AppError({ error, reset }: { error: Error; reset: () => void }) {
  const { t } = useT()
  const se = systemErrorOf(error)
  const signedOut = se?.code === "UNAUTHENTICATED"
  const title = signedOut ? t("error.page.session") : se?.code === "FORBIDDEN" ? t("error.page.forbidden") : t("error.page.title")
  return (
    <div className="pt-12">
      <EmptyState
        icon={signedOut ? <Lock /> : <CircleAlert />}
        title={title}
        body={`${t("error.page.body")}${se?.operationId ? ` ${t("state.operation")} ${se.operationId}` : ""}`}
        action={
          signedOut ? (
            <Button asChild>
              <a href="/login">{t("signIn.title")}</a>
            </Button>
          ) : (
            <div className="flex gap-2">
              <Button onClick={reset}>{t("common.retry")}</Button>
              <Button asChild variant="ghost">
                <Link href="/app">{t("common.home")}</Link>
              </Button>
            </div>
          )
        }
      />
    </div>
  )
}
