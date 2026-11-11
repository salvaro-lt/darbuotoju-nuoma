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
    <span className={`tabular-nums font-medium ${full ? "text-steel-green dark:text-steel-green" : "text-marking-foreground dark:text-marking dark:text-marking"}`}>
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
    ? "border-destructive/60 bg-destructive/15 text-destructive dark:border-destructive/60 dark:bg-destructive/20 dark:text-destructive"
    : MILD.has(w.code)
      ? "text-muted-foreground"
      : "border-marking-foreground/50 bg-marking/15 text-marking-foreground dark:text-marking dark:border-marking-foreground/50 dark:bg-marking/20 dark:text-marking"
  return (
    <Badge variant="outline" className={`h-auto font-normal whitespace-normal ${tone}`}>
      {text}
    </Badge>
  )
}
