"use client"
// Small pieces shared by the Gavimas (ingest) pages.
import { INGEST_MODULE_ID, type IngestHealth } from "@digimuza/system-core/ingest"
import { useVisibleModules } from "@digimuza/system-core/react"
import { CheckCircle2, CircleAlert, CircleDashed, Loader2 } from "lucide-react"
import type { ReactNode } from "react"
import { Badge } from "@/components/ui/badge"
import { useT } from "@/lib/i18n/client"
import { cn } from "@/lib/utils"

export { api as convexApi } from "@/convex/_generated/api"
export { CopyButton, CopyField, dateTime, relativeTime } from "@/components/automations/shared"

export function useIngestEnabled() {
  return useVisibleModules().some((m) => m.id === INGEST_MODULE_ID && m.effective)
}

/** Renders the page only while the module is on (it can be turned off live). */
export function IngestGate({ children }: { children: ReactNode }) {
  const { t } = useT()
  if (!useIngestEnabled()) return <p className="text-sm text-muted-foreground">{t("ingest.disabled")}</p>
  return <>{children}</>
}

export function HealthBadge({ health }: { health: IngestHealth }) {
  const { t } = useT()
  return (
    <Badge
      variant={health === "ok" ? "default" : "outline"}
      className={cn("gap-1.5", health === "attention" && "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300")}
    >
      <span aria-hidden className={cn("size-1.5 rounded-full bg-current", health === "off" && "opacity-50")} />
      {t(`ingest.health.${health}`)}
    </Badge>
  )
}

/** One line of a checklist: done, needs attention, waiting or not known yet. */
export function StatusLine({ state, children, className }: { state: "ok" | "warn" | "wait" | "idle"; children: ReactNode; className?: string }) {
  const Icon = state === "ok" ? CheckCircle2 : state === "warn" ? CircleAlert : state === "wait" ? Loader2 : CircleDashed
  return (
    <p className={cn("flex items-start gap-2 text-sm", className)}>
      <Icon
        aria-hidden
        className={cn(
          "mt-0.5 size-4 shrink-0",
          state === "ok" && "text-primary",
          state === "warn" && "text-amber-600",
          state === "wait" && "animate-spin text-muted-foreground motion-reduce:animate-none",
          state === "idle" && "text-muted-foreground",
        )}
      />
      <span className={cn("min-w-0 break-words", state === "ok" && "text-muted-foreground")}>{children}</span>
    </p>
  )
}

/** A titled block inside a card. */
export function Panel({ icon, title, children, className, actions }: { icon: ReactNode; title: string; children: ReactNode; className?: string; actions?: ReactNode }) {
  return (
    <section className={cn("grid content-start gap-3 rounded-xl border bg-card p-4 shadow-xs sm:p-5", className)}>
      <header className="flex items-center gap-2.5">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary [&>svg]:size-4">{icon}</span>
        <h2 className="min-w-0 flex-1 text-sm font-semibold">{title}</h2>
        {actions}
      </header>
      {children}
    </section>
  )
}

export const fill = (s: string, vars: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? `{${k}}`))
