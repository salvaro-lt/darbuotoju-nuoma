import { Badge } from "@/components/ui/badge"

/**
 * Status shown in lists, on shadcn Badge variants only:
 * positive → default (primary), neutral/in progress → secondary,
 * ended or expired → outline, failed → destructive.
 */
export type StatusTone = "positive" | "neutral" | "ended" | "failed"

const VARIANT = { positive: "default", neutral: "secondary", ended: "outline", failed: "destructive" } as const

// Positive is steel-green (a primed, passed plate), never the red-oxide action colour.
const CLASS: Partial<Record<StatusTone, string>> = { positive: "border-transparent bg-steel-green/15 text-foreground" }

export function StatusBadge({ tone, children }: { tone: StatusTone; children: React.ReactNode }) {
  return <Badge variant={VARIANT[tone]} className={CLASS[tone]}>{children}</Badge>
}

export const TONE: Record<string, StatusTone> = {
  // invoices
  draft: "neutral",
  approved: "positive",
  // invites
  pending: "neutral",
  accepted: "positive",
  revoked: "ended",
  expired: "ended",
  // users / keys
  active: "positive",
  suspended: "failed",
  closed: "ended",
}
