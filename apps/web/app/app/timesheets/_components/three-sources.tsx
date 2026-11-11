"use client"
// DIG-111: worker / ours / client hours per worker per day of a week.
import type { ThreeWayView } from "@digimuza/staffing"
import { StaffingTimesheetsPermissions as P } from "@digimuza/staffing/timesheets/manifest"
import { addDays } from "@digimuza/staffing/pure"
import type { SourceAgreement, ThreeWayDay } from "@digimuza/staffing/timesheets/pure"
import { useCan } from "@digimuza/system-core/react"
import { useMutation, useQuery } from "convex/react"
import { Gavel, Hand, LinkIcon } from "lucide-react"
import { useRouter } from "next/navigation"
import { EmptyState } from "@/components/app/empty-state"
import { useAction } from "@/components/app/use-action"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { useT } from "@/lib/i18n/client"
import type { MessageKey } from "@/lib/i18n/messages"
import { cn } from "@/lib/utils"
import { disputeHref, useDateFormat, useHours } from "./timesheets-ui"

/** Cell tint by which source is the odd one out. */
const KIND_CELL: Record<SourceAgreement, string> = {
  agree: "bg-steel-green/10",
  single: "",
  empty: "",
  worker_differs: "bg-marking/25",
  ours_differs: "bg-marking/25",
  client_differs: "bg-destructive/10",
  all_differ: "bg-destructive/15",
}

export function ThreeSources({ projectId, week }: { projectId: string; week: string }) {
  const { t } = useT()
  const view = useQuery(api.timesheets.threeWayWeek, { projectId: projectId as Id<"staffing_projects">, weekStart: week })
  const hours = useHours()
  const d = useDateFormat()
  if (view === undefined) return <Skeleton className="mt-3 h-72 w-full rounded-xl" />
  if (view === null) return null
  return (
    <div className="mt-3 space-y-3">
      <p className="max-w-[70ch] text-sm text-muted-foreground">{t("ts3.lead")}</p>
      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label={t("ts3.sumWorker")} value={`${hours(view.totals.worker, true)} h`} />
        <Stat label={t("ts3.sumOurs")} value={`${hours(view.totals.ours, true)} h`} />
        <Stat label={t("ts3.sumClient")} value={`${hours(view.totals.client, true)} h`} />
        <Stat label={`${t("ts3.disagreements")} · ${t("ts3.flags")}`} value={`${view.totals.disagreements} · ${view.totals.flags}`} warn={view.totals.disagreements + view.totals.flags > 0} />
      </div>
      {view.rows.length === 0 ? (
        <EmptyState icon={<LinkIcon />} title={t("ts3.empty")} />
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="sticky left-0 z-10 min-w-48 bg-card px-4">{t("ts3.worker")}</TableHead>
                {view.days.map((day) => (
                  <TableHead key={day} className="min-w-20 text-center">
                    <div className="capitalize">{d.weekday(day)}</div>
                    <div className="text-xs font-normal tabular-nums text-muted-foreground">{d.day(day)}</div>
                  </TableHead>
                ))}
                <TableHead className="min-w-24 text-center">{t("ts3.total")}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {view.rows.map((r) => (
                <TableRow key={r.workerId}>
                  <TableCell className="sticky left-0 z-10 bg-card px-4">
                    <div className="font-medium">{r.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {r.disagreements > 0 && <span className="text-destructive">{r.disagreements} × {t("ts3.disagreements").toLowerCase()}</span>}
                      {r.disagreements > 0 && r.flags > 0 && " · "}
                      {r.flags > 0 && <span className="text-marking-foreground dark:text-marking">{r.flags} × {t("ts3.flags")}</span>}
                      {!view.linked.includes(r.workerId) && <span>{r.disagreements + r.flags > 0 ? " · " : ""}{t("ts3.noLink")}</span>}
                    </div>
                  </TableCell>
                  {view.days.map((day) => (
                    <TableCell key={day} className="p-1">
                      <Cell day={r.days[day]!} />
                    </TableCell>
                  ))}
                  <TableCell className="p-1">
                    <Triple worker={r.totals.worker} ours={r.totals.ours} client={r.totals.client} />
                  </TableCell>
                  <TableCell className="pr-3 text-right">
                    <DisputeButton view={view} row={r} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>{t("ts3.legend.worker")}</span>
        <span>{t("ts3.legend.ours")}</span>
        <span>{t("ts3.legend.client")}</span>
        <span className="rounded bg-marking/25 px-1.5">{t("ts3.kind.worker_differs")} / {t("ts3.kind.ours_differs")}</span>
        <span className="rounded bg-destructive/10 px-1.5">{t("ts3.kind.client_differs")}</span>
        <span className="inline-flex items-center gap-1">
          <Hand className="size-3" /> {t("ts3.flags")}
        </span>
      </p>
    </div>
  )
}

function Cell({ day }: { day: ThreeWayDay }) {
  const { t } = useT()
  if (day.kind === "empty") return <div className="h-14" />
  const body = (
    <div className={cn("relative rounded-md px-1.5 py-1", KIND_CELL[day.kind])}>
      <Triple worker={day.worker} ours={day.ours} client={day.client} />
      {day.flag && <Hand className="absolute right-0.5 top-0.5 size-3 text-marking-foreground dark:text-marking" />}
    </div>
  )
  return (
    <Tooltip>
      <TooltipTrigger asChild>{body}</TooltipTrigger>
      <TooltipContent className="max-w-64">
        <div className="font-medium">{t(`ts3.kind.${day.kind}` as MessageKey)}</div>
        {day.flag && <div className="mt-1">„{day.flag}“</div>}
      </TooltipContent>
    </Tooltip>
  )
}

function Triple({ worker, ours, client }: { worker: number | null; ours: number | null; client: number | null }) {
  const { t } = useT()
  const hours = useHours()
  const v = (h: number | null) => (h === null ? "–" : hours(h, true))
  const letter = (k: MessageKey) => t(k).charAt(0)
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-1.5 text-[0.7rem] leading-tight tabular-nums">
      <dt className="text-muted-foreground">{letter("ts3.legend.worker")}</dt>
      <dd className="text-right font-medium">{v(worker)}</dd>
      <dt className="text-muted-foreground">{letter("ts3.legend.ours")}</dt>
      <dd className="text-right">{v(ours)}</dd>
      <dt className="text-muted-foreground">{letter("ts3.legend.client")}</dt>
      <dd className="text-right">{v(client)}</dd>
    </dl>
  )
}

function DisputeButton({ view, row }: { view: ThreeWayView; row: ThreeWayView["rows"][number] }) {
  const { t } = useT()
  const can = useCan(P.clientManage)
  const create = useMutation(api.timesheets.createDispute)
  const { run, busy } = useAction()
  const router = useRouter()
  const clientSpoke = Object.values(row.days).some((d) => d.client !== null && d.diff < 0)
  if (!can || (!clientSpoke && row.flags === 0)) return null
  return (
    <Button
      size="sm"
      variant="outline"
      className="h-7"
      disabled={busy}
      onClick={async () => {
        const res = await run(() => create({ workerId: row.workerId as Id<"staffing_workers">, projectId: view.project.id as Id<"staffing_projects">, periodFrom: view.weekStart, periodTo: addDays(view.weekStart, 6), kind: row.flags > 0 ? "worker_flag" : "mismatch" }), {
          error: (se) => (se?.code === "VALIDATION" ? t("disputes.emptyBody") : undefined),
        })
        if (res) router.push(disputeHref(res.id))
      }}
    >
      <Gavel />
      {t("ts3.dispute")}
    </Button>
  )
}

function Stat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className={cn("rounded-xl border bg-card p-3", warn && "border-marking-foreground/50")}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-xl font-semibold tabular-nums">{value}</div>
    </div>
  )
}
