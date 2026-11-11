"use client"
// Shared pieces of the logistics pages.
import type { LogisticsPlan, Severity, Warning } from "@digimuza/staffing"
import { STAFFING_LOGISTICS_MODULE_ID } from "@digimuza/staffing/logistics/manifest"
import { STAFFING_MODULE_ID } from "@digimuza/staffing/manifest"
import { useVisibleModules } from "@digimuza/system-core/react"
import { AlertTriangle, Info, OctagonAlert } from "lucide-react"
import type { ReactNode } from "react"
import { useT } from "@/lib/i18n/client"
import type { MessageKey } from "@/lib/i18n/messages"

export function useLogisticsEnabled() {
  const mods = useVisibleModules()
  return [STAFFING_MODULE_ID, STAFFING_LOGISTICS_MODULE_ID].every((id) => mods.some((m) => m.id === id && m.effective))
}

export const logisticsHref = (projectId: string) => `/app/logistics/${projectId}`

/** Fills `{name}` placeholders. */
export const fmt = (s: string, params: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k: string) => String(params[k] ?? ""))

export const eur = (cents: number) => `${(cents / 100).toLocaleString("lt-LT", { minimumFractionDigits: 0, maximumFractionDigits: 0 })} €`

/** `11-14` style short date. */
export const shortDate = (iso: string) => iso.slice(5)

const span = (w: Warning) => (w.from && w.to && w.from !== w.to ? `${shortDate(w.from)}–${shortDate(w.to)}` : w.from ? shortDate(w.from) : "")

/** Names of workers and resources of a plan, for warning texts. */
export function planNames(p: LogisticsPlan) {
  const workers = new Map<string, string>(p.members.map((m) => [m.workerId, m.name]))
  for (const l of p.travelLegs) if (!workers.has(l.workerId)) workers.set(l.workerId, l.workerName)
  const resources = new Map<string, string>([...p.accommodations.map((a) => [a.id, a.name] as const), ...p.vehicles.map((v) => [v.id, `${v.model} ${v.plate}`.trim()] as const)])
  return { worker: (id?: string) => (id ? (workers.get(id) ?? "?") : ""), resource: (id?: string) => (id ? (resources.get(id) ?? "?") : "") }
}

export function useWarningText() {
  const { t } = useT()
  return (w: Warning, names: ReturnType<typeof planNames>) =>
    fmt(t(`logistics.w.${w.kind}` as MessageKey), { span: span(w), count: w.count ?? "", capacity: w.capacity ?? "", money: eur(w.cents ?? 0), worker: names.worker(w.workerId), resource: names.resource(w.resourceId) })
}

const SEV_STYLE: Record<Severity, string> = {
  error: "text-destructive dark:text-destructive",
  warning: "text-marking-foreground dark:text-marking dark:text-marking",
  info: "text-foreground dark:text-foreground",
}
export function SeverityIcon({ severity }: { severity: Severity }) {
  const { t } = useT()
  const Icon = severity === "error" ? OctagonAlert : severity === "warning" ? AlertTriangle : Info
  return <Icon className={`size-4 shrink-0 ${SEV_STYLE[severity]}`} aria-label={t(`logistics.sev.${severity}` as MessageKey)} />
}

/** Small count pill: red for errors, amber for warnings. */
export function CountPill({ n, tone, label }: { n: number; tone: "error" | "warning"; label: string }) {
  if (n === 0) return null
  const cls = tone === "error" ? "bg-destructive/15 text-destructive dark:bg-destructive/15 dark:text-destructive" : "bg-marking/15 text-marking-foreground dark:text-marking dark:bg-marking/15 dark:text-marking"
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium tabular-nums ${cls}`}>
      {n} {label}
    </span>
  )
}

/** Native select styled like shadcn inputs (dense tables and forms). */
export function Select({ value, onChange, children, className, id, disabled, ...rest }: { value: string; onChange: (v: string) => void; children: ReactNode; className?: string; id?: string; disabled?: boolean; "aria-label"?: string }) {
  return (
    <select
      id={id}
      disabled={disabled}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`h-8 rounded-md border border-input bg-transparent px-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-input/30 ${className ?? ""}`}
      {...rest}
    >
      {children}
    </select>
  )
}
