"use client"
// Small pieces shared by the automations pages.
import { AUTOMATIONS_MODULE_ID, type AutomationChannel, type AutomationRunStatus } from "@digimuza/system-core/automations"
import { useVisibleModules } from "@digimuza/system-core/react"
import { Check, Copy, Mail, Webhook } from "lucide-react"
import { createContext, useContext, useState, useSyncExternalStore, type ReactNode } from "react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useT } from "@/lib/i18n/client"
import type { Locale, MessageKey } from "@/lib/i18n/messages"
import { cn } from "@/lib/utils"

export { api as convexApi } from "@/convex/_generated/api"

export function useAutomationsEnabled() {
  return useVisibleModules().some((m) => m.id === AUTOMATIONS_MODULE_ID && m.effective)
}

/** Public origin (webhook URLs, form snippets). Set by app/app/automations/layout.tsx. */
const SiteUrl = createContext<string>("")
export const AutomationsSiteUrlProvider = ({ siteUrl, children }: { siteUrl: string; children: ReactNode }) => <SiteUrl.Provider value={siteUrl.replace(/\/+$/, "")}>{children}</SiteUrl.Provider>
export const useSiteUrl = () => useContext(SiteUrl)

export function ChannelIcon({ channel, className }: { channel: AutomationChannel; className?: string }) {
  const Icon = channel === "email" ? Mail : Webhook
  return (
    <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg border bg-background text-primary shadow-xs", className)}>
      <Icon className="size-4" aria-hidden />
    </span>
  )
}

const STATUS_VARIANT: Record<AutomationRunStatus, "default" | "secondary" | "outline" | "destructive"> = {
  queued: "secondary",
  extracted: "secondary",
  pending_review: "outline",
  inserted: "default",
  rejected: "outline",
  failed: "destructive",
}

export function RunStatusBadge({ status }: { status: AutomationRunStatus }) {
  const { t } = useT()
  return (
    <Badge variant={STATUS_VARIANT[status]} className={cn(status === "pending_review" && "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300")}>
      {status === "queued" && <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-current motion-reduce:animate-none" />}
      {t(`auto.status.${status}` as MessageKey)}
    </Badge>
  )
}

export function CopyButton({ value, label, className, variant = "outline" }: { value: string; label?: string; className?: string; variant?: "outline" | "ghost" | "default" }) {
  const { t } = useT()
  const [done, setDone] = useState(false)
  return (
    <Button
      type="button"
      size={label ? "sm" : "icon-sm"}
      variant={variant}
      className={className}
      aria-label={label ?? t("common.copy")}
      onClick={async () => {
        await navigator.clipboard.writeText(value)
        setDone(true)
        toast.success(t("common.copied"))
        setTimeout(() => setDone(false), 1500)
      }}
    >
      {done ? <Check /> : <Copy />}
      {label}
    </Button>
  )
}

/** A copyable value on one line (URL, address). */
export function CopyField({ value, mono = true }: { value: string; mono?: boolean }) {
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-lg border bg-muted/40 py-1 pr-1 pl-3">
      <code className={cn("min-w-0 flex-1 truncate text-[13px]", !mono && "font-sans")} title={value}>
        {value}
      </code>
      <CopyButton value={value} variant="ghost" />
    </div>
  )
}

/** A copyable block of code (form snippet, curl). */
export function CodeBlock({ code, label }: { code: string; label: string }) {
  return (
    <div className="relative overflow-hidden rounded-lg border bg-muted/40">
      <div className="flex items-center justify-between border-b px-3 py-1.5">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <CopyButton value={code} variant="ghost" />
      </div>
      <pre className="max-h-72 overflow-auto p-3 text-[12px] leading-relaxed">
        <code>{code}</code>
      </pre>
    </div>
  )
}

const tag = (l: Locale) => (l === "lt" ? "lt-LT" : "en-GB")

/** "prieš 5 min." / "5 min ago". */
export function relativeTime(ms: number, locale: Locale, now = Date.now()): string {
  const s = Math.round((ms - now) / 1000)
  const rtf = new Intl.RelativeTimeFormat(tag(locale), { numeric: "auto", style: "short" })
  const abs = Math.abs(s)
  if (abs < 60) return rtf.format(s, "second")
  if (abs < 3600) return rtf.format(Math.round(s / 60), "minute")
  if (abs < 86400) return rtf.format(Math.round(s / 3600), "hour")
  if (abs < 86400 * 30) return rtf.format(Math.round(s / 86400), "day")
  return new Intl.DateTimeFormat(tag(locale), { dateStyle: "medium" }).format(ms)
}

export const dateTime = (ms: number, locale: Locale) => new Intl.DateTimeFormat(tag(locale), { dateStyle: "medium", timeStyle: "short" }).format(ms)

/** Readable value of an extracted field. */
export function showValue(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—"
  if (Array.isArray(v)) return v.join(", ")
  if (typeof v === "object") return JSON.stringify(v)
  return String(v)
}

/** Field paths in validation messages → the label part before ":". */
export const problemsFor = (problems: readonly string[], prefix: string) => problems.filter((p) => p.startsWith(prefix))

export function Problems({ errors = [], warnings = [] }: { errors?: readonly string[]; warnings?: readonly string[] }) {
  const { t } = useT()
  if (!errors.length && !warnings.length) return null
  return (
    <div className="grid gap-2 text-sm">
      {errors.length > 0 && (
        <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-destructive">
          <p className="font-medium">{t("auto.problems.errors")}</p>
          <ul className="mt-1 list-disc pl-5 text-[13px]">
            {errors.map((e) => (
              <li key={e} className="break-words">
                {e}
              </li>
            ))}
          </ul>
        </div>
      )}
      {warnings.length > 0 && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-amber-800 dark:text-amber-200">
          <p className="font-medium">{t("auto.problems.warnings")}</p>
          <ul className="mt-1 list-disc pl-5 text-[13px]">
            {warnings.map((w) => (
              <li key={w} className="break-words">
                {w}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

/** The app's name for a target (`auto.target.<id>` in the messages), else its id. */
export const targetLabel = (t: (k: MessageKey) => string, id: string) => t(`auto.target.${id}` as MessageKey) || id

const desktopQuery = "(min-width: 1024px)"
const subscribeDesktop = (cb: () => void) => {
  const m = window.matchMedia(desktopQuery)
  m.addEventListener("change", cb)
  return () => m.removeEventListener("change", cb)
}
/** Whether the viewport is lg+ (false during SSR). */
export function useIsDesktop() {
  return useSyncExternalStore(subscribeDesktop, () => window.matchMedia(desktopQuery).matches, () => false)
}
