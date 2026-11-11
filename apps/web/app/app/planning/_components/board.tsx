"use client"
// The weekly planning board ("Planavimas"): replaces the weekly Excel files.
import type { BoardView } from "@digimuza/staffing"
import { StaffingPlanningPermissions } from "@digimuza/staffing/planning/manifest"
import { Can } from "@digimuza/system-core/react"
import { useQuery } from "convex/react"
import { Settings2 } from "lucide-react"
import Link from "next/link"
import { useMemo, useState } from "react"
import { PageHeader } from "@/components/app/page-header"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { api } from "@/convex/_generated/api"
import { useT } from "@/lib/i18n/client"
import type { MessageKey } from "@/lib/i18n/messages"
import { NativeSelect, workerHref } from "../../staffing/_components/staffing-ui"
import { CapacityCard } from "./capacity-card"
import { CELL_CLASS, shortDate, usePlanningEnabled, WorkerStateBadge } from "./planning-ui"

export function PlanningBoard() {
  const { t } = useT()
  const enabled = usePlanningEnabled()
  const [weeks, setWeeks] = useState("8")
  const board = useQuery(api.planning.getBoard, enabled ? { weeks: Number(weeks) } : "skip")
  if (!enabled) return <p className="text-sm text-muted-foreground">{t("planning.disabled")}</p>

  return (
    <div className="grid gap-6">
      <PageHeader
        title={t("planning.title")}
        lead={t("planning.lead")}
        actions={
          <>
            <NativeSelect aria-label={t("planning.weeks")} value={weeks} onChange={setWeeks}>
              {["6", "8", "12"].map((w) => (
                <option key={w} value={w}>
                  {w} {t("planning.weeksShort")}
                </option>
              ))}
            </NativeSelect>
            <Can permission={StaffingPlanningPermissions.boardRead}>
              <Button variant="outline" size="sm" asChild>
                <Link href="/app/planning/settings">
                  <Settings2 />
                  {t("planning.settings.link")}
                </Link>
              </Button>
            </Can>
          </>
        }
      />
      {board === undefined ? (
        <Skeleton className="h-[32rem] w-full" />
      ) : (
        <>
          <CapacityCard trades={board.trades} defaultFrom={board.nextMonday} />
          <SupplyDemand board={board} />
          <Timeline board={board} />
        </>
      )}
    </div>
  )
}

function SupplyDemand({ board }: { board: BoardView }) {
  const { t, locale } = useT()
  const name = (id: string) => {
    const x = board.trades.find((tr) => tr.id === id)
    return x ? (locale === "en" ? x.nameEn : x.nameLt) : "?"
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("planning.sd.title")}</CardTitle>
        <CardDescription>{t("planning.sd.lead")}</CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto px-0">
        <table className="w-full min-w-[56rem] border-collapse text-sm tabular-nums">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th className="sticky left-0 z-10 bg-card px-4 py-2 font-medium">{t("planning.sd.trade")}</th>
              {board.weeks.map((w) => (
                <th key={w.start} className={`px-2 py-2 text-center font-medium ${w.start <= board.today && board.today <= w.end ? "text-foreground" : ""}`}>
                  <div className="label-marking">
                    {t("planning.week")} {w.number}
                  </div>
                  <div>{shortDate(w.start)}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {board.trades.map((tr) => (
              <tr key={tr.id} className="border-b last:border-b-0">
                <th scope="row" className="sticky left-0 z-10 max-w-56 truncate bg-card px-4 py-1.5 text-left font-normal" title={name(tr.id)}>
                  {name(tr.id)}
                </th>
                {board.weeks.map((w) => {
                  const c = w.trades.find((x) => x.tradeId === tr.id)!
                  const short = c.gap < 0
                  return (
                    <td key={w.start} className="px-1 py-1 text-center">
                      <div
                        className={`rounded-[2px] px-1.5 py-1 ${short ? "bg-destructive/12 text-destructive ring-1 ring-destructive/50" : c.demand > 0 ? "bg-steel-green/15" : "text-muted-foreground"}`}
                        title={`${t("planning.sd.own")} ${c.own} · ${t("planning.sd.sub")} ${c.subcontractor} · ${t("planning.sd.demand")} ${c.demand}`}
                      >
                        <span className="font-medium">{c.supply}</span>
                        {c.demand > 0 && <span className="text-xs"> / {c.demand}</span>}
                        {short && <span className="ml-1 text-xs font-semibold">{c.gap}</span>}
                      </div>
                    </td>
                  )
                })}
              </tr>
            ))}
            <tr className="border-t-2 border-foreground/70 font-medium">
              <th scope="row" className="sticky left-0 z-10 bg-card px-4 py-2 text-left">
                {t("planning.sd.total")}
              </th>
              {board.weeks.map((w) => (
                <td key={w.start} className={`px-2 py-2 text-center ${w.gap < 0 ? "text-destructive" : ""}`}>
                  {w.supply} / {w.demand}
                </td>
              ))}
            </tr>
            <tr className="text-xs text-muted-foreground">
              <th scope="row" className="sticky left-0 z-10 bg-card px-4 py-1.5 text-left font-normal">
                {t("planning.sd.changes")}
              </th>
              {board.weeks.map((w) => (
                <td key={w.start} className="px-2 py-1.5 text-center">
                  {w.freed > 0 && (
                    <div>
                      +{w.freed} {t("planning.sd.freed")}
                    </div>
                  )}
                  {w.back > 0 && (
                    <div>
                      +{w.back} {t("planning.sd.back")}
                    </div>
                  )}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
        <p className="px-4 pt-3 text-xs text-muted-foreground">{t("planning.sd.legend")}</p>
      </CardContent>
    </Card>
  )
}

function Timeline({ board }: { board: BoardView }) {
  const { t, locale } = useT()
  const [trade, setTrade] = useState("")
  const [nationality, setNationality] = useState("")
  const [source, setSource] = useState("")
  const [state, setState] = useState("")
  const [q, setQ] = useState("")
  const nationalities = useMemo(() => [...new Set(board.rows.map((r) => r.worker.nationality))].sort(), [board.rows])
  const tradeName = (id: string) => {
    const x = board.trades.find((tr) => tr.id === id)
    return x ? (locale === "en" ? x.nameEn : x.nameLt) : null
  }
  const tradeCode = (id: string) => board.trades.find((tr) => tr.id === id)?.code ?? ""
  const needle = q.trim().toLowerCase()
  const rows = board.rows.filter(
    (r) =>
      (!trade || r.worker.tradeIds.includes(trade)) &&
      (!nationality || r.worker.nationality === nationality) &&
      (!source || r.worker.source === source) &&
      (!state || r.status.state === state) &&
      (!needle || r.worker.name.toLowerCase().includes(needle)),
  )
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("planning.tl.title")}</CardTitle>
        <CardDescription>{t("planning.tl.lead")}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 px-0">
        <div className="flex flex-wrap gap-2 px-4">
          <Input placeholder={t("planning.tl.search")} value={q} onChange={(e) => setQ(e.target.value)} className="w-48" />
          <NativeSelect aria-label={t("planning.tl.trade")} value={trade} onChange={setTrade}>
            <option value="">{t("planning.tl.anyTrade")}</option>
            {board.trades.map((x) => (
              <option key={x.id} value={x.id}>
                {locale === "en" ? x.nameEn : x.nameLt}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect aria-label={t("planning.tl.nationality")} value={nationality} onChange={setNationality}>
            <option value="">{t("planning.tl.anyNationality")}</option>
            {nationalities.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect aria-label={t("planning.tl.source")} value={source} onChange={setSource}>
            <option value="">{t("planning.tl.anySource")}</option>
            <option value="own">{t("staffing.source.own")}</option>
            <option value="subcontractor">{t("staffing.source.subcontractor")}</option>
          </NativeSelect>
          <NativeSelect aria-label={t("planning.tl.state")} value={state} onChange={setState}>
            <option value="">{t("planning.tl.anyState")}</option>
            {(["working", "resting", "unavailable", "reserve"] as const).map((s) => (
              <option key={s} value={s}>
                {t(`planning.state.${s}` as MessageKey)}
              </option>
            ))}
          </NativeSelect>
          <span className="self-center text-sm text-muted-foreground tabular-nums">
            {rows.length} / {board.rows.length}
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[64rem] border-collapse text-xs">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="sticky left-0 z-10 w-72 bg-card px-4 py-2 font-medium">{t("planning.tl.worker")}</th>
                {board.weeks.map((w) => (
                  <th key={w.start} className="px-1 py-2 text-center font-medium tabular-nums">
                    {t("planning.week")} {w.number}
                    <div className="font-normal">{shortDate(w.start)}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.worker.id} className="border-b last:border-b-0">
                  <th scope="row" className="sticky left-0 z-10 bg-card px-4 py-1.5 text-left font-normal">
                    <div className="flex items-center gap-2">
                      <Link href={workerHref(r.worker.id)} className="truncate text-sm font-medium hover:underline">
                        {r.worker.name}
                      </Link>
                      <WorkerStateBadge status={r.status} short />
                    </div>
                    <div className="truncate text-muted-foreground" title={r.worker.tradeIds.map(tradeName).filter(Boolean).join(", ")}>
                      {r.worker.nationality} · {r.worker.languages.join(" ").toUpperCase()} · {r.worker.tradeIds.map(tradeCode).filter(Boolean).join(", ")}
                      {r.worker.subcontractorName && ` · ${r.worker.subcontractorName}`}
                    </div>
                  </th>
                  {r.cells.map((c, i) => (
                    <td key={i} className="px-0.5 py-1">
                      <div className={`flex h-8 items-center justify-center truncate rounded-[2px] px-1 text-center tabular-nums ${CELL_CLASS[c.state]}`} title={[t(`planning.cell.${c.state}` as MessageKey), c.label, c.until ? `${t("planning.state.until")} ${c.until}` : null].filter(Boolean).join(" · ")}>
                        {c.state === "project" || c.state === "proposed" ? c.label : c.state === "ending" ? `${c.label} → ${shortDate(c.until)}` : c.state === "free" ? "" : t(`planning.cell.${c.state}` as MessageKey)}
                      </div>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap gap-3 px-4 text-xs text-muted-foreground">
          {(["project", "ending", "proposed", "rest", "unavailable", "free"] as const).map((s) => (
            <span key={s} className="inline-flex items-center gap-1.5">
              <span className={`inline-block h-3 w-5 rounded-[2px] ${CELL_CLASS[s]}`} aria-hidden />
              {t(`planning.cell.${s}` as MessageKey)}
            </span>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
