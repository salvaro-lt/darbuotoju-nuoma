"use client"
import { StaffingTeamsPermissions } from "@digimuza/staffing/teams/manifest"
import { clientDraftText, type RankedCandidate, type TeamPick } from "@digimuza/staffing/teams/matching"
import { Can, useCan } from "@digimuza/system-core/react"
import { useMutation, useQuery } from "convex/react"
import type { FunctionReturnType } from "convex/server"
import { AlertTriangle, ArrowLeft, Car, CheckCircle2, Copy, ExternalLink, RotateCcw, Sparkles, X } from "lucide-react"
import Link from "next/link"
import { useState } from "react"
import { toast } from "sonner"
import { useAction } from "@/components/app/use-action"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { useT } from "@/lib/i18n/client"
import type { MessageKey } from "@/lib/i18n/messages"
import { NativeSelect, Period, projectHref, workerHref } from "../../staffing/_components/staffing-ui"
import { useTeamsEnabled } from "./teams-nav"
import { RequestStatusBadge, TeamCount, WarningBadge } from "./teams-ui"

type Data = NonNullable<FunctionReturnType<typeof api.teams.getRequest>>

export function TeamProposal({ requestId }: { requestId: string }) {
  const { t } = useT()
  const enabled = useTeamsEnabled()
  const data = useQuery(api.teams.getRequest, enabled ? { requestId: requestId as Id<"staffing_teams_requests"> } : "skip")
  if (!enabled) return <p className="text-sm text-muted-foreground">{t("teams.disabled")}</p>
  if (data === undefined) return <Skeleton className="h-96 w-full rounded-xl" />
  if (data === null) return <p className="text-sm text-muted-foreground">{t("staffing.common.notFound")}</p>
  return <ProposalView data={data} />
}

function ProposalView({ data }: { data: Data }) {
  const { t, locale } = useT()
  const { request: r, proposal: p } = data
  const canWrite = useCan(StaffingTeamsPermissions.requestWrite)
  const save = useMutation(api.teams.saveSelection)
  const confirm = useMutation(api.teams.confirmTeam)
  const cancel = useMutation(api.teams.cancelRequest)
  const { run, busy } = useAction()
  const [busyIds, setBusyIds] = useState<string[]>([])
  const locked = r.status === "confirmed" || r.status === "cancelled"
  const editable = canWrite && !locked
  const id = r.id

  const persist = (selection: TeamPick[] | null) => run(() => save({ requestId: id, selection: selection as never }))
  const replace = (lineIndex: number, out: string | null, inId: string | null) => {
    const next = p.selection.filter((s) => !(s.lineIndex === lineIndex && s.workerId === out))
    if (inId) {
      const cand = p.lines[lineIndex]!.ranked.find((c) => c.workerId === inId)
      const old = p.selection.find((s) => s.lineIndex === lineIndex && s.workerId === out)
      next.push({ lineIndex, workerId: inId, isDriver: Boolean(old?.isDriver && cand?.canDrive) })
    }
    return persist(next)
  }
  const toggleDriver = (pick: TeamPick) => persist(p.selection.map((s) => (s === pick ? { ...s, isDriver: !s.isDriver } : s)))

  async function doConfirm(status: "proposed" | "confirmed") {
    setBusyIds([])
    await run(() => confirm({ requestId: id, status }), {
      success: status === "confirmed" ? t("teams.detail.confirmed") : t("teams.detail.reserved"),
      onError: (e) => {
        if (e.code === "CONFLICT" && e.fields.length) {
          setBusyIds(e.fields)
          toast.warning(t("teams.detail.busy"))
        }
      },
    })
  }

  const picked = new Set(p.selection.map((s) => s.workerId))
  const draft = (lang: "lt" | "en") => clientDraftText(p.draftInput, lang)

  return (
    <div className="grid gap-6">
      <div>
        <Button variant="ghost" size="sm" asChild className="-ml-2 mb-2">
          <Link href="/app/teams">
            <ArrowLeft />
            {t("teams.detail.back")}
          </Link>
        </Button>
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-stencil-title text-[2.1rem] sm:text-[2.4rem]">{r.clientName}</h1>
              <RequestStatusBadge status={r.status} />
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {r.projectLabel} · {r.site}, {r.country} · <Period from={r.startDate} to={r.endDate} />
              {r.languages.length > 0 && <> · {r.languages.join(", ").toUpperCase()}</>}
            </p>
            <div className="mt-2 flex flex-wrap gap-3 text-sm">
              {r.projectId ? (
                <Link href={projectHref(r.projectId)} className="inline-flex items-center gap-1 text-primary hover:underline">
                  <ExternalLink className="size-3.5" />
                  {t("teams.detail.project")} {r.projectCode}
                </Link>
              ) : (
                <span className="text-muted-foreground">{t("teams.detail.newProject")}</span>
              )}
              {r.crmRecordId && (
                <Link href={`/app/crm/request/${r.crmRecordId}`} className="inline-flex items-center gap-1 text-primary hover:underline">
                  <ExternalLink className="size-3.5" />
                  {t("teams.detail.crm")}
                </Link>
              )}
            </div>
            {r.notes && <p className="mt-3 max-w-[70ch] text-sm">{r.notes}</p>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="mr-2 text-right">
              <div className="text-xs text-muted-foreground">{t("teams.detail.teamOf")}</div>
              <div className="text-xl">
                <TeamCount picked={p.selection.length} needed={r.needed} />
              </div>
            </div>
            {editable && (
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => void run(() => cancel({ requestId: id }), { success: t("teams.detail.cancelled") })}>
                {t("teams.detail.cancel")}
              </Button>
            )}
          </div>
        </header>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="grid gap-4">
          {locked && r.status === "confirmed" && (
            <p className="flex items-center gap-2 rounded-lg border border-steel-green/60 bg-steel-green/15 px-3 py-2 text-sm text-steel-green dark:border-steel-green/60 dark:bg-steel-green/20 dark:text-steel-green">
              <CheckCircle2 className="size-4" />
              {t("teams.detail.readOnly")}
            </p>
          )}
          {r.lines.map((line, i) => {
            const picks = p.selection.filter((s) => s.lineIndex === i)
            const ranked = p.lines[i]?.ranked ?? []
            const byId = new Map(ranked.map((c) => [c.workerId, c]))
            const alternatives = ranked.filter((c) => !picked.has(c.workerId))
            return (
              <Card key={i}>
                <CardHeader>
                  <CardTitle className="flex flex-wrap items-center gap-2">
                    {locale === "en" ? line.tradeNameEn : line.tradeName}
                    <TeamCount picked={picks.length} needed={line.count} />
                  </CardTitle>
                  <CardDescription className="flex flex-wrap gap-1.5">
                    {line.drivers > 0 && (
                      <Badge variant="outline" className="font-normal">
                        <Car /> {line.drivers} {t("teams.detail.driversNeeded")}
                      </Badge>
                    )}
                    {line.minLevel && (
                      <Badge variant="outline" className="font-normal">
                        ≥ {t(`staffing.level.${line.minLevel}` as MessageKey)}
                      </Badge>
                    )}
                    {line.certificateNames.map((c) => (
                      <Badge key={c} variant="outline" className="font-normal">
                        {c}
                      </Badge>
                    ))}
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-2">
                  {picks.length === 0 && <p className="text-sm text-muted-foreground">{t("teams.detail.noneFound")}</p>}
                  {picks.map((pick) => (
                    <PickRow
                      key={pick.workerId}
                      pick={pick}
                      cand={byId.get(pick.workerId) ?? null}
                      name={p.workerNames[pick.workerId] ?? "?"}
                      alternatives={alternatives}
                      certificateNames={p.certificateNames}
                      editable={editable}
                      busy={busy}
                      flagged={busyIds.includes(pick.workerId)}
                      onSwap={(inId) => void replace(i, pick.workerId, inId)}
                      onRemove={() => void replace(i, pick.workerId, null)}
                      onDriver={() => void toggleDriver(pick)}
                    />
                  ))}
                  {editable && alternatives.length > 0 && (
                    <NativeSelect aria-label={t("teams.detail.add")} value="" onChange={(v) => v && void replace(i, null, v)} className="mt-1 w-full sm:w-auto">
                      <option value="">{t("teams.detail.add")}</option>
                      <CandidateOptions list={alternatives} />
                    </NativeSelect>
                  )}
                </CardContent>
              </Card>
            )
          })}

          {editable && (
            <div className="flex flex-wrap items-center gap-2">
              <Can permission={StaffingTeamsPermissions.teamConfirm}>
                <Button disabled={busy || p.selection.length === 0} onClick={() => void doConfirm("confirmed")}>
                  <CheckCircle2 />
                  {t("teams.detail.confirm")}
                </Button>
                {r.status === "open" && (
                  <Button variant="outline" disabled={busy || p.selection.length === 0} onClick={() => void doConfirm("proposed")}>
                    {t("teams.detail.reserve")}
                  </Button>
                )}
              </Can>
              {p.edited ? (
                <Button variant="ghost" size="sm" disabled={busy} onClick={() => void persist(null)}>
                  <RotateCcw />
                  {t("teams.detail.reset")}
                </Button>
              ) : (
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                  <Sparkles className="size-3.5" />
                  {t("teams.detail.auto")}
                </span>
              )}
            </div>
          )}
        </div>

        <div className="grid gap-4 lg:sticky lg:top-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle className="size-4 text-marking-foreground dark:text-marking" />
                {t("teams.gaps.title")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {p.gaps.length === 0 ? (
                <p className="flex items-center gap-2 text-sm text-steel-green dark:text-steel-green">
                  <CheckCircle2 className="size-4" />
                  {t("teams.gaps.none")}
                </p>
              ) : (
                <ul className="grid gap-2 text-sm">
                  {(locale === "en" ? p.gapText.en : p.gapText.lt).map((g, k) => (
                    <li key={k} className="flex gap-2">
                      <span className={`mt-1.5 size-1.5 shrink-0 rounded-full ${p.gaps[k]!.kind === "people" || p.gaps[k]!.kind === "busy" ? "bg-destructive/80" : "bg-marking"}`} aria-hidden />
                      {g}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
          {r.status !== "cancelled" && <DraftCard data={data} draft={draft} />}
        </div>
      </div>
    </div>
  )
}

function CandidateOptions({ list }: { list: RankedCandidate[] }) {
  const { t } = useT()
  return (
    <>
      {list.map((c) => (
        <option key={c.workerId} value={c.workerId}>
          {c.eligible ? "" : "⚠ "}
          {c.name} · {t(`staffing.level.${c.level}` as MessageKey)}
          {c.canDrive ? " · B" : ""}
          {c.previousClientAssignments ? ` · ★${c.previousClientAssignments}` : ""} · {c.score}
          {c.eligible ? "" : ` (${t("teams.detail.unfit")})`}
        </option>
      ))}
    </>
  )
}

function PickRow(props: {
  pick: TeamPick
  cand: RankedCandidate | null
  name: string
  alternatives: RankedCandidate[]
  certificateNames: Record<string, string>
  editable: boolean
  busy: boolean
  flagged: boolean
  onSwap: (id: string) => void
  onRemove: () => void
  onDriver: () => void
}) {
  const { t } = useT()
  const { pick, cand } = props
  const warnings = cand?.warnings ?? []
  return (
    <div className={`grid gap-2 rounded-lg border p-3 sm:grid-cols-[minmax(0,1fr)_auto] ${props.flagged || !cand ? "border-destructive/60 bg-destructive/10 dark:border-destructive/60 dark:bg-destructive/20" : ""}`}>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <Link href={workerHref(pick.workerId)} className="font-medium hover:underline">
            {props.name}
          </Link>
          {cand && <span className="text-xs text-muted-foreground">{t(`staffing.level.${cand.level}` as MessageKey)}</span>}
          {cand && cand.previousClientAssignments > 0 && (
            <Badge variant="secondary" className="font-normal">
              ★ {t("teams.detail.returning")} ×{cand.previousClientAssignments}
            </Badge>
          )}
          {cand && cand.languageMatch.length > 0 && (
            <Badge variant="secondary" className="font-normal uppercase">
              {cand.languageMatch.join(" ")}
            </Badge>
          )}
          {cand && (
            <span className="text-xs tabular-nums text-muted-foreground" title={t("teams.detail.score")}>
              {cand.score}
            </span>
          )}
        </div>
        {(warnings.length > 0 || !cand) && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {!cand && <Badge variant="destructive">{t("teams.detail.notFree")}</Badge>}
            {warnings.map((w, k) => (
              <WarningBadge key={k} w={w} certificateNames={props.certificateNames} />
            ))}
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2 sm:justify-end">
        {cand?.canDrive && (
          <label className="inline-flex items-center gap-1.5 text-sm">
            <Checkbox checked={pick.isDriver} disabled={!props.editable || props.busy} onCheckedChange={props.onDriver} />
            <Car className="size-3.5" />
            {t("teams.detail.driver")}
          </label>
        )}
        {props.editable && props.alternatives.length > 0 && (
          <NativeSelect aria-label={t("teams.detail.swap")} value="" onChange={(v) => v && props.onSwap(v)} className="max-w-48">
            <option value="">{t("teams.detail.swap")}…</option>
            <CandidateOptions list={props.alternatives} />
          </NativeSelect>
        )}
        {props.editable && (
          <Button variant="ghost" size="icon" aria-label={t("teams.detail.remove")} disabled={props.busy} onClick={props.onRemove}>
            <X />
          </Button>
        )}
      </div>
    </div>
  )
}

function DraftCard({ data, draft }: { data: Data; draft: (lang: "lt" | "en") => string }) {
  const { t } = useT()
  const [lang, setLang] = useState<"lt" | "en">("en")
  const send = useMutation(api.teams.requestClientDraft)
  const { run, busy } = useAction()
  const text = draft(lang)
  const d = data.request.draft
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("teams.draft.title")}</CardTitle>
        <CardDescription>{t("teams.draft.lead")}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <div className="flex items-center justify-between gap-2">
          <Tabs value={lang} onValueChange={(v) => setLang(v as "lt" | "en")}>
            <TabsList>
              <TabsTrigger value="en">EN</TabsTrigger>
              <TabsTrigger value="lt">LT</TabsTrigger>
            </TabsList>
          </Tabs>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              void navigator.clipboard.writeText(text).then(
                () => toast.success(t("teams.draft.copied")),
                () => undefined,
              )
            }
          >
            <Copy />
            {t("teams.draft.copy")}
          </Button>
        </div>
        <Textarea readOnly value={text} rows={14} className="font-mono text-xs leading-relaxed" />
        <Can permission={StaffingTeamsPermissions.draftSend}>
          <div className="grid gap-1.5 border-t pt-3">
            <Button variant="secondary" disabled={busy || d?.status === "pending"} onClick={() => void run(() => send({ requestId: data.request.id }), { success: t("teams.draft.requested") })}>
              <Sparkles />
              {t("teams.draft.ai")}
            </Button>
            <p className="text-xs text-muted-foreground">{t("teams.draft.aiLead")}</p>
            {d && (
              <p className={`text-xs ${d.status === "failed" ? "text-destructive" : d.status === "sent" ? "text-steel-green dark:text-steel-green" : "text-muted-foreground"}`}>
                {t(`teams.draft.status.${d.status}` as MessageKey)}
                {d.status === "sent" && d.to ? ` ${d.to}` : ""}
                {d.error ? ` (${d.error})` : ""}
              </p>
            )}
          </div>
        </Can>
      </CardContent>
    </Card>
  )
}
