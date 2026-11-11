"use client"
// Shared pieces of the staffing pages. Staffing areas may import these too.
import { StaffingPermissions, STAFFING_MODULE_ID } from "@digimuza/staffing/manifest"
import type { AssignmentStatus, CertificateStatus, ProjectStatus } from "@digimuza/staffing/pure"
import { useCan, useVisibleModules } from "@digimuza/system-core/react"
import { useQuery } from "convex/react"
import type { ReactNode } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { api } from "@/convex/_generated/api"
import { useT } from "@/lib/i18n/client"
import type { MessageKey } from "@/lib/i18n/messages"

export function useStaffingEnabled() {
  return useVisibleModules().some((m) => m.id === STAFFING_MODULE_ID && m.effective)
}

/** Trades catalog; `undefined` while loading or when not readable. */
export function useTrades() {
  const on = useStaffingEnabled()
  const can = useCan(StaffingPermissions.workerRead)
  return useQuery(api.staffing.listTrades, on && can ? {} : "skip")
}

export function useCertificateTypes() {
  const on = useStaffingEnabled()
  const can = useCan(StaffingPermissions.workerRead)
  return useQuery(api.staffing.listCertificateTypes, on && can ? {} : "skip")
}

export const workerHref = (id: string) => `/app/staffing/workers/${id}`
export const projectHref = (id: string) => `/app/staffing/projects/${id}`

/** Trade name in the UI language. */
export function useTradeName() {
  const { locale } = useT()
  return (t: { nameLt: string; nameEn: string }) => (locale === "en" ? t.nameEn : t.nameLt)
}

/*
 * Certificate state as paint marks: form carries the state, colour confirms it
 * (readable in greyscale and for colour-blind users).
 *   valid      solid steel-green bar
 *   expiring60 dashed marking-yellow frame
 *   expiring30 solid marking-yellow plate
 *   expired    struck through, red oxide
 *   missing    hollow frame, red oxide
 */
const CERT_CLASS: Record<CertificateStatus, string> = {
  valid: "border-transparent bg-steel-green/15 text-foreground",
  expiring60: "border-dashed border-marking-foreground/70 bg-marking/25 text-marking-foreground dark:text-marking",
  expiring30: "border-transparent bg-marking text-marking-foreground",
  expired: "border-transparent bg-destructive/12 text-destructive line-through decoration-2",
  missing: "border-destructive/80 bg-transparent text-destructive",
}
const CERT_MARK: Record<CertificateStatus, string> = {
  valid: "h-2.5 w-[3px] bg-steel-green",
  expiring60: "h-2.5 w-[3px] border-l-[3px] border-dotted border-marking-foreground/80",
  expiring30: "h-2.5 w-[3px] bg-marking-foreground",
  expired: "h-[3px] w-2.5 bg-destructive",
  missing: "size-2 border-[1.5px] border-destructive",
}

export function CertBadge({ status }: { status: CertificateStatus }) {
  const { t } = useT()
  return (
    <Badge variant="outline" className={CERT_CLASS[status]}>
      <span className={`shrink-0 ${CERT_MARK[status]}`} aria-hidden />
      {t(`staffing.cert.${status}` as MessageKey)}
    </Badge>
  )
}

const PROJECT_VARIANT: Record<ProjectStatus, "default" | "secondary" | "outline"> = { draft: "secondary", active: "default", finished: "outline", cancelled: "outline" }
export function ProjectStatusBadge({ status }: { status: ProjectStatus }) {
  const { t } = useT()
  return <Badge variant={PROJECT_VARIANT[status]}>{t(`staffing.projectStatus.${status}` as MessageKey)}</Badge>
}

const ASSIGNMENT_VARIANT: Record<AssignmentStatus, "default" | "secondary" | "outline"> = { proposed: "outline", confirmed: "secondary", active: "default", ended: "outline", cancelled: "outline" }
export function AssignmentStatusBadge({ status }: { status: AssignmentStatus }) {
  const { t } = useT()
  return <Badge variant={ASSIGNMENT_VARIANT[status]}>{t(`staffing.assignmentStatus.${status}` as MessageKey)}</Badge>
}

export function Period({ from, to }: { from: string; to: string | null }) {
  const { t } = useT()
  return (
    <span className="tabular-nums whitespace-nowrap">
      {from} – {to ?? t("staffing.common.openEnded")}
    </span>
  )
}

export function ConfirmDelete({ open, title, body, busy, onCancel, onConfirm }: { open: boolean; title: string; body: string; busy: boolean; onCancel: () => void; onConfirm: () => void }) {
  const { t } = useT()
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{body}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            {t("staffing.common.cancel")}
          </Button>
          <Button variant="destructive" disabled={busy} onClick={onConfirm}>
            {t("staffing.common.delete")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function Disabled() {
  const { t } = useT()
  return <p className="text-sm text-muted-foreground">{t("staffing.disabled")}</p>
}

/** A label/value row for detail panels. */
export function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[10rem_1fr] gap-3 py-1.5 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  )
}

/** Native select styled like shadcn inputs: dense filters and forms with many options. */
export function NativeSelect({ value, onChange, children, className, id, required, ...rest }: { value: string; onChange: (v: string) => void; children: ReactNode; className?: string; id?: string; required?: boolean; "aria-label"?: string }) {
  return (
    <select
      id={id}
      required={required}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`h-9 rounded-md border border-input bg-card px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30 ${className ?? ""}`}
      {...rest}
    >
      {children}
    </select>
  )
}

export const centsToEur = (c: number) => (c / 100).toFixed(2)
export const eurToCents = (s: string) => Math.round(Number(s.replace(",", ".")) * 100)
