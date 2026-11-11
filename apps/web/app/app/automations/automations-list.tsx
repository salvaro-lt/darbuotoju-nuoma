"use client"
import { AutomationsPermissions, type AutomationView } from "@digimuza/system-core/automations"
import { Can, useCan, useVisibleModules } from "@digimuza/system-core/react"
import { useMutation, useQuery } from "convex/react"
import { AlertTriangle, ArrowRight, Bot, Inbox, Plus, Workflow } from "lucide-react"
import Link from "next/link"
import type { ReactNode } from "react"
import { EmptyState } from "@/components/app/empty-state"
import { PageHeader } from "@/components/app/page-header"
import { useAction } from "@/components/app/use-action"
import { MiniFlow } from "@/components/automations/flow/mini-flow"
import { ChannelIcon, convexApi as api, relativeTime, RunStatusBadge } from "@/components/automations/shared"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { CardGridSkeleton } from "@/components/app/skeletons"
import { Switch } from "@/components/ui/switch"
import { AI_CHAT_PERMISSION, AI_MODULE_ID } from "@/lib/ai/api"
import { useT } from "@/lib/i18n/client"
import { cn } from "@/lib/utils"

/** "Sukurti su AI asistentu": opens the assistant with a prefilled prompt. */
export function CreateWithAiButton({ variant = "outline" }: { variant?: "outline" | "default" }) {
  const { t } = useT()
  const aiOn = useVisibleModules().some((m) => m.id === AI_MODULE_ID && m.effective)
  const canAi = useCan(AI_CHAT_PERMISSION)
  if (!aiOn || !canAi) return null
  return (
    <Button variant={variant} asChild>
      <Link href={`/app/ai?prompt=${encodeURIComponent(t("auto.ai.prompt"))}`}>
        <Bot />
        {t("auto.ai.create")}
      </Link>
    </Button>
  )
}

export function AutomationsList() {
  const { t } = useT()
  const automations = useQuery(api.automations.listAutomations, {})
  const pending = (automations ?? []).reduce((n, a) => n + a.stats.pending, 0)
  const canReview = useCan(AutomationsPermissions.review)

  const actions = (
    <Can permission={AutomationsPermissions.manage}>
      <CreateWithAiButton />
      <Button asChild>
        <Link href="/app/automations/new">
          <Plus />
          {t("auto.new.button")}
        </Link>
      </Button>
    </Can>
  )

  return (
    <>
      <PageHeader title={t("auto.title")} lead={t("auto.lead")} actions={automations?.length ? actions : undefined} />
      {pending > 0 && canReview && (
        <Link
          href="/app/automations/review"
          className="mb-6 flex items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm transition-colors hover:bg-amber-500/10"
        >
          <Inbox className="size-4 shrink-0 text-amber-600" />
          <span className="flex-1">{t("auto.pendingCallout").replace("{n}", String(pending))}</span>
          <ArrowRight className="size-4" />
        </Link>
      )}
      {automations === undefined ? (
        <CardGridSkeleton />
      ) : automations.length === 0 ? (
        <Empty actions={actions} />
      ) : (
        <ul className="grid animate-fade-in gap-4 md:grid-cols-2 xl:grid-cols-3">
          {automations.map((a) => (
            <li key={a.id}>
              <AutomationCard a={a} />
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

function Empty({ actions }: { actions: ReactNode }) {
  const { t } = useT()
  const steps = [t("auto.empty.step1"), t("auto.empty.step2"), t("auto.empty.step3")]
  return (
    <div className="grid gap-6">
      <EmptyState icon={<Workflow />} title={t("auto.empty.title")} body={t("auto.empty.body")} action={<div className="flex flex-wrap justify-center gap-2">{actions}</div>} />
      <ol className="grid gap-3 sm:grid-cols-3">
        {steps.map((s, i) => (
          <li key={s} className="flex items-start gap-3 rounded-xl border bg-card p-4 text-sm">
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">{i + 1}</span>
            <span className="text-muted-foreground">{s}</span>
          </li>
        ))}
      </ol>
    </div>
  )
}

function AutomationCard({ a }: { a: AutomationView }) {
  const { t, locale } = useT()
  const canManage = useCan(AutomationsPermissions.manage)
  const setEnabled = useMutation(api.automations.setAutomationEnabled)
  const { run, busy } = useAction()
  const stats = [
    { label: t("auto.stats.runs"), value: a.stats.runs },
    { label: t("auto.stats.pending"), value: a.stats.pending, tone: a.stats.pending ? "text-amber-700 dark:text-amber-300" : "" },
    { label: t("auto.stats.inserted"), value: a.stats.inserted },
    { label: t("auto.stats.failed"), value: a.stats.failed, tone: a.stats.failed ? "text-destructive" : "" },
  ]
  return (
    <article className={cn("group relative flex h-full flex-col gap-4 rounded-xl border bg-card p-4 shadow-xs transition-shadow hover:shadow-sm", !a.enabled && "bg-muted/30")}>
      <header className="flex items-start gap-3">
        <ChannelIcon channel={a.trigger.channel} />
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-semibold">
            <Link href={`/app/automations/${a.id}`} className="after:absolute after:inset-0 focus-visible:outline-none">
              {a.name}
            </Link>
          </h2>
          <p className="truncate text-xs text-muted-foreground">
            {a.trigger.channel === "email" ? (a.inboundAddress ?? t("auto.channel.email")) : t("auto.channel.webhook")}
          </p>
        </div>
        <Switch
          className="relative z-10"
          aria-label={a.enabled ? t("auto.disable") : t("auto.enable")}
          checked={a.enabled}
          disabled={!canManage || busy}
          onCheckedChange={(v) => void run(() => setEnabled({ automationId: a.id, enabled: v }), { success: v ? t("auto.enabled") : t("auto.disabledToast") })}
        />
      </header>
      <MiniFlow automation={a} />
      <div className="flex flex-wrap gap-1.5">
        <Badge variant={a.enabled ? "default" : "outline"}>{a.enabled ? t("auto.on") : t("auto.off")}</Badge>
        <Badge variant="secondary">{t(a.mode === "auto" ? "auto.mode.auto" : "auto.mode.review")}</Badge>
        <Badge variant="outline">v{a.version}</Badge>
        {a.problems.length > 0 && (
          <Badge variant="destructive">
            <AlertTriangle />
            {t("auto.card.problems")}
          </Badge>
        )}
      </div>
      <dl className="mt-auto grid grid-cols-4 gap-2 border-t pt-3">
        {stats.map((s) => (
          <div key={s.label} className="min-w-0">
            <dt className="truncate text-[11px] text-muted-foreground">{s.label}</dt>
            <dd className={cn("text-base font-semibold tabular-nums", s.tone)}>{s.value}</dd>
          </div>
        ))}
      </dl>
      <footer className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>{a.lastRunAt ? t("auto.card.lastRun").replace("{when}", relativeTime(a.lastRunAt, locale)) : t("auto.card.noRuns")}</span>
        {a.lastRunStatus && <RunStatusBadge status={a.lastRunStatus} />}
      </footer>
    </article>
  )
}
