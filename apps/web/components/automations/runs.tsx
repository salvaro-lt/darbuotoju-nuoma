"use client"
// Run history ("Istorija") and one run's detail with the raw event.
import { RUN_STATUSES, type AutomationRunStatus, type EventView, type RunView } from "@digimuza/system-core/automations"
import { useQuery } from "convex/react"
import { History, Paperclip } from "lucide-react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useState } from "react"
import { EmptyState } from "@/components/app/empty-state"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { StackSkeleton } from "@/components/app/skeletons"
import { Skeleton } from "@/components/ui/skeleton"
import { useT } from "@/lib/i18n/client"
import type { MessageKey } from "@/lib/i18n/messages"
import { ChannelIcon, convexApi as api, dateTime, relativeTime, RunStatusBadge, showValue, targetLabel } from "./shared"

const ALL = "all"

export function RunsList({ automationId, compact = false }: { automationId?: string; compact?: boolean }) {
  const { t, locale } = useT()
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const [status, setStatus] = useState<AutomationRunStatus | typeof ALL>(ALL)
  const [filterAutomation, setFilterAutomation] = useState<string>(automationId ?? ALL)
  const [limit, setLimit] = useState(30)
  const automations = useQuery(api.automations.listAutomations, automationId ? "skip" : {})
  const page = useQuery(api.automations.listRuns, {
    ...(filterAutomation !== ALL ? { automationId: filterAutomation } : {}),
    ...(status !== ALL ? { status } : {}),
    limit,
  })
  const open = params.get("run")
  const setOpen = (id: string | null) => {
    const next = new URLSearchParams(params)
    if (id) next.set("run", id)
    else next.delete("run")
    router.replace(`${pathname}${next.size ? `?${next}` : ""}`, { scroll: false })
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap gap-2">
        {!automationId && (
          <Select value={filterAutomation} onValueChange={setFilterAutomation}>
            <SelectTrigger aria-label={t("auto.runs.filterAutomation")} className="w-full sm:w-64">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t("auto.runs.allAutomations")}</SelectItem>
              {(automations ?? []).map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Select value={status} onValueChange={(v) => setStatus(v as AutomationRunStatus | typeof ALL)}>
          <SelectTrigger aria-label={t("common.status")} className="w-full sm:w-52">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t("auto.runs.allStatuses")}</SelectItem>
            {RUN_STATUSES.filter((s) => s !== "extracted").map((s) => (
              <SelectItem key={s} value={s}>
                {t(`auto.status.${s}` as MessageKey)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {page === undefined ? (
        <StackSkeleton />
      ) : page.items.length === 0 ? (
        <EmptyState icon={<History />} title={t("auto.runs.empty")} body={t("auto.runs.emptyBody")} />
      ) : (
        <ul className="animate-fade-in divide-y overflow-hidden rounded-xl border bg-card">
          {page.items.map((r) => (
            <li key={r.id}>
              <button type="button" onClick={() => setOpen(r.id)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none">
                {!compact && <ChannelIcon channel={r.channel} className="hidden size-8 sm:flex" />}
                <div className="grid min-w-0 flex-1 gap-0.5">
                  <p className="truncate text-sm font-medium">{r.message?.subject || r.message?.fromName || r.message?.from || t("auto.runs.noSubject")}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {!automationId && `${r.automationName} · `}
                    {r.message?.from || "—"} · {relativeTime(r.createdAt, locale)}
                  </p>
                </div>
                <RunStatusBadge status={r.status} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {page && !page.done && (
        <Button variant="outline" className="justify-self-center" onClick={() => setLimit((l) => Math.min(100, l + 30))} disabled={limit >= 100}>
          {t("auto.runs.more")}
        </Button>
      )}

      <Sheet open={!!open} onOpenChange={(v) => !v && setOpen(null)}>
        <SheetContent className="w-full gap-0 overflow-y-auto p-0 sm:max-w-xl">
          <SheetHeader className="border-b">
            <SheetTitle>{t("auto.run.title")}</SheetTitle>
            <SheetDescription>{t("auto.run.lead")}</SheetDescription>
          </SheetHeader>
          {open && <RunDetail runId={open} />}
        </SheetContent>
      </Sheet>
    </div>
  )
}

export function RunDetail({ runId }: { runId: string }) {
  const { t, locale } = useT()
  const data = useQuery(api.automations.getRun, { runId })
  const [raw, setRaw] = useState(false)
  if (!data) return <Skeleton className="m-4 h-64" />
  const { run, event } = data
  return (
    <div className="grid gap-5 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <RunStatusBadge status={run.status} />
        <span className="text-sm text-muted-foreground">
          {run.automationName} · v{run.version} · {dateTime(run.createdAt, locale)}
        </span>
      </div>
      {run.error && (
        <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          <span className="font-medium">{run.error.code}</span>: {run.error.message}
        </p>
      )}
      {event && <MessageCard event={event} />}
      <ExtractedList run={run} />
      <ActionsList run={run} />
      <Timeline run={run} />
      {event && (
        <div className="grid gap-2">
          <Button variant="ghost" size="sm" className="justify-self-start" onClick={() => setRaw((v) => !v)}>
            {raw ? t("auto.run.hideRaw") : t("auto.run.showRaw")}
          </Button>
          {raw && (
            <pre className="max-h-96 overflow-auto rounded-lg border bg-muted/40 p-3 text-[12px] leading-relaxed whitespace-pre-wrap break-all">
              {prettyRaw(event.raw)}
              {event.rawTruncated && `\n… ${t("auto.run.truncated")}`}
            </pre>
          )}
          <p className="text-xs text-muted-foreground">
            {t("auto.run.format")}: {event.format} · {event.source}
            {event.contentType ? ` · ${event.contentType}` : ""} · {t("state.operation")} {run.operationId}
          </p>
        </div>
      )}
    </div>
  )
}

const prettyRaw = (raw: string) => {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2)
  } catch {
    return raw
  }
}

export function MessageCard({ event, className }: { event: EventView; className?: string }) {
  const { t, locale } = useT()
  const m = event.message
  return (
    <article className={`grid gap-3 rounded-xl border bg-background p-4 ${className ?? ""}`}>
      <header className="grid gap-1">
        <h3 className="text-base font-semibold break-words">{m.subject || t("auto.runs.noSubject")}</h3>
        <p className="text-sm text-muted-foreground break-words">
          {m.fromName ? `${m.fromName} ` : ""}
          {m.from ? `<${m.from}>` : ""}
          {m.to.length ? ` → ${m.to.join(", ")}` : ""}
        </p>
        <p className="text-xs text-muted-foreground">{dateTime(event.receivedAt, locale)}</p>
      </header>
      <div className="max-h-[50vh] overflow-y-auto text-sm leading-relaxed whitespace-pre-wrap break-words">{m.text || "—"}</div>
      {m.attachments.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {m.attachments.map((a, i) => (
            <li key={i}>
              <Badge variant="outline">
                <Paperclip />
                {a.name}
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </article>
  )
}

function ExtractedList({ run }: { run: RunView }) {
  const { t } = useT()
  if (!run.extracted) return null
  return (
    <section className="grid gap-2">
      <h3 className="text-sm font-semibold">{t("auto.run.extracted")}</h3>
      <dl className="divide-y overflow-hidden rounded-lg border">
        {run.fields.map((f) => (
          <div key={f.name} className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] gap-3 px-3 py-2 text-sm">
            <dt className="truncate font-mono text-[13px] text-muted-foreground">{f.name}</dt>
            <dd className="break-words">
              {showValue(run.extracted?.[f.name])}
              {run.review?.editedFields.includes(f.name) && (
                <Badge variant="secondary" className="ml-2">
                  {t("auto.run.edited")}
                </Badge>
              )}
            </dd>
          </div>
        ))}
      </dl>
      {run.errors.length > 0 && (
        <ul className="list-disc pl-5 text-[13px] text-destructive">
          {run.errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
    </section>
  )
}

function ActionsList({ run }: { run: RunView }) {
  const { t } = useT()
  if (!run.proposed.length) return null
  return (
    <section className="grid gap-2">
      <h3 className="text-sm font-semibold">{t("auto.run.actions")}</h3>
      <ol className="grid gap-2">
        {run.proposed.map((p, i) => {
          const r = run.results[i]
          return (
            <li key={i} className="grid gap-1.5 rounded-lg border p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">
                  {i + 1}. {targetLabel(t, p.targetId)}
                </span>
                {r ? <Badge variant={r.ok ? "default" : "destructive"}>{r.ok ? t("auto.run.done") : r.code}</Badge> : <Badge variant="outline">{t("auto.run.notRun")}</Badge>}
              </div>
              <InputPreview input={p.input} />
              {p.issues.length > 0 && (
                <ul className="list-disc pl-5 text-[13px] text-amber-700 dark:text-amber-300">
                  {p.issues.map((x) => (
                    <li key={x}>{x}</li>
                  ))}
                </ul>
              )}
              {r && !r.ok && r.message && <p className="text-[13px] text-destructive">{r.message}</p>}
              {r?.ok && r.result != null && <p className="truncate font-mono text-xs text-muted-foreground">{JSON.stringify(r.result)}</p>}
            </li>
          )
        })}
      </ol>
    </section>
  )
}

export function InputPreview({ input }: { input: unknown }) {
  const { t } = useT()
  const entries = input && typeof input === "object" ? Object.entries(input as Record<string, unknown>) : []
  if (!entries.length) return <p className="text-xs text-muted-foreground">—</p>
  return (
    <dl className="grid gap-x-3 gap-y-0.5 text-[13px] sm:grid-cols-[minmax(0,8rem)_minmax(0,1fr)]">
      {entries.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="truncate font-mono text-xs text-muted-foreground">{k}</dt>
          <dd className="line-clamp-3 break-words">{typeof v === "string" && v.startsWith("{{previous.") ? <em className="text-muted-foreground">{t("auto.run.fromFirst")}</em> : showValue(v)}</dd>
        </div>
      ))}
    </dl>
  )
}

function Timeline({ run }: { run: RunView }) {
  const { t, locale } = useT()
  const rows: [string, number | null][] = [
    [t("auto.run.received"), run.timings.queuedAt],
    [t("auto.run.extractedAt"), run.timings.extractedAt],
    [t("auto.run.reviewed"), run.review?.at ?? null],
    [t("auto.run.finished"), run.timings.finishedAt],
  ]
  return (
    <section className="grid gap-2">
      <h3 className="text-sm font-semibold">{t("auto.run.timeline")}</h3>
      <dl className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
        {rows
          .filter(([, v]) => v)
          .map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted-foreground">{k}</dt>
              <dd>{dateTime(v!, locale)}</dd>
            </div>
          ))}
        {run.review && (
          <div className="contents">
            <dt className="text-muted-foreground">{t("auto.run.reviewer")}</dt>
            <dd className="break-words">
              {run.review.byEmail ?? run.review.by}
              {run.review.note ? ` · „${run.review.note}“` : ""}
            </dd>
          </div>
        )}
        {run.model && (
          <div className="contents">
            <dt className="text-muted-foreground">{t("auto.run.model")}</dt>
            <dd className="break-words">
              {run.model}
              {run.usage ? ` · ${run.usage.inputTokens + run.usage.outputTokens} ${t("auto.run.tokens")}` : ""}
              {run.timings.extractMs !== null ? ` · ${(run.timings.extractMs / 1000).toFixed(1)} s` : ""}
              {run.attempts > 1 ? ` · ${run.attempts} ${t("auto.run.attempts")}` : ""}
            </dd>
          </div>
        )}
      </dl>
    </section>
  )
}
