"use client"
import type { MatchWarning, RequestStatus } from "@digimuza/staffing/teams/matching"
import { Badge } from "@/components/ui/badge"
import { useT } from "@/lib/i18n/client"
import type { MessageKey } from "@/lib/i18n/messages"

const STATUS_VARIANT: Record<RequestStatus, "default" | "secondary" | "outline"> = { open: "default", proposed: "secondary", confirmed: "outline", cancelled: "outline" }

export function RequestStatusBadge({ status }: { status: RequestStatus }) {
  const { t } = useT()
  return <Badge variant={STATUS_VARIANT[status]}>{t(`teams.status.${status}` as MessageKey)}</Badge>
}

/** "3 / 4" with a colour cue: complete, partial. */
export function TeamCount({ picked, needed }: { picked: number; needed: number }) {
  const full = picked >= needed
  return (
    <span className={`tabular-nums font-medium ${full ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400"}`}>
      {picked} / {needed}
    </span>
  )
}

const SEVERE = new Set(["cert_missing", "cert_expired", "level_below"])
const MILD = new Set(["subcontractor", "sizes_unknown", "no_common_language", "cert_expiring_soon"])

/** One matching warning, with the certificate name and date when it has them. */
export function WarningBadge({ w, certificateNames }: { w: MatchWarning; certificateNames: Record<string, string> }) {
  const { t } = useT()
  const cert = w.certificateTypeId ? certificateNames[w.certificateTypeId] : null
  const text = `${t(`teams.warn.${w.code}` as MessageKey)}${cert ? `: ${cert}` : ""}${w.date ? ` (${w.date})` : ""}`
  const tone = SEVERE.has(w.code)
    ? "border-red-300 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300"
    : MILD.has(w.code)
      ? "text-muted-foreground"
      : "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-300"
  return (
    <Badge variant="outline" className={`font-normal ${tone}`}>
      {text}
    </Badge>
  )
}
