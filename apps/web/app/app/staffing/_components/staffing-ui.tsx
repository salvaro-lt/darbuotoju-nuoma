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

const CERT_VARIANT: Record<CertificateStatus, "secondary" | "outline" | "destructive" | "default"> = {
  valid: "secondary",
  expiring60: "outline",
  expiring30: "outline",
  expired: "destructive",
  missing: "destructive",
}
const CERT_DOT: Record<CertificateStatus, string> = {
  valid: "bg-emerald-500",
  expiring60: "bg-amber-400",
  expiring30: "bg-orange-500",
  expired: "bg-red-600",
  missing: "bg-red-600",
}

export function CertBadge({ status }: { status: CertificateStatus }) {
  const { t } = useT()
  return (
    <Badge variant={CERT_VARIANT[status]}>
      <span className={`size-1.5 rounded-full ${CERT_DOT[status]}`} aria-hidden />
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
      className={`h-9 rounded-md border border-input bg-transparent px-2.5 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30 ${className ?? ""}`}
      {...rest}
    >
      {children}
    </select>
  )
}

export const centsToEur = (c: number) => (c / 100).toFixed(2)
export const eurToCents = (s: string) => Math.round(Number(s.replace(",", ".")) * 100)
