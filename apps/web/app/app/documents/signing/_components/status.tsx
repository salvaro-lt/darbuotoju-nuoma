"use client"
import type { SubmissionStatus, SubmitterStatus } from "@digimuza/documents/signing"
import { StatusBadge, type StatusTone } from "@/components/app/status-badge"
import { useT } from "@/lib/i18n/client"
import type { MessageKey } from "@/lib/i18n/messages"
import { cn } from "@/lib/utils"

const SUBMISSION_TONE: Record<SubmissionStatus, StatusTone> = { pending: "neutral", completed: "positive", declined: "failed", cancelled: "ended", expired: "ended" }

export function SubmissionBadge({ status }: { status: SubmissionStatus }) {
  const { t } = useT()
  return <StatusBadge tone={SUBMISSION_TONE[status]}>{t(`sign.status.${status}` as MessageKey)}</StatusBadge>
}

const DOT: Record<SubmitterStatus, string> = {
  waiting: "border border-muted-foreground/50 bg-transparent",
  pending: "bg-muted-foreground/45",
  opened: "bg-[oklch(0.62_0.14_250)]",
  completed: "bg-primary",
  declined: "bg-destructive",
}

/** One signer's state as a dot; the label goes to assistive tech and the tooltip. */
export function SignerDot({ status, className }: { status: SubmitterStatus; className?: string }) {
  const { t } = useT()
  const label = t(`sign.signer.${status}` as MessageKey)
  return <span role="img" aria-label={label} title={label} className={cn("inline-block size-2 shrink-0 rounded-full", DOT[status], className)} />
}
