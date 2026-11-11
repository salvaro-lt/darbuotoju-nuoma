"use client"
// A small read-only preview of the diagram for the automations list: one icon per
// step, the last step coloured by the latest run. Plain markup (no React Flow).
import type { AutomationRunStatus, AutomationView } from "@digimuza/system-core/automations"
import { CheckCheck, ChevronRight, Inbox, Mail, Sparkles, SquarePlus, Webhook } from "lucide-react"
import { Fragment } from "react"
import { useT } from "@/lib/i18n/client"
import { cn } from "@/lib/utils"
import { targetLabel } from "../shared"

const LAST_TONE: Partial<Record<AutomationRunStatus, string>> = {
  inserted: "border-emerald-500/50 text-emerald-700 dark:text-emerald-300",
  failed: "border-destructive/60 text-destructive",
  pending_review: "border-amber-500/50 text-amber-700 dark:text-amber-300",
}

export function MiniFlow({ automation: a, className }: { automation: Pick<AutomationView, "trigger" | "extract" | "actions" | "mode" | "lastRunStatus">; className?: string }) {
  const { t } = useT()
  const steps = [
    { key: "channel", Icon: a.trigger.channel === "email" ? Mail : Webhook, label: a.trigger.channel === "email" ? t("auto.channel.email") : t("auto.channel.webhook") },
    { key: "extract", Icon: Sparkles, label: t("auto.flow.fieldsN").replace("{n}", String(a.extract.fields.length)) },
    ...a.actions.map((x, i) => ({ key: `action-${i}`, Icon: SquarePlus, label: targetLabel(t, x.targetId) })),
    { key: "result", Icon: a.mode === "auto" ? CheckCheck : Inbox, label: t(a.mode === "auto" ? "auto.mode.auto" : "auto.mode.review") },
  ]
  return (
    <ol className={cn("flex min-w-0 items-center gap-1", className)} aria-label={t("auto.flow.mini").replace("{steps}", steps.map((s) => s.label).join(" → "))}>
      {steps.map(({ key, Icon, label }, i) => (
        <Fragment key={key}>
          {i > 0 && (
            <li aria-hidden className="shrink-0">
              <ChevronRight className="size-3 text-muted-foreground/60" />
            </li>
          )}
          <li
            title={label}
            className={cn(
              "flex min-w-0 items-center gap-1 rounded-md border bg-background px-1.5 py-1 text-[11px] text-muted-foreground",
              key === "result" && a.lastRunStatus && LAST_TONE[a.lastRunStatus],
              key.startsWith("action") && "min-w-0 flex-1 text-foreground",
            )}
          >
            <Icon aria-hidden className="size-3.5 shrink-0 text-primary" />
            {key.startsWith("action") && <span className="truncate">{label}</span>}
          </li>
        </Fragment>
      ))}
    </ol>
  )
}
