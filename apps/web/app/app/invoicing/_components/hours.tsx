"use client"
import { StaffingInvoicingPermissions as P } from "@digimuza/staffing/invoicing/manifest"
import { Can } from "@digimuza/system-core/react"
import { useMutation, useQuery } from "convex/react"
import { Clock, Plus, Trash2 } from "lucide-react"
import Link from "next/link"
import { useState, type FormEvent } from "react"
import { EmptyState } from "@/components/app/empty-state"
import { PageHeader } from "@/components/app/page-header"
import { useAction } from "@/components/app/use-action"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { useT } from "@/lib/i18n/client"
import { NativeSelect } from "../../staffing/_components/staffing-ui"
import { fmtHours, InvoicingDisabled, InvoicingTabs, useInvoicingEnabled } from "./invoicing-ui"

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10)

export function HoursView() {
  const { t, locale } = useT()
  const enabled = useInvoicingEnabled()
  const projects = useQuery(api.staffing.listProjects, enabled ? {} : "skip")
  const [picked, setProjectId] = useState("")
  // Default: the first active project.
  const projectId = picked || ((projects?.find((p) => p.status === "active") ?? projects?.[0])?.id ?? "")
  const [range, setRange] = useState({ from: daysAgo(14), to: daysAgo(0) })
  const data = useQuery(api.invoicing.listHours, enabled && projectId ? { projectId: projectId as Id<"staffing_projects">, from: range.from, to: range.to } : "skip")
  const del = useMutation(api.invoicing.deleteHours)
  const { run, busy } = useAction()
  const [adding, setAdding] = useState(false)

  if (!enabled) return <InvoicingDisabled />
  const rows = data?.rows ?? []
  const sum = rows.reduce((s, r) => ({ regular: s.regular + r.regular, overtime: s.overtime + r.overtime, weekend: s.weekend + r.weekend }), { regular: 0, overtime: 0, weekend: 0 })

  return (
    <div>
      <PageHeader
        title={t("invoicing.hours.title")}
        lead={t("invoicing.hours.lead")}
        actions={
          <Can permission={P.invoiceManage}>
            <Button size="sm" disabled={!projectId} onClick={() => setAdding(true)}>
              <Plus />
              {t("invoicing.hours.add")}
            </Button>
          </Can>
        }
      />
      <InvoicingTabs />
      <Alert className="mb-4">
        <AlertDescription>
          {t("invoicing.hours.adapterNote")}
          {!!data?.unapprovedWeeks.length && (
            <span className="mt-1 block text-marking-foreground dark:text-marking">
              {t("invoicing.hours.unapproved").replace("{weeks}", data.unapprovedWeeks.join(", "))}{" "}
              <Link href={`/app/timesheets/${projectId}`} className="underline">
                {t("invoicing.hours.openTimesheets")}
              </Link>
            </span>
          )}
        </AlertDescription>
      </Alert>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <NativeSelect aria-label={t("invoicing.col.project")} value={projectId} onChange={setProjectId}>
          {projects?.map((p) => (
            <option key={p.id} value={p.id}>
              {p.code} · {p.name}
            </option>
          ))}
        </NativeSelect>
        <Input type="date" className="w-auto" aria-label={t("invoicing.from")} value={range.from} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} />
        <Input type="date" className="w-auto" aria-label={t("invoicing.to")} value={range.to} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} />
      </div>
      {!data ? (
        <Skeleton className="h-64 w-full rounded-xl" />
      ) : rows.length === 0 ? (
        <EmptyState icon={<Clock />} title={t("invoicing.hours.empty")} />
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="px-4">{t("invoicing.hours.date")}</TableHead>
                <TableHead>{t("invoicing.hours.worker")}</TableHead>
                <TableHead>{t("invoicing.col.trade")}</TableHead>
                <TableHead className="text-right">{t("invoicing.rateType.regular")}</TableHead>
                <TableHead className="text-right">{t("invoicing.rateType.overtime")}</TableHead>
                <TableHead className="text-right">{t("invoicing.rateType.weekend")}</TableHead>
                <TableHead>{t("invoicing.hours.source")}</TableHead>
                <TableHead className="pr-4" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="px-4 tabular-nums">{r.date}</TableCell>
                  <TableCell className="font-medium">{r.workerName}</TableCell>
                  <TableCell>{locale === "en" ? r.tradeNameEn : r.tradeNameLt}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.regular ? fmtHours(r.regular) : ""}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.overtime ? fmtHours(r.overtime) : ""}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.weekend ? fmtHours(r.weekend) : ""}</TableCell>
                  <TableCell>
                    <Badge variant={r.source === "manual" ? "outline" : "secondary"} title={r.note ?? undefined}>
                      {t(r.source === "manual" ? "invoicing.hours.manual" : "invoicing.hours.timesheets")}
                    </Badge>
                  </TableCell>
                  <TableCell className="pr-4 text-right">
                    {r.source === "manual" && (
                      <Can permission={P.invoiceManage}>
                        <Button size="icon" variant="ghost" aria-label={t("staffing.common.delete")} disabled={busy} onClick={() => void run(() => del({ hoursId: r.id as Id<"staffing_invoicing_hours"> }), { success: t("staffing.common.deleted") })}>
                          <Trash2 />
                        </Button>
                      </Can>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell colSpan={3} className="px-4 font-semibold">
                  {t("invoicing.total")}
                </TableCell>
                <TableCell className="text-right font-semibold tabular-nums">{fmtHours(sum.regular)}</TableCell>
                <TableCell className="text-right font-semibold tabular-nums">{fmtHours(sum.overtime)}</TableCell>
                <TableCell className="text-right font-semibold tabular-nums">{fmtHours(sum.weekend)}</TableCell>
                <TableCell colSpan={2} />
              </TableRow>
            </TableFooter>
          </Table>
        </div>
      )}
      {adding && projectId && <AddHoursDialog projectId={projectId as Id<"staffing_projects">} onClose={() => setAdding(false)} />}
    </div>
  )
}

function AddHoursDialog({ projectId, onClose }: { projectId: Id<"staffing_projects">; onClose: () => void }) {
  const { t } = useT()
  const project = useQuery(api.staffing.getProject, { projectId })
  const add = useMutation(api.invoicing.addHours)
  const { run, busy } = useAction()
  const team = (project?.team ?? []).filter((m) => m.status !== "cancelled")
  const [f, setF] = useState({ member: "", date: daysAgo(1), regular: "8", overtime: "0", weekend: "0", note: "" })
  const member = team.find((m) => m.id === f.member)
  const num = (s: string) => Number(s.replace(",", ".")) || 0

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!member) return
    const ok = await run(() => add({ projectId, workerId: member.workerId, tradeId: member.tradeId, date: f.date, regular: num(f.regular), overtime: num(f.overtime), weekend: num(f.weekend), note: f.note || undefined }), { success: t("staffing.common.created") })
    if (ok) onClose()
  }

  const numField = (k: "regular" | "overtime" | "weekend") => (
    <Field>
      <FieldLabel htmlFor={`h-${k}`}>{t(`invoicing.rateType.${k}`)}</FieldLabel>
      <Input id={`h-${k}`} inputMode="decimal" value={f[k]} onChange={(e) => setF((s) => ({ ...s, [k]: e.target.value }))} />
    </Field>
  )

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={(e) => void submit(e)} className="grid gap-5">
          <DialogHeader>
            <DialogTitle>{t("invoicing.hours.add")}</DialogTitle>
          </DialogHeader>
          <FieldGroup className="grid gap-4">
            <Field>
              <FieldLabel htmlFor="h-member">{t("invoicing.hours.worker")}</FieldLabel>
              <NativeSelect id="h-member" required value={f.member} onChange={(v) => setF((s) => ({ ...s, member: v }))}>
                <option value="" />
                {team.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.worker.fullName} · {m.tradeName}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field>
              <FieldLabel htmlFor="h-date">{t("invoicing.hours.date")}</FieldLabel>
              <Input id="h-date" type="date" required value={f.date} onChange={(e) => setF((s) => ({ ...s, date: e.target.value }))} />
            </Field>
            <div className="grid grid-cols-3 gap-3">
              {numField("regular")}
              {numField("overtime")}
              {numField("weekend")}
            </div>
            <Field>
              <FieldLabel htmlFor="h-note">{t("staffing.common.notes")}</FieldLabel>
              <Input id="h-note" value={f.note} onChange={(e) => setF((s) => ({ ...s, note: e.target.value }))} />
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t("staffing.common.cancel")}
            </Button>
            <Button type="submit" disabled={busy || !member}>
              {t("staffing.common.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
