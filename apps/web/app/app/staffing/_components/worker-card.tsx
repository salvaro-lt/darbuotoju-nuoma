"use client"
import type { AssignmentView, CertificateView } from "@digimuza/staffing"
import { StaffingPermissions } from "@digimuza/staffing/manifest"
import { Can } from "@digimuza/system-core/react"
import { useConvex, useMutation, useQuery } from "convex/react"
import { ArrowLeft, FileText, Pencil, Plus, Trash2 } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState, type FormEvent } from "react"
import { PageHeader } from "@/components/app/page-header"
import { useAction } from "@/components/app/use-action"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { useT } from "@/lib/i18n/client"
import type { MessageKey } from "@/lib/i18n/messages"
import { AssignmentStatusBadge, CertBadge, ConfirmDelete, Detail, Disabled, NativeSelect, Period, projectHref, useCertificateTypes, useStaffingEnabled, useTradeName } from "./staffing-ui"
import { WorkerFormDialog } from "./worker-form"
import { WorkerPackageSends } from "../../compliance/_components/package-send"

export function WorkerCardView({ workerId }: { workerId: string }) {
  const { t } = useT()
  const enabled = useStaffingEnabled()
  const router = useRouter()
  const tradeName = useTradeName()
  const card = useQuery(api.staffing.getWorker, enabled ? { workerId: workerId as Id<"staffing_workers"> } : "skip")
  const del = useMutation(api.staffing.deleteWorker)
  const { run, busy } = useAction()
  const [editing, setEditing] = useState(false)
  const [deleting, setDeleting] = useState(false)
  if (!enabled) return <Disabled />
  if (card === undefined) return <Skeleton className="h-96 w-full rounded-xl" />
  if (card === null) return <p className="text-sm text-muted-foreground">{t("staffing.common.notFound")}</p>
  const w = card.worker

  return (
    <div className="grid gap-6">
      <div>
        <Button variant="ghost" size="sm" asChild className="-ml-2 mb-2">
          <Link href="/app/staffing/workers">
            <ArrowLeft />
            {t("staffing.nav.workers")}
          </Link>
        </Button>
        <PageHeader
          title={w.fullName}
          lead={[w.trades.map((x) => tradeName(x)).join(", "), w.subcontractorName ?? t(`staffing.source.${w.source}` as MessageKey)].filter(Boolean).join(" · ")}
          actions={
            <>
              <CertBadge status={w.certStatus} />
              {w.status === "inactive" && <Badge variant="outline">{t("staffing.workerStatus.inactive")}</Badge>}
              <Can permission={StaffingPermissions.workerUpdate}>
                <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                  <Pencil />
                  {t("staffing.common.edit")}
                </Button>
              </Can>
              <Can permission={StaffingPermissions.workerDelete}>
                <Button size="sm" variant="ghost" aria-label={t("staffing.common.delete")} onClick={() => setDeleting(true)}>
                  <Trash2 />
                </Button>
              </Can>
            </>
          }
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <AssignmentTile label={t("staffing.worker.current")} a={card.current} />
        <AssignmentTile label={t("staffing.worker.next")} a={card.next} />
        <Card className="gap-2 py-4">
          <CardHeader className="px-4">
            <CardTitle className="text-sm font-medium text-muted-foreground">{t("staffing.worker.trades")}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-1.5 px-4">
            {w.trades.length === 0 && <span className="text-sm text-muted-foreground">{t("staffing.common.none")}</span>}
            {w.trades.map((x) => (
              <Badge key={x.id} variant="secondary">
                {tradeName(x)} · {t(`staffing.level.${x.level}` as MessageKey)}
              </Badge>
            ))}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_1.4fr]">
        <Card className="py-4">
          <CardHeader className="px-4">
            <CardTitle className="text-base">{t("staffing.worker.details")}</CardTitle>
          </CardHeader>
          <CardContent className="px-4">
            <dl className="divide-y">
              <Detail label={t("staffing.worker.phone")}>{w.phone}</Detail>
              <Detail label={t("staffing.worker.email")}>{w.email ?? t("staffing.common.none")}</Detail>
              <Detail label={t("staffing.workers.col.nationality")}>{w.nationality}</Detail>
              <Detail label={t("staffing.worker.languages")}>{w.languages.join(", ") || t("staffing.common.none")}</Detail>
              <Detail label={t("staffing.worker.homeCity")}>{[w.homeCity, w.homeCountry].filter(Boolean).join(", ")}</Detail>
              <Detail label={t("staffing.worker.license")}>
                {w.driverLicenseCategories.join(", ") || t("staffing.common.none")}
                {w.driverLicenseExpiresAt && <span className="text-muted-foreground"> · {w.driverLicenseExpiresAt}</span>}
              </Detail>
              <Detail label={t("staffing.worker.clothing")}>
                {[w.clothingSizes.jacket, w.clothingSizes.trousers, w.clothingSizes.shoes].map((s) => s ?? "–").join(" / ")}
              </Detail>
              {w.notes && <Detail label={t("staffing.common.notes")}>{w.notes}</Detail>}
            </dl>
          </CardContent>
        </Card>
        <Certificates workerId={w.id} certificates={card.certificates} missing={card.missingMandatory.map((m) => m.name)} />
      </div>
      <WorkerPackageSends workerId={w.id} />

      <Card className="py-4">
        <CardHeader className="px-4">
          <CardTitle className="text-base">{t("staffing.worker.assignments")}</CardTitle>
        </CardHeader>
        <CardContent className="px-0">
          {card.assignments.length === 0 ? (
            <p className="px-4 text-sm text-muted-foreground">{t("staffing.worker.noAssignments")}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="px-4">{t("staffing.projects.title")}</TableHead>
                  <TableHead>{t("staffing.team.trade")}</TableHead>
                  <TableHead>{t("staffing.projects.period")}</TableHead>
                  <TableHead>{t("staffing.common.status")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {card.assignments.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="px-4">
                      <Link href={projectHref(a.projectId)} className="font-medium hover:underline">
                        {a.projectCode} · {a.projectName}
                      </Link>
                      <span className="ml-2 text-xs text-muted-foreground">{a.clientName}</span>
                    </TableCell>
                    <TableCell>
                      {a.tradeName}
                      {a.isDriver && <span className="ml-1 text-xs text-muted-foreground">· {t("staffing.worker.driver")}</span>}
                    </TableCell>
                    <TableCell>
                      <Period from={a.startDate} to={a.endDate} />
                    </TableCell>
                    <TableCell>
                      <AssignmentStatusBadge status={a.status} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {editing && <WorkerFormDialog worker={w} onClose={() => setEditing(false)} />}
      <ConfirmDelete
        open={deleting}
        title={t("staffing.common.confirmDelete")}
        body={t("staffing.worker.deleteBody")}
        busy={busy}
        onCancel={() => setDeleting(false)}
        onConfirm={() =>
          void run(() => del({ workerId: w.id }), { success: t("staffing.common.deleted") }).then((r) => {
            setDeleting(false)
            if (r) router.push("/app/staffing/workers")
          })
        }
      />
    </div>
  )
}

function AssignmentTile({ label, a }: { label: string; a: AssignmentView | null }) {
  const { t } = useT()
  return (
    <Card className="gap-2 py-4">
      <CardHeader className="px-4">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-1 px-4 text-sm">
        {a ? (
          <>
            <Link href={projectHref(a.projectId)} className="font-medium hover:underline">
              {a.projectCode} · {a.projectName}
            </Link>
            <span className="text-muted-foreground">
              {a.clientName} · {a.tradeName}
            </span>
            <span className="flex items-center gap-2">
              <Period from={a.startDate} to={a.endDate} />
              <AssignmentStatusBadge status={a.status} />
            </span>
          </>
        ) : (
          <span className="text-muted-foreground">{t("staffing.worker.noAssignment")}</span>
        )}
      </CardContent>
    </Card>
  )
}

function Certificates({ workerId, certificates, missing }: { workerId: Id<"staffing_workers">; certificates: CertificateView[]; missing: string[] }) {
  const { t, locale } = useT()
  const convex = useConvex()
  const del = useMutation(api.staffing.deleteWorkerCertificate)
  const { run, busy } = useAction()
  const [editing, setEditing] = useState<CertificateView | "new" | null>(null)
  const [deleting, setDeleting] = useState<CertificateView | null>(null)

  async function open(id: Id<"staffing_workerCertificates">) {
    const url = await convex.query(api.staffing.getCertificateFileUrl, { certificateId: id })
    if (url) window.open(url, "_blank", "noopener")
  }

  return (
    <Card className="py-4">
      <CardHeader className="flex flex-row items-center justify-between px-4">
        <CardTitle className="text-base">{t("staffing.certs.title")}</CardTitle>
        <Can permission={StaffingPermissions.workerUpdate}>
          <Button size="sm" variant="outline" onClick={() => setEditing("new")}>
            <Plus />
            {t("staffing.certs.add")}
          </Button>
        </Can>
      </CardHeader>
      <CardContent className="grid gap-3 px-0">
        {missing.length > 0 && (
          <div className="mx-4 flex flex-wrap items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm">
            <span className="font-medium text-destructive">{t("staffing.certs.missingMandatory")}:</span>
            {missing.join(", ")}
          </div>
        )}
        {certificates.length === 0 ? (
          <p className="px-4 text-sm text-muted-foreground">{t("staffing.certs.empty")}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="px-4">{t("staffing.certs.type")}</TableHead>
                <TableHead>{t("staffing.certs.number")}</TableHead>
                <TableHead>{t("staffing.certs.expiresAt")}</TableHead>
                <TableHead>{t("staffing.common.status")}</TableHead>
                <TableHead className="w-28" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {certificates.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="px-4 font-medium">{locale === "en" && c.typeNameEn ? c.typeNameEn : c.typeName}</TableCell>
                  <TableCell className="text-muted-foreground">{c.number ?? t("staffing.common.none")}</TableCell>
                  <TableCell className="tabular-nums">{c.expiresAt ?? t("staffing.common.none")}</TableCell>
                  <TableCell>
                    <CertBadge status={c.status} />
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1 pr-2">
                      {c.hasFile && (
                        <Button variant="ghost" size="icon-sm" aria-label={t("staffing.certs.open")} onClick={() => void open(c.id)}>
                          <FileText />
                        </Button>
                      )}
                      <Can permission={StaffingPermissions.workerUpdate}>
                        <Button variant="ghost" size="icon-sm" aria-label={t("staffing.common.edit")} onClick={() => setEditing(c)}>
                          <Pencil />
                        </Button>
                        <Button variant="ghost" size="icon-sm" aria-label={t("staffing.common.delete")} onClick={() => setDeleting(c)}>
                          <Trash2 />
                        </Button>
                      </Can>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
      {editing && <CertificateDialog workerId={workerId} cert={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
      <ConfirmDelete
        open={!!deleting}
        title={t("staffing.common.confirmDelete")}
        body={deleting?.typeName ?? ""}
        busy={busy}
        onCancel={() => setDeleting(null)}
        onConfirm={() => void run(() => del({ certificateId: deleting!.id }), { success: t("staffing.common.deleted") }).then(() => setDeleting(null))}
      />
    </Card>
  )
}

function CertificateDialog({ workerId, cert, onClose }: { workerId: Id<"staffing_workers">; cert: CertificateView | null; onClose: () => void }) {
  const { t } = useT()
  const types = useCertificateTypes() ?? []
  const add = useMutation(api.staffing.addWorkerCertificate)
  const update = useMutation(api.staffing.updateWorkerCertificate)
  const uploadUrl = useMutation(api.staffing.generateCertificateUploadUrl)
  const { run, busy } = useAction()
  const [typeId, setTypeId] = useState<string>(cert?.certificateTypeId ?? "")
  const [number, setNumber] = useState(cert?.number ?? "")
  const [issuedAt, setIssuedAt] = useState(cert?.issuedAt ?? "")
  const [expiresAt, setExpiresAt] = useState(cert?.expiresAt ?? "")
  const [file, setFile] = useState<File | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    const res = await run(
      async () => {
        let fileStorageId: Id<"_storage"> | undefined
        if (file) {
          const url = await uploadUrl({})
          const r = await fetch(url, { method: "POST", headers: { "Content-Type": file.type || "application/octet-stream" }, body: file })
          fileStorageId = ((await r.json()) as { storageId: Id<"_storage"> }).storageId
        }
        const common = { number: number || undefined, issuedAt: issuedAt || undefined, expiresAt: expiresAt || undefined, ...(fileStorageId ? { fileStorageId, fileName: file!.name } : {}) }
        return cert ? update({ certificateId: cert.id, ...common }) : add({ workerId, certificateTypeId: typeId as Id<"staffing_certificateTypes">, ...common })
      },
      { success: t("staffing.common.saved") },
    )
    if (res) onClose()
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={(e) => void submit(e)} className="grid gap-5">
          <DialogHeader>
            <DialogTitle>{cert ? t("staffing.certs.edit") : t("staffing.certs.add")}</DialogTitle>
            {cert && <DialogDescription>{cert.typeName}</DialogDescription>}
          </DialogHeader>
          <FieldGroup className="grid gap-4 sm:grid-cols-2">
            {!cert && (
              <Field className="sm:col-span-2">
                <FieldLabel htmlFor="c-type">{t("staffing.certs.type")}</FieldLabel>
                <NativeSelect id="c-type" required value={typeId} onChange={setTypeId}>
                  <option value="" />
                  {types.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            )}
            <Field className="sm:col-span-2">
              <FieldLabel htmlFor="c-number">{t("staffing.certs.number")}</FieldLabel>
              <Input id="c-number" value={number} onChange={(e) => setNumber(e.target.value)} maxLength={100} />
            </Field>
            <Field>
              <FieldLabel htmlFor="c-issued">{t("staffing.certs.issuedAt")}</FieldLabel>
              <Input id="c-issued" type="date" value={issuedAt} onChange={(e) => setIssuedAt(e.target.value)} />
            </Field>
            <Field>
              <FieldLabel htmlFor="c-expires">{t("staffing.certs.expiresAt")}</FieldLabel>
              <Input id="c-expires" type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
              {!cert && <FieldDescription>{t("staffing.certs.expiresHint")}</FieldDescription>}
            </Field>
            <Field className="sm:col-span-2">
              <FieldLabel htmlFor="c-file">{t("staffing.certs.file")}</FieldLabel>
              <Input id="c-file" type="file" accept="application/pdf,image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              {cert?.fileName && <FieldDescription>{cert.fileName}</FieldDescription>}
            </Field>
          </FieldGroup>
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
