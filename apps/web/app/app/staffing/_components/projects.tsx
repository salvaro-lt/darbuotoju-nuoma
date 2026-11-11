"use client"
import type { AssignmentStatus, ProjectStatus, ProjectView, TeamMember } from "@digimuza/staffing"
import { ASSIGNMENT_STATUSES, PROJECT_STATUSES } from "@digimuza/staffing/pure"
import { StaffingPermissions } from "@digimuza/staffing/manifest"
import { Can, useCan } from "@digimuza/system-core/react"
import { useMutation, useQuery } from "convex/react"
import { ArrowLeft, FolderKanban, Pencil, Plus, Trash2 } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState, type FormEvent } from "react"
import { EmptyState } from "@/components/app/empty-state"
import { PageHeader } from "@/components/app/page-header"
import { useAction } from "@/components/app/use-action"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { useT } from "@/lib/i18n/client"
import type { MessageKey } from "@/lib/i18n/messages"
import { RatesEditor, type RateRow } from "./rates-editor"
import {
  AssignmentStatusBadge,
  centsToEur,
  CertBadge,
  ConfirmDelete,
  Detail,
  Disabled,
  eurToCents,
  NativeSelect,
  Period,
  projectHref,
  ProjectStatusBadge,
  useStaffingEnabled,
  useTradeName,
  useTrades,
  workerHref,
} from "./staffing-ui"

// ---------------------------------------------------------------- list

export function ProjectsList() {
  const { t } = useT()
  const enabled = useStaffingEnabled()
  const [status, setStatus] = useState<"" | ProjectStatus>("")
  const projects = useQuery(api.staffing.listProjects, enabled ? (status ? { status } : {}) : "skip")
  const [creating, setCreating] = useState(false)
  if (!enabled) return <Disabled />
  const newButton = (
    <Can permission={StaffingPermissions.projectCreate}>
      <Button size="sm" onClick={() => setCreating(true)}>
        <Plus />
        {t("staffing.projects.new")}
      </Button>
    </Can>
  )
  return (
    <div>
      <PageHeader title={t("staffing.projects.title")} lead={t("staffing.projects.lead")} actions={newButton} />
      <div className="mb-3 flex gap-2">
        <NativeSelect aria-label={t("staffing.common.status")} value={status} onChange={(v) => setStatus(v as ProjectStatus | "")}>
          <option value="">{t("staffing.projects.anyStatus")}</option>
          {PROJECT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`staffing.projectStatus.${s}` as MessageKey)}
            </option>
          ))}
        </NativeSelect>
      </div>
      {!projects ? (
        <Skeleton className="h-64 w-full rounded-xl" />
      ) : projects.length === 0 ? (
        <EmptyState icon={<FolderKanban />} title={t("staffing.projects.empty")} body={t("staffing.projects.emptyBody")} action={newButton} />
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="px-4">{t("staffing.common.code")}</TableHead>
                <TableHead>{t("staffing.common.name")}</TableHead>
                <TableHead>{t("staffing.projects.client")}</TableHead>
                <TableHead>{t("staffing.projects.site")}</TableHead>
                <TableHead>{t("staffing.projects.period")}</TableHead>
                <TableHead>{t("staffing.common.status")}</TableHead>
                <TableHead className="text-right">{t("staffing.projects.headcount")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {projects.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="px-4 font-mono text-xs">{p.code}</TableCell>
                  <TableCell className="font-medium">
                    <Link href={projectHref(p.id)} className="hover:underline">
                      {p.name}
                    </Link>
                  </TableCell>
                  <TableCell>{p.clientName}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    {p.city}, {p.country}
                  </TableCell>
                  <TableCell>
                    <Period from={p.startDate} to={p.endDate} />
                  </TableCell>
                  <TableCell>
                    <ProjectStatusBadge status={p.status} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{p.headcountToday}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {creating && <ProjectDialog project={null} onClose={() => setCreating(false)} />}
    </div>
  )
}

function ProjectDialog({ project, onClose }: { project: ProjectView | null; onClose: () => void }) {
  const { t } = useT()
  const router = useRouter()
  const clients = useQuery(api.staffing.listClients, { kind: "client" }) ?? []
  const create = useMutation(api.staffing.createProject)
  const update = useMutation(api.staffing.updateProject)
  const { run, busy } = useAction()
  const [f, setF] = useState({
    clientId: (project?.clientId ?? "") as string,
    name: project?.name ?? "",
    code: project?.code ?? "",
    country: project?.country ?? "",
    city: project?.city ?? "",
    siteAddress: project?.siteAddress ?? "",
    startDate: project?.startDate ?? "",
    endDate: project?.endDate ?? "",
    status: (project?.status ?? "draft") as ProjectStatus,
    notes: project?.notes ?? "",
  })
  const [rates, setRates] = useState<RateRow[]>(project?.rates.map((r) => ({ tradeId: r.tradeId, eur: centsToEur(r.hourlyRateCents) })) ?? [])
  const set = (k: keyof typeof f) => (v: string) => setF((s) => ({ ...s, [k]: v }))

  async function submit(e: FormEvent) {
    e.preventDefault()
    const args = {
      clientId: f.clientId as Id<"staffing_clients">,
      name: f.name,
      code: f.code,
      country: f.country,
      city: f.city,
      siteAddress: f.siteAddress || undefined,
      startDate: f.startDate,
      endDate: f.endDate || undefined,
      status: f.status,
      ...(project?.coordinatorUserId ? { coordinatorUserId: project.coordinatorUserId } : {}),
      rates: rates.filter((r) => r.tradeId && r.eur).map((r) => ({ tradeId: r.tradeId as Id<"staffing_trades">, hourlyRateCents: eurToCents(r.eur) })),
      notes: f.notes,
    }
    if (project) {
      if (await run(() => update({ projectId: project.id, ...args }), { success: t("staffing.common.saved") })) onClose()
    } else {
      const res = await run(() => create(args), { success: t("staffing.common.created") })
      if (res) {
        onClose()
        router.push(projectHref(res.id))
      }
    }
  }

  const text = (k: keyof typeof f, label: MessageKey, props: { required?: boolean; type?: string } = {}) => (
    <Field>
      <FieldLabel htmlFor={`p-${k}`}>{t(label)}</FieldLabel>
      <Input id={`p-${k}`} value={f[k]} onChange={(e) => set(k)(e.target.value)} {...props} />
    </Field>
  )

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <form onSubmit={(e) => void submit(e)} className="grid gap-5">
          <DialogHeader>
            <DialogTitle>{project ? t("staffing.projects.edit") : t("staffing.projects.new")}</DialogTitle>
          </DialogHeader>
          <FieldGroup className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="p-client">{t("staffing.projects.client")}</FieldLabel>
              <NativeSelect id="p-client" required value={f.clientId} onChange={set("clientId")}>
                <option value="" />
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            {text("code", "staffing.common.code", { required: true })}
            {text("name", "staffing.common.name", { required: true })}
            <Field>
              <FieldLabel htmlFor="p-status">{t("staffing.common.status")}</FieldLabel>
              <NativeSelect id="p-status" value={f.status} onChange={set("status")}>
                {PROJECT_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {t(`staffing.projectStatus.${s}` as MessageKey)}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            {text("country", "staffing.common.country", { required: true })}
            {text("city", "staffing.common.city", { required: true })}
            {text("startDate", "staffing.common.from", { required: true, type: "date" })}
            {text("endDate", "staffing.common.to", { type: "date" })}
          </FieldGroup>
          {text("siteAddress", "staffing.projects.siteAddress")}
          <Field>
            <FieldLabel>{t("staffing.common.rates")}</FieldLabel>
            <RatesEditor rows={rates} onChange={setRates} />
          </Field>
          <Field>
            <FieldLabel htmlFor="p-notes">{t("staffing.common.notes")}</FieldLabel>
            <Textarea id="p-notes" rows={2} value={f.notes} onChange={(e) => set("notes")(e.target.value)} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t("staffing.common.cancel")}
            </Button>
            <Button type="submit" disabled={busy}>
              {t("staffing.common.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------- project page

export function ProjectDetailView({ projectId }: { projectId: string }) {
  const { t } = useT()
  const enabled = useStaffingEnabled()
  const router = useRouter()
  const tradeName = useTradeName()
  const trades = useTrades() ?? []
  const detail = useQuery(api.staffing.getProject, enabled ? { projectId: projectId as Id<"staffing_projects"> } : "skip")
  const del = useMutation(api.staffing.deleteProject)
  const { run, busy } = useAction()
  const canTeam = useCan(StaffingPermissions.assignmentRead)
  const [editing, setEditing] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [adding, setAdding] = useState(false)
  const [changing, setChanging] = useState<TeamMember | null>(null)
  if (!enabled) return <Disabled />
  if (detail === undefined) return <Skeleton className="h-96 w-full rounded-xl" />
  if (detail === null) return <p className="text-sm text-muted-foreground">{t("staffing.common.notFound")}</p>
  const p = detail.project
  const open = p.status === "draft" || p.status === "active"

  return (
    <div className="grid gap-6">
      <div>
        <Button variant="ghost" size="sm" asChild className="-ml-2 mb-2">
          <Link href="/app/staffing/projects">
            <ArrowLeft />
            {t("staffing.nav.projects")}
          </Link>
        </Button>
        <PageHeader
          title={`${p.code} · ${p.name}`}
          lead={`${p.clientName} · ${p.city}, ${p.country}`}
          actions={
            <>
              <ProjectStatusBadge status={p.status} />
              <Can permission={StaffingPermissions.projectUpdate}>
                <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                  <Pencil />
                  {t("staffing.common.edit")}
                </Button>
              </Can>
              <Can permission={StaffingPermissions.projectDelete}>
                <Button size="sm" variant="ghost" aria-label={t("staffing.common.delete")} onClick={() => setDeleting(true)}>
                  <Trash2 />
                </Button>
              </Can>
            </>
          }
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_2fr]">
        <Card className="py-4">
          <CardContent className="px-4">
            <dl className="divide-y">
              <Detail label={t("staffing.projects.period")}>
                <Period from={p.startDate} to={p.endDate} />
              </Detail>
              <Detail label={t("staffing.projects.siteAddress")}>{p.siteAddress ?? t("staffing.common.none")}</Detail>
              <Detail label={t("staffing.projects.headcount")}>{p.headcountToday}</Detail>
              <Detail label={t("staffing.common.rates")}>
                {p.rates.length === 0
                  ? t("staffing.common.none")
                  : p.rates.map((r) => {
                      const tr = trades.find((x) => x.id === r.tradeId)
                      return (
                        <div key={r.tradeId} className="flex justify-between gap-2">
                          <span>{tr ? tradeName(tr) : "?"}</span>
                          <span className="tabular-nums">{centsToEur(r.hourlyRateCents)}</span>
                        </div>
                      )
                    })}
              </Detail>
              {p.notes && <Detail label={t("staffing.common.notes")}>{p.notes}</Detail>}
            </dl>
          </CardContent>
        </Card>

        {canTeam && (
          <Card className="py-4">
            <CardHeader className="flex flex-row items-center justify-between px-4">
              <CardTitle className="text-base">
                {t("staffing.team.title")} <span className="text-muted-foreground tabular-nums">({detail.team.length})</span>
              </CardTitle>
              {open && (
                <Can permission={StaffingPermissions.assignmentCreate}>
                  <Button size="sm" onClick={() => setAdding(true)}>
                    <Plus />
                    {t("staffing.team.add")}
                  </Button>
                </Can>
              )}
            </CardHeader>
            <CardContent className="px-0">
              {detail.team.length === 0 ? (
                <p className="px-4 text-sm text-muted-foreground">{t("staffing.team.empty")}</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="px-4">{t("staffing.team.worker")}</TableHead>
                      <TableHead>{t("staffing.team.trade")}</TableHead>
                      <TableHead>{t("staffing.projects.period")}</TableHead>
                      <TableHead>{t("staffing.common.status")}</TableHead>
                      <TableHead>{t("staffing.workers.col.certs")}</TableHead>
                      <TableHead className="w-12" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {detail.team.map((m) => (
                      <TableRow key={m.id} className={m.status === "ended" ? "text-muted-foreground" : undefined}>
                        <TableCell className="px-4 font-medium">
                          <Link href={workerHref(m.workerId)} className="hover:underline">
                            {m.worker.fullName}
                          </Link>
                          {m.isDriver && <span className="ml-1 text-xs text-muted-foreground">· {t("staffing.worker.driver")}</span>}
                        </TableCell>
                        <TableCell>{m.tradeName}</TableCell>
                        <TableCell>
                          <Period from={m.startDate} to={m.endDate} />
                        </TableCell>
                        <TableCell>
                          <AssignmentStatusBadge status={m.status} />
                        </TableCell>
                        <TableCell>
                          <CertBadge status={m.worker.certStatus} />
                        </TableCell>
                        <TableCell>
                          <Can permission={StaffingPermissions.assignmentUpdate}>
                            <Button variant="ghost" size="icon-sm" aria-label={t("staffing.team.editAssignment")} onClick={() => setChanging(m)}>
                              <Pencil />
                            </Button>
                          </Can>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      {editing && <ProjectDialog project={p} onClose={() => setEditing(false)} />}
      {adding && <AddAssignmentDialog project={p} onClose={() => setAdding(false)} />}
      {changing && <AssignmentDialog member={changing} onClose={() => setChanging(null)} />}
      <ConfirmDelete
        open={deleting}
        title={t("staffing.common.confirmDelete")}
        body={t("staffing.projects.deleteBody")}
        busy={busy}
        onCancel={() => setDeleting(false)}
        onConfirm={() =>
          void run(() => del({ projectId: p.id }), { success: t("staffing.common.deleted") }).then((r) => {
            setDeleting(false)
            if (r) router.push("/app/staffing/projects")
          })
        }
      />
    </div>
  )
}

/** Pick a trade and a period, then a worker free for the whole period. */
function AddAssignmentDialog({ project, onClose }: { project: ProjectView; onClose: () => void }) {
  const { t } = useT()
  const trades = useTrades() ?? []
  const tradeName = useTradeName()
  const create = useMutation(api.staffing.createAssignment)
  const { run, busy } = useAction()
  const [tradeId, setTradeId] = useState<string>(project.rates[0]?.tradeId ?? "")
  const [from, setFrom] = useState(project.startDate > new Date().toISOString().slice(0, 10) ? project.startDate : new Date().toISOString().slice(0, 10))
  const [to, setTo] = useState(project.endDate ?? "")
  const [validCerts, setValidCerts] = useState(true)
  const [workerId, setWorkerId] = useState("")
  const [status, setStatus] = useState<AssignmentStatus>("proposed")
  const [isDriver, setIsDriver] = useState(false)
  const available = useQuery(
    api.staffing.findAvailableWorkers,
    tradeId && from && (!to || to >= from) ? { from, ...(to ? { to } : {}), trades: [tradeId as Id<"staffing_trades">], ...(validCerts ? { requireValidCertsOn: to || from } : {}) } : "skip",
  )

  async function submit(e: FormEvent) {
    e.preventDefault()
    const res = await run(
      () =>
        create({
          projectId: project.id,
          workerId: workerId as Id<"staffing_workers">,
          tradeId: tradeId as Id<"staffing_trades">,
          startDate: from,
          endDate: to || undefined,
          status,
          isDriver,
        }),
      { success: t("staffing.common.created") },
    )
    if (res) onClose()
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <form onSubmit={(e) => void submit(e)} className="grid gap-5">
          <DialogHeader>
            <DialogTitle>{t("staffing.team.add")}</DialogTitle>
            <DialogDescription>
              {project.code} · {project.name}
            </DialogDescription>
          </DialogHeader>
          <FieldGroup className="grid gap-4 sm:grid-cols-3">
            <Field>
              <FieldLabel htmlFor="a-trade">{t("staffing.team.trade")}</FieldLabel>
              <NativeSelect id="a-trade" required value={tradeId} onChange={setTradeId}>
                <option value="" />
                {trades.map((tr) => (
                  <option key={tr.id} value={tr.id}>
                    {tradeName(tr)}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field>
              <FieldLabel htmlFor="a-from">{t("staffing.common.from")}</FieldLabel>
              <Input id="a-from" type="date" required value={from} onChange={(e) => setFrom(e.target.value)} />
            </Field>
            <Field>
              <FieldLabel htmlFor="a-to">{t("staffing.common.to")}</FieldLabel>
              <Input id="a-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </Field>
          </FieldGroup>
          <Label className="flex items-center gap-2 text-sm font-normal">
            <Checkbox checked={validCerts} onCheckedChange={(v) => setValidCerts(v === true)} />
            {t("staffing.team.validCerts")}
          </Label>
          <Field>
            <FieldLabel>{t("staffing.team.available")}</FieldLabel>
            <div className="max-h-64 overflow-y-auto rounded-lg border">
              {!available ? (
                <Skeleton className="h-24 w-full" />
              ) : available.length === 0 ? (
                <p className="p-3 text-sm text-muted-foreground">{t("staffing.team.noneAvailable")}</p>
              ) : (
                <ul className="divide-y">
                  {available.map((w) => (
                    <li key={w.id}>
                      <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-muted/50 has-checked:bg-muted">
                        <input type="radio" name="worker" value={w.id} checked={workerId === w.id} onChange={() => setWorkerId(w.id)} required className="accent-primary" />
                        <span className="flex-1 font-medium">{w.fullName}</span>
                        <span className="text-muted-foreground">{w.matchingTrades.map((x) => t(`staffing.level.${x.level}` as MessageKey)).join(", ")}</span>
                        <span className="w-8 text-muted-foreground">{w.nationality}</span>
                        <CertBadge status={w.requiredCertStatus} />
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Field>
          <div className="flex flex-wrap items-center gap-4">
            <NativeSelect aria-label={t("staffing.common.status")} value={status} onChange={(v) => setStatus(v as AssignmentStatus)}>
              {(["proposed", "confirmed", "active"] as const).map((s) => (
                <option key={s} value={s}>
                  {t(`staffing.assignmentStatus.${s}` as MessageKey)}
                </option>
              ))}
            </NativeSelect>
            <Label className="flex items-center gap-2 text-sm font-normal">
              <Checkbox checked={isDriver} onCheckedChange={(v) => setIsDriver(v === true)} />
              {t("staffing.team.isDriver")}
            </Label>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t("staffing.common.cancel")}
            </Button>
            <Button type="submit" disabled={busy || !workerId}>
              {t("staffing.common.add")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function AssignmentDialog({ member, onClose }: { member: TeamMember; onClose: () => void }) {
  const { t } = useT()
  const update = useMutation(api.staffing.updateAssignment)
  const del = useMutation(api.staffing.deleteAssignment)
  const canDelete = useCan(StaffingPermissions.assignmentDelete)
  const { run, busy } = useAction()
  const [from, setFrom] = useState(member.startDate)
  const [to, setTo] = useState(member.endDate ?? "")
  const [status, setStatus] = useState<AssignmentStatus>(member.status)
  const [isDriver, setIsDriver] = useState(member.isDriver)
  const [notes, setNotes] = useState(member.notes)

  async function submit(e: FormEvent) {
    e.preventDefault()
    const res = await run(() => update({ assignmentId: member.id, startDate: from, endDate: to || null, status, isDriver, notes }), { success: t("staffing.common.saved") })
    if (res) onClose()
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={(e) => void submit(e)} className="grid gap-5">
          <DialogHeader>
            <DialogTitle>{t("staffing.team.editAssignment")}</DialogTitle>
            <DialogDescription>
              {member.worker.fullName} · {member.tradeName}
            </DialogDescription>
          </DialogHeader>
          <FieldGroup className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="e-from">{t("staffing.common.from")}</FieldLabel>
              <Input id="e-from" type="date" required value={from} onChange={(e) => setFrom(e.target.value)} />
            </Field>
            <Field>
              <FieldLabel htmlFor="e-to">{t("staffing.common.to")}</FieldLabel>
              <Input id="e-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </Field>
            <Field>
              <FieldLabel htmlFor="e-status">{t("staffing.common.status")}</FieldLabel>
              <NativeSelect id="e-status" value={status} onChange={(v) => setStatus(v as AssignmentStatus)}>
                {ASSIGNMENT_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {t(`staffing.assignmentStatus.${s}` as MessageKey)}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Label className="flex items-center gap-2 self-end pb-2 text-sm font-normal">
              <Checkbox checked={isDriver} onCheckedChange={(v) => setIsDriver(v === true)} />
              {t("staffing.team.isDriver")}
            </Label>
          </FieldGroup>
          <Field>
            <FieldLabel htmlFor="e-notes">{t("staffing.common.notes")}</FieldLabel>
            <Textarea id="e-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
          <DialogFooter className="sm:justify-between">
            {canDelete ? (
              <Button type="button" variant="ghost" className="text-destructive" disabled={busy} onClick={() => void run(() => del({ assignmentId: member.id }), { success: t("staffing.common.deleted") }).then((r) => r && onClose())}>
                <Trash2 />
                {t("staffing.common.delete")}
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={onClose}>
                {t("staffing.common.cancel")}
              </Button>
              <Button type="submit" disabled={busy}>
                {t("staffing.common.save")}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
