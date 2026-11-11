"use client"
// "Uždarytas procesas": every client billing period from hours to payment, so
// a period whose chain broke (hours approved, invoice never written) is seen
// the day it happens, not three months later.
import { StaffingInvoicingPermissions as P } from "@digimuza/staffing/invoicing/manifest"
import { CHAIN_STEPS, type ChainStep, type StepState } from "@digimuza/staffing/invoicing/pure"
import { Can } from "@digimuza/system-core/react"
import { useMutation, useQuery } from "convex/react"
import type { FunctionReturnType } from "convex/server"
import { AlertTriangle, Check, CircleDashed, FilePlus2, Minus, RefreshCw, X } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { toast } from "sonner"
import { PageHeader } from "@/components/app/page-header"
import { useAction } from "@/components/app/use-action"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { useT } from "@/lib/i18n/client"
import type { MessageKey } from "@/lib/i18n/messages"
import { invoiceHref, InvoicingDisabled, InvoicingTabs, InvoiceStatusBadge, Stat, useInvoicingEnabled, useMoney } from "./invoicing-ui"

type ChainData = FunctionReturnType<typeof api.invoicing.chain>
type ChainRow = ChainData["rows"][number]
type ChainPeriod = ChainRow["periods"][number]

const SEGMENT: Record<StepState, string> = {
  done: "bg-steel-green",
  partial: "bg-marking",
  missing: "bg-destructive",
  na: "bg-muted",
}

/** A step's colour: a missing step of a period that still runs is "not yet", not an error. */
function stepClass(p: ChainPeriod, s: ChainStep): string {
  const state = p.steps[s]
  if (state === "missing" && (!p.ended || p.brokenAt !== s)) return "bg-muted-foreground/25"
  return SEGMENT[state]
}

const monthKey = (d: string) => d.slice(0, 7)

/** The 8-segment chain of one period; the broken step is outlined. */
function ChainBar({ p, selected, onClick, label }: { p: ChainPeriod; selected: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      aria-label={label}
      title={label}
      className={`group grid w-full gap-1 rounded-md border px-1.5 py-1 text-left transition-colors ${selected ? "border-foreground bg-secondary" : "border-transparent hover:border-border hover:bg-secondary/60"} ${p.alert ? "ring-1 ring-destructive" : ""}`}
    >
      <span className="flex items-center justify-between gap-1 text-[10px] leading-none text-muted-foreground tabular-nums">
        <span>
          {p.from.slice(5)}–{p.to.slice(5)}
        </span>
        {p.closed ? <Check className="size-3 text-steel-green" aria-hidden /> : p.alert ? <AlertTriangle className="size-3 text-destructive" aria-hidden /> : null}
      </span>
      <span className="flex gap-0.5" aria-hidden>
        {CHAIN_STEPS.map((s) => (
          <span key={s} className={`h-2.5 flex-1 rounded-[2px] ${stepClass(p, s)} ${p.brokenAt === s && p.ended ? "outline-1 outline-offset-1 outline-foreground" : ""}`} />
        ))}
      </span>
    </button>
  )
}

export function ChainView() {
  const { t, locale } = useT()
  const money = useMoney()
  const enabled = useInvoicingEnabled()
  const data = useQuery(api.invoicing.chain, enabled ? {} : "skip")
  const check = useMutation(api.invoicing.runChainCheck)
  const { run, busy } = useAction()
  const [picked, setPicked] = useState<{ clientId: string; from: string } | null>(null)
  if (!enabled) return <InvoicingDisabled />

  // Default selection: the biggest alert, else nothing.
  const sel = picked ?? (data?.alerts[0] ? { clientId: data.alerts[0].clientId, from: data.alerts[0].from } : null)
  const selRow = data?.rows.find((r) => r.clientId === sel?.clientId)
  const selPeriod = selRow?.periods.find((p) => p.from === sel?.from) ?? null

  const months: string[] = []
  if (data) {
    const [y, m] = data.today.split("-").map(Number) as [number, number]
    for (let i = 5; i >= 0; i--) {
      const d = new Date(Date.UTC(y, m - 1 - i, 1))
      months.push(d.toISOString().slice(0, 7))
    }
  }
  const monthLabel = (k: string) => new Date(`${k}-01T00:00:00Z`).toLocaleDateString(locale === "en" ? "en-GB" : "lt-LT", { month: "long", year: "numeric", timeZone: "UTC" })
  const periodsAll = data?.rows.flatMap((r) => r.periods.filter((p) => !p.empty && p.ended)) ?? []
  const closed = periodsAll.filter((p) => p.closed).length

  const actions = (
    <Can permission={P.invoiceManage}>
      <Button
        size="sm"
        variant="outline"
        disabled={busy}
        onClick={async () => {
          const r = await run(() => check({}))
          if (r) toast.success(r.alerts ? t("invoicing.chain.checkSent").replace("{count}", String(r.alerts)).replace("{amount}", money(r.atRiskCents)) : t("invoicing.chain.checkNothing"))
        }}
      >
        <RefreshCw />
        {t("invoicing.chain.check")}
      </Button>
    </Can>
  )

  return (
    <div>
      <PageHeader title={t("invoicing.chain.title")} lead={t("invoicing.chain.lead")} actions={actions} />
      <InvoicingTabs />
      {!data ? (
        <Skeleton className="h-96 w-full rounded-xl" />
      ) : (
        <div className="grid gap-5">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label={t("invoicing.chain.closed")} value={`${closed} / ${periodsAll.length}`} hint={t("invoicing.chain.closedHint")} tone={closed === periodsAll.length ? "good" : undefined} />
            <Stat label={t("invoicing.chain.atRisk")} value={money(data.atRiskCents)} hint={t("invoicing.chain.atRiskHint").replace("{days}", String(data.alertAfterDays))} tone={data.atRiskCents ? "bad" : "good"} />
            <Stat label={t("invoicing.chain.alerts")} value={String(data.alerts.length)} tone={data.alerts.length ? "bad" : "good"} />
            <Stat
              label={t("invoicing.chain.lastRun")}
              value={data.lastRun ? new Date(data.lastRun.at).toLocaleString(locale === "en" ? "en-GB" : "lt-LT", { dateStyle: "short", timeStyle: "short" }) : "—"}
              hint={data.lastRun ? t(`invoicing.chain.run.${data.lastRun.status}` as MessageKey).replace("{count}", String(data.lastRun.alerts)) : t("invoicing.chain.run.never")}
            />
          </div>

          {data.alerts.length > 0 && (
            <div className="rounded-xl border border-destructive/50 bg-destructive/5 p-4" role="alert">
              <div className="mb-2 flex items-center gap-2 font-medium text-destructive">
                <AlertTriangle className="size-4" aria-hidden />
                {t("invoicing.chain.alertsTitle")}
              </div>
              <ul className="grid gap-1.5 text-sm">
                {data.alerts.map((a) => (
                  <li key={`${a.clientId}-${a.from}`} className="flex flex-wrap items-center justify-between gap-2">
                    <button type="button" className="text-left hover:underline" onClick={() => setPicked({ clientId: a.clientId, from: a.from })}>
                      <span className="font-medium">{a.clientName}</span> <span className="font-mono text-xs text-muted-foreground">{a.clientCode}</span> · {a.from} – {a.to}:{" "}
                      {t("invoicing.chain.alertLine").replace("{days}", String(a.daysSinceEnd))}
                    </button>
                    <span className="font-semibold tabular-nums text-destructive">{money(a.atRiskCents)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="overflow-x-auto rounded-xl border bg-card">
            <table className="w-full min-w-[56rem] border-collapse text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="w-56 px-4 py-2 font-medium">{t("invoicing.col.client")}</th>
                  {months.map((m) => (
                    <th key={m} className="px-2 py-2 font-medium capitalize">
                      {monthLabel(m)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.clientId} className="border-b align-top last:border-0">
                    <td className="px-4 py-3">
                      <div className="font-medium">{r.name}</div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {t(`staffing.period.${r.invoicingPeriod}` as MessageKey)} · {r.projects.map((p) => p.code).join(", ") || "—"}
                      </div>
                    </td>
                    {months.map((m) => {
                      const cell = r.periods.filter((p) => !p.empty && monthKey(p.to < data.today ? p.to : p.from) === m)
                      return (
                        <td key={m} className="px-2 py-2">
                          <div className="grid gap-1">
                            {cell.map((p) => (
                              <ChainBar
                                key={p.from}
                                p={p}
                                selected={sel?.clientId === r.clientId && sel.from === p.from}
                                onClick={() => setPicked({ clientId: r.clientId, from: p.from })}
                                label={`${r.name} ${p.from}–${p.to}: ${p.closed ? t("invoicing.chain.isClosed") : p.brokenAt ? t(`invoicing.chain.step.${p.brokenAt}` as MessageKey) : ""}`}
                              />
                            ))}
                          </div>
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <Legend />

          {selRow && selPeriod && <PeriodDetail row={selRow} p={selPeriod} />}
        </div>
      )}
    </div>
  )
}

function Legend() {
  const { t } = useT()
  const items: [string, MessageKey][] = [
    ["bg-steel-green", "invoicing.chain.legend.done"],
    ["bg-marking", "invoicing.chain.legend.partial"],
    ["bg-destructive", "invoicing.chain.legend.broken"],
    ["bg-muted-foreground/25", "invoicing.chain.legend.pending"],
  ]
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
      <span className="font-medium text-foreground">{t("invoicing.chain.legend.steps")}</span>
      <span>{CHAIN_STEPS.map((s, i) => `${i + 1}. ${t(`invoicing.chain.step.${s}` as MessageKey)}`).join(" → ")}</span>
      {items.map(([cls, key]) => (
        <span key={key} className="inline-flex items-center gap-1.5">
          <span className={`inline-block h-2.5 w-4 rounded-[2px] ${cls}`} aria-hidden />
          {t(key)}
        </span>
      ))}
    </div>
  )
}

function StepIcon({ state, current }: { state: StepState; current: boolean }) {
  if (state === "done") return <Check className="size-4 text-steel-green" aria-hidden />
  if (state === "partial") return <Minus className="size-4 text-marking-foreground dark:text-marking" aria-hidden />
  if (state === "na") return <CircleDashed className="size-4 text-muted-foreground" aria-hidden />
  return <X className={`size-4 ${current ? "text-destructive" : "text-muted-foreground"}`} aria-hidden />
}

function PeriodDetail({ row, p }: { row: ChainRow; p: ChainPeriod }) {
  const { t } = useT()
  const money = useMoney()
  const router = useRouter()
  const create = useMutation(api.invoicing.createDraft)
  const { run, busy } = useAction()
  const f = p.facts
  const fact: Partial<Record<ChainStep, string>> = {
    hours: t("invoicing.chain.fact.hours").replace("{days}", String(f.daysWithHours)).replace("{hours}", String(p.hours)),
    weekApproved: t("invoicing.chain.fact.weeks").replace("{done}", String(f.weeksApproved)).replace("{of}", String(f.weeksWithHours)),
    clientSheet: t("invoicing.chain.fact.sheets").replace("{done}", String(f.daysCovered)).replace("{of}", String(f.daysWithHours)),
    reconciled: f.openMismatches ? t("invoicing.chain.fact.mismatches").replace("{count}", String(f.openMismatches)) : f.sheets ? t("invoicing.chain.fact.noMismatches") : undefined,
  }
  const status = p.empty ? t("invoicing.chain.isEmpty") : p.closed ? t("invoicing.chain.isClosed") : !p.ended ? t("invoicing.chain.isRunning") : t("invoicing.chain.isBroken").replace("{step}", t(`invoicing.chain.step.${p.brokenAt!}` as MessageKey))
  const timesheetsHref = row.projects[0] ? `/app/timesheets/${row.projects[0].id}` : "/app/timesheets"
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          {row.name} · {p.from} – {p.to}
          <Badge variant={p.alert ? "destructive" : "outline"} className={p.closed ? "border-transparent bg-steel-green/15 text-steel-green" : ""}>
            {status}
          </Badge>
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          {t("invoicing.chain.value")}: <span className="tabular-nums text-foreground">{money(p.valueCents)}</span>
          {p.atRiskCents > 0 && (
            <>
              {" · "}
              {t("invoicing.chain.atRisk")}: <span className="font-semibold tabular-nums text-destructive">{money(p.atRiskCents)}</span>
            </>
          )}
          {p.ended && !p.closed && !p.empty && (
            <>
              {" · "}
              {t("invoicing.chain.endedAgo").replace("{days}", String(p.daysSinceEnd))}
            </>
          )}
        </p>
      </CardHeader>
      <CardContent className="grid gap-4 lg:grid-cols-[1fr_auto]">
        <ol className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {CHAIN_STEPS.map((s, i) => (
            <li key={s} className={`flex items-start gap-2 rounded-lg border p-2.5 ${p.brokenAt === s && p.ended ? "border-destructive/60 bg-destructive/5" : ""}`}>
              <StepIcon state={p.steps[s]} current={p.brokenAt === s && p.ended} />
              <div className="min-w-0">
                <div className="text-sm font-medium">
                  {i + 1}. {t(`invoicing.chain.step.${s}` as MessageKey)}
                </div>
                {fact[s] && <div className="text-xs text-muted-foreground">{fact[s]}</div>}
                {s === "drafted" && p.invoice && (
                  <Link href={invoiceHref(p.invoice.id)} className="text-xs hover:underline">
                    {p.invoice.number ?? t("invoicing.draftNumber")} · {money(p.invoice.totalCents)}
                  </Link>
                )}
              </div>
            </li>
          ))}
        </ol>
        <div className="flex flex-col items-stretch gap-2">
          {p.invoice ? (
            <>
              <InvoiceStatusBadge status={p.invoice.status} />
              <Button size="sm" variant="outline" asChild>
                <Link href={invoiceHref(p.invoice.id)}>{t("invoicing.chain.openInvoice")}</Link>
              </Button>
            </>
          ) : (
            p.ended &&
            p.hours > 0 && (
              <Can permission={P.invoiceManage}>
                <Button
                  size="sm"
                  disabled={busy}
                  onClick={async () => {
                    const res = await run(() => create({ clientId: row.clientId as Id<"staffing_clients">, from: p.from, to: p.to }), { success: t("invoicing.created") })
                    if (res) router.push(invoiceHref(res.id))
                  }}
                >
                  <FilePlus2 />
                  {t("invoicing.chain.createDraft")}
                </Button>
              </Can>
            )
          )}
          {(p.steps.weekApproved !== "done" || p.steps.clientSheet !== "done" || p.steps.reconciled !== "done") && !p.empty && (
            <Button size="sm" variant="outline" asChild>
              <Link href={timesheetsHref}>{t("invoicing.chain.openTimesheets")}</Link>
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
