"use client"
// The planning block on the worker card (staffing/_components/worker-card.tsx):
// Dirba / Namuose / Rezerve, rest periods, work history and verdict per client.
import type { WorkerPlanningView } from "@digimuza/staffing"
import { StaffingPlanningPermissions } from "@digimuza/staffing/planning/manifest"
import type { AvailabilityKind } from "@digimuza/staffing/pure"
import { Can, useCan } from "@digimuza/system-core/react"
import { useMutation, useQuery } from "convex/react"
import { CalendarClock, Plus, ThumbsDown, ThumbsUp, Trash2 } from "lucide-react"
import { useState, type FormEvent } from "react"
import { toast } from "sonner"
import { useAction } from "@/components/app/use-action"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { useT } from "@/lib/i18n/client"
import type { MessageKey } from "@/lib/i18n/messages"
import { NativeSelect, Period } from "../../staffing/_components/staffing-ui"
import { usePlanningEnabled, WorkerStateBadge } from "./planning-ui"

export function WorkerPlanningPanel({ workerId }: { workerId: string }) {
  const enabled = usePlanningEnabled()
  const can = useCan(StaffingPlanningPermissions.boardRead)
  const data = useQuery(api.planning.getWorkerPlanning, enabled && can ? { workerId: workerId as Id<"staffing_workers"> } : "skip")
  if (!enabled || !can || !data) return null
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1.4fr]">
      <Rotation workerId={workerId} data={data} />
      <History workerId={workerId} data={data} />
    </div>
  )
}

const KINDS: AvailabilityKind[] = ["rest", "unavailable", "available_from"]
const KIND_CLASS: Record<AvailabilityKind, string> = {
  rest: "border-transparent bg-marking text-marking-foreground",
  unavailable: "border-destructive/70 text-destructive",
  available_from: "",
}

function Rotation({ workerId, data }: { workerId: string; data: WorkerPlanningView }) {
  const { t } = useT()
  const add = useMutation(api.planning.addAvailability)
  const del = useMutation(api.planning.deleteAvailability)
  const canWrite = useCan(StaffingPlanningPermissions.availabilityWrite)
  const { run, busy } = useAction()
  const today = new Date().toISOString().slice(0, 10)
  const [kind, setKind] = useState<AvailabilityKind>("rest")
  const [from, setFrom] = useState(today)
  const [to, setTo] = useState("")
  const [note, setNote] = useState("")
  const s = data.status

  async function submit(e: FormEvent) {
    e.preventDefault()
    const res = await run(() => add({ workerId: workerId as Id<"staffing_workers">, kind, startDate: from, ...(to && kind !== "available_from" ? { endDate: to } : {}), note }), { success: t("planning.worker.added") })
    if (res?.overlapsAssignment) toast.warning(t("planning.worker.overlaps"))
    if (res) {
      setTo("")
      setNote("")
    }
  }

  return (
    <Card className="py-4">
      <CardHeader className="px-4">
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <CalendarClock className="size-4" />
          {t("planning.worker.title")}
          <WorkerStateBadge status={s} />
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3 px-4 text-sm">
        {s.next && (
          <p className="text-muted-foreground">
            {t("planning.worker.next")}: {s.next.kind === "project" ? s.next.label : t(`planning.kind.${s.next.kind}` as MessageKey)} {t("planning.worker.fromDate")} <span className="tabular-nums">{s.next.startDate}</span>
          </p>
        )}
        {data.availability.length === 0 ? (
          <p className="text-muted-foreground">{t("planning.worker.noPeriods")}</p>
        ) : (
          <ul className="grid gap-1.5">
            {data.availability.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className={KIND_CLASS[p.kind]}>
                  {t(`planning.kind.${p.kind}` as MessageKey)}
                </Badge>
                {p.kind === "available_from" ? <span className="tabular-nums">{p.startDate}</span> : <Period from={p.startDate} to={p.endDate} />}
                {p.note && <span className="text-muted-foreground">{p.note}</span>}
                {canWrite && (
                  <Button variant="ghost" size="icon" className="ml-auto size-7" aria-label={t("staffing.common.delete")} disabled={busy} onClick={() => void run(() => del({ availabilityId: p.id as Id<"staffing_workerAvailability"> }), { success: t("staffing.common.deleted") })}>
                    <Trash2 />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        <Can permission={StaffingPlanningPermissions.availabilityWrite}>
          <form onSubmit={(e) => void submit(e)} className="grid gap-2 border-t pt-3">
            <div className="flex flex-wrap gap-2">
              <NativeSelect aria-label={t("planning.worker.kind")} value={kind} onChange={(v) => setKind(v as AvailabilityKind)}>
                {KINDS.map((k) => (
                  <option key={k} value={k}>
                    {t(`planning.kind.${k}` as MessageKey)}
                  </option>
                ))}
              </NativeSelect>
              <Input aria-label={t("planning.worker.from")} type="date" required value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" />
              {kind !== "available_from" && <Input aria-label={t("planning.worker.to")} type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" />}
            </div>
            <div className="flex gap-2">
              <Input placeholder={t("planning.worker.notePh")} value={note} onChange={(e) => setNote(e.target.value)} />
              <Button type="submit" size="sm" disabled={busy}>
                <Plus />
                {t("planning.worker.add")}
              </Button>
            </div>
          </form>
        </Can>
      </CardContent>
    </Card>
  )
}

function History({ workerId, data }: { workerId: string; data: WorkerPlanningView }) {
  const { t } = useT()
  const set = useMutation(api.planning.setFeedback)
  const { run, busy } = useAction()
  const [clientId, setClientId] = useState("")
  const [verdict, setVerdict] = useState<"suitable" | "unsuitable">("suitable")
  const [comment, setComment] = useState("")

  async function submit(e: FormEvent) {
    e.preventDefault()
    const ok = await run(() => set({ workerId: workerId as Id<"staffing_workers">, clientId: clientId as Id<"staffing_clients">, verdict, comment }), { success: t("planning.feedback.saved") })
    if (ok) {
      setClientId("")
      setComment("")
    }
  }

  return (
    <Card className="py-4">
      <CardHeader className="px-4">
        <CardTitle className="text-base">{t("planning.history.title")}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3 px-0 text-sm">
        {data.history.length === 0 ? (
          <p className="px-4 text-muted-foreground">{t("planning.history.empty")}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="px-4">{t("planning.history.client")}</TableHead>
                <TableHead>{t("planning.history.worked")}</TableHead>
                <TableHead>{t("planning.history.verdict")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.history.map((h) => (
                <TableRow key={h.clientId}>
                  <TableCell className="px-4 align-top">
                    <div className="font-medium">{h.clientName}</div>
                    {h.projects.length > 0 && <div className="text-xs text-muted-foreground">{h.projects.join(", ")}</div>}
                  </TableCell>
                  <TableCell className="align-top tabular-nums">
                    {h.times > 0 ? (
                      <>
                        {t("planning.history.times")} {h.times} {t("planning.history.timesUnit")}
                        {h.lastDate && (
                          <div className="text-xs text-muted-foreground">
                            {h.ongoing ? t("planning.history.ongoing") : `${t("planning.history.last")} ${h.lastDate}`}
                          </div>
                        )}
                      </>
                    ) : (
                      <span className="text-muted-foreground">–</span>
                    )}
                  </TableCell>
                  <TableCell className="max-w-80 align-top whitespace-normal">
                    {h.feedback ? (
                      <div className="grid gap-1">
                        <FeedbackBadge verdict={h.feedback.verdict} />
                        {h.feedback.comment && <span className="text-xs text-muted-foreground">{h.feedback.comment}</span>}
                      </div>
                    ) : (
                      <span className="text-muted-foreground">–</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <Can permission={StaffingPlanningPermissions.feedbackWrite}>
          <form onSubmit={(e) => void submit(e)} className="grid gap-2 border-t px-4 pt-3">
            <div className="flex flex-wrap gap-2">
              <NativeSelect aria-label={t("planning.history.client")} required value={clientId} onChange={setClientId} className="min-w-56 flex-1">
                <option value="">{t("planning.feedback.client")}…</option>
                {data.clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </NativeSelect>
              <div className="inline-flex gap-1" role="radiogroup" aria-label={t("planning.history.verdict")}>
                <Button type="button" size="sm" variant={verdict === "suitable" ? "secondary" : "ghost"} aria-pressed={verdict === "suitable"} onClick={() => setVerdict("suitable")}>
                  <ThumbsUp />
                  {t("planning.feedback.suitable")}
                </Button>
                <Button type="button" size="sm" variant={verdict === "unsuitable" ? "secondary" : "ghost"} aria-pressed={verdict === "unsuitable"} onClick={() => setVerdict("unsuitable")}>
                  <ThumbsDown />
                  {t("planning.feedback.unsuitable")}
                </Button>
              </div>
            </div>
            <Textarea rows={2} placeholder={verdict === "unsuitable" ? t("planning.feedback.whyRequired") : t("planning.feedback.comment")} value={comment} onChange={(e) => setComment(e.target.value)} />
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">{t("planning.feedback.hint")}</p>
              <Button type="submit" size="sm" disabled={busy || !clientId || (verdict === "unsuitable" && !comment.trim())}>
                {t("planning.feedback.save")}
              </Button>
            </div>
          </form>
        </Can>
      </CardContent>
    </Card>
  )
}

export function FeedbackBadge({ verdict }: { verdict: "suitable" | "unsuitable" }) {
  const { t } = useT()
  return verdict === "suitable" ? (
    <Badge variant="outline" className="border-transparent bg-steel-green/15 text-foreground">
      <ThumbsUp />
      {t("planning.feedback.suitable")}
    </Badge>
  ) : (
    <Badge variant="destructive">
      <ThumbsDown />
      {t("planning.feedback.unsuitable")}
    </Badge>
  )
}
