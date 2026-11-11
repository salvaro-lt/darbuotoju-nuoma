"use client"
import type { ComplianceTemplateView } from "@digimuza/staffing"
import { StaffingCompliancePermissions } from "@digimuza/staffing/compliance/manifest"
import { contractTextToHtml, printableHtml } from "@digimuza/staffing/compliance/pure"
import { Can } from "@digimuza/system-core/react"
import { useMutation, useQuery } from "convex/react"
import { FilePlus2, FileSignature, Pencil, Plus, Printer, Trash2 } from "lucide-react"
import Link from "next/link"
import { useState } from "react"
import { EmptyState } from "@/components/app/empty-state"
import { PageHeader } from "@/components/app/page-header"
import { useAction } from "@/components/app/use-action"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { useT } from "@/lib/i18n/client"
import { ConfirmDelete, eurToCents, NativeSelect, workerHref } from "../../staffing/_components/staffing-ui"
import { ComplianceDisabled, ComplianceTabs, complianceProjectHref, fmt, openPrintable, useComplianceEnabled } from "./compliance-ui"

const contractPage = (title: string, body: string, lang: string) => printableHtml(title, contractTextToHtml(body), lang)

function DocumentFrame({ title, body, lang }: { title: string; body: string; lang: string }) {
  return <iframe title={title} srcDoc={contractPage(title, body, lang)} className="h-[60vh] w-full rounded-md border bg-white" sandbox="allow-same-origin" />
}

export function ContractsView() {
  const { t } = useT()
  const on = useComplianceEnabled()
  const contracts = useQuery(api.compliance.listContracts, on ? {} : "skip")
  const templates = useQuery(api.compliance.listTemplates, on ? {} : "skip")
  const [generating, setGenerating] = useState(false)
  const [viewing, setViewing] = useState<string | null>(null)
  const [editing, setEditing] = useState<ComplianceTemplateView | "new" | null>(null)
  const [deleting, setDeleting] = useState<{ kind: "contract" | "template"; id: string } | null>(null)
  const delContract = useMutation(api.compliance.deleteContract)
  const delTemplate = useMutation(api.compliance.deleteTemplate)
  const { run, busy } = useAction()
  if (!on) return <ComplianceDisabled />

  return (
    <div>
      <PageHeader
        title={t("compliance.contracts.title")}
        lead={t("compliance.contracts.lead")}
        actions={
          <Can permission={StaffingCompliancePermissions.contractCreate}>
            <Button size="sm" onClick={() => setGenerating(true)} disabled={!templates?.length}>
              <FilePlus2 />
              {t("compliance.contracts.generate")}
            </Button>
          </Can>
        }
      />
      <ComplianceTabs />
      {contracts === undefined ? (
        <Skeleton className="h-48 w-full" />
      ) : contracts.length === 0 ? (
        <EmptyState icon={<FileSignature />} title={t("compliance.contracts.empty")} />
      ) : (
        <div className="rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("compliance.contracts.col.title")}</TableHead>
                <TableHead>{t("compliance.contracts.col.worker")}</TableHead>
                <TableHead>{t("compliance.contracts.col.project")}</TableHead>
                <TableHead>{t("compliance.contracts.col.created")}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {contracts.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>
                    <button type="button" className="text-left font-medium hover:underline" onClick={() => setViewing(c.id)}>
                      {c.templateName}
                    </button>
                    <div className="mt-0.5 flex gap-1">
                      <Badge variant="outline">{c.language.toUpperCase()}</Badge>
                      {c.missing.length ? <Badge variant="destructive">{fmt(t("compliance.contracts.missing"), { count: c.missing.length })}</Badge> : <Badge variant="secondary">{t("compliance.contracts.complete")}</Badge>}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Link href={workerHref(c.workerId)} className="hover:underline">
                      {c.workerName}
                    </Link>
                  </TableCell>
                  <TableCell>
                    {c.projectId ? (
                      <Link href={complianceProjectHref(c.projectId)} className="hover:underline">
                        {c.projectCode}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground tabular-nums">{new Date(c.createdAt).toISOString().slice(0, 10)}</TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="ghost" onClick={() => setViewing(c.id)}>
                      <Printer />
                      {t("compliance.contracts.print")}
                    </Button>
                    <Can permission={StaffingCompliancePermissions.templateManage}>
                      <Button size="icon" variant="ghost" aria-label={t("staffing.common.delete")} onClick={() => setDeleting({ kind: "contract", id: c.id })}>
                        <Trash2 />
                      </Button>
                    </Can>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Card className="mt-6">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>{t("compliance.contracts.templates")}</CardTitle>
          <Can permission={StaffingCompliancePermissions.templateManage}>
            <Button size="sm" variant="outline" onClick={() => setEditing("new")}>
              <Plus />
              {t("compliance.contracts.newTemplate")}
            </Button>
          </Can>
        </CardHeader>
        <CardContent>
          <ul className="divide-y">
            {(templates ?? []).map((tpl) => (
              <li key={tpl.id} className="flex flex-wrap items-center gap-2 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{tpl.name}</div>
                  {tpl.description && <div className="text-xs text-muted-foreground">{tpl.description}</div>}
                </div>
                <Badge variant="outline">{tpl.language.toUpperCase()}</Badge>
                <span className="text-xs text-muted-foreground">{fmt(t("compliance.contracts.used"), { count: tpl.contracts })}</span>
                <Can permission={StaffingCompliancePermissions.templateManage}>
                  <Button size="icon" variant="ghost" aria-label={t("staffing.common.edit")} onClick={() => setEditing(tpl)}>
                    <Pencil />
                  </Button>
                  <Button size="icon" variant="ghost" aria-label={t("staffing.common.delete")} onClick={() => setDeleting({ kind: "template", id: tpl.id })}>
                    <Trash2 />
                  </Button>
                </Can>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {generating && <GenerateDialog templates={templates ?? []} onClose={() => setGenerating(false)} onCreated={(id) => setViewing(id)} />}
      {viewing && <ContractDialog contractId={viewing} onClose={() => setViewing(null)} />}
      {editing && <TemplateDialog template={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
      <ConfirmDelete
        open={deleting !== null}
        title={t("compliance.contracts.deleteTitle")}
        body={t("compliance.contracts.deleteBody")}
        busy={busy}
        onCancel={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return
          const ok =
            deleting.kind === "contract"
              ? await run(() => delContract({ contractId: deleting.id as Id<"staffing_compliance_contracts"> }), { success: t("staffing.common.deleted") })
              : await run(() => delTemplate({ templateId: deleting.id as Id<"staffing_compliance_templates"> }), { success: t("staffing.common.deleted") })
          if (ok) setDeleting(null)
        }}
      />
    </div>
  )
}

function ContractDialog({ contractId, onClose }: { contractId: string; onClose: () => void }) {
  const { t } = useT()
  const c = useQuery(api.compliance.getContract, { contractId: contractId as Id<"staffing_compliance_contracts"> })
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{c?.title ?? "…"}</DialogTitle>
          {c && c.missing.length > 0 && <DialogDescription className="text-destructive">{fmt(t("compliance.contracts.missingFields"), { fields: c.missing.join(", ") })}</DialogDescription>}
        </DialogHeader>
        {c ? <DocumentFrame title={c.title} body={c.body} lang={c.language} /> : <Skeleton className="h-[60vh] w-full" />}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("staffing.common.cancel")}
          </Button>
          <Button disabled={!c} onClick={() => c && openPrintable(contractPage(c.title, c.body, c.language))}>
            <Printer />
            {t("compliance.contracts.print")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function GenerateDialog({ templates, onClose, onCreated }: { templates: ComplianceTemplateView[]; onClose: () => void; onCreated: (id: string) => void }) {
  const { t } = useT()
  const candidates = useQuery(api.compliance.listContractCandidates, {})
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "")
  const [assignmentId, setAssignmentId] = useState("")
  const [rate, setRate] = useState("")
  const rateCents = rate.trim() ? eurToCents(rate) : undefined
  const args = templateId && assignmentId ? { templateId: templateId as Id<"staffing_compliance_templates">, assignmentId: assignmentId as Id<"staffing_assignments">, ...(rateCents !== undefined && Number.isFinite(rateCents) ? { hourlyRateCents: rateCents } : {}) } : null
  const preview = useQuery(api.compliance.previewContract, args ?? "skip")
  const generate = useMutation(api.compliance.generateContract)
  const { run, busy } = useAction()
  const byProject = new Map<string, NonNullable<typeof candidates>>()
  for (const c of candidates ?? []) byProject.set(`${c.projectCode} · ${c.projectName}`, [...(byProject.get(`${c.projectCode} · ${c.projectName}`) ?? []), c])

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>{t("compliance.contracts.generate")}</DialogTitle>
        </DialogHeader>
        <FieldGroup className="grid gap-3 sm:grid-cols-3">
          <Field>
            <FieldLabel htmlFor="tpl">{t("compliance.contracts.template")}</FieldLabel>
            <NativeSelect id="tpl" value={templateId} onChange={setTemplateId}>
              {templates.map((tpl) => (
                <option key={tpl.id} value={tpl.id}>
                  {tpl.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field>
            <FieldLabel htmlFor="asg">{t("compliance.contracts.assignment")}</FieldLabel>
            <NativeSelect id="asg" value={assignmentId} onChange={setAssignmentId}>
              <option value="">{t("compliance.contracts.pickAssignment")}</option>
              {[...byProject.entries()].map(([project, list]) => (
                <optgroup key={project} label={project}>
                  {list.map((c) => (
                    <option key={c.assignmentId} value={c.assignmentId}>
                      {c.workerName} · {c.tradeName} · {c.startDate}
                    </option>
                  ))}
                </optgroup>
              ))}
            </NativeSelect>
          </Field>
          <Field>
            <FieldLabel htmlFor="rate">{t("compliance.contracts.rate")}</FieldLabel>
            <Input id="rate" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="18.50" />
          </Field>
        </FieldGroup>
        <div>
          <div className="mb-1 text-sm font-medium">{t("compliance.contracts.preview")}</div>
          {preview?.missing.length ? <p className="mb-1 text-sm text-destructive">{fmt(t("compliance.contracts.missingFields"), { fields: preview.missing.join(", ") })}</p> : null}
          {preview ? <DocumentFrame title={preview.title} body={preview.body} lang={preview.language} /> : <div className="flex h-[40vh] items-center justify-center rounded-md border text-sm text-muted-foreground">{t("compliance.contracts.pickAssignment")}</div>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("staffing.common.cancel")}
          </Button>
          <Button
            disabled={!args || busy}
            onClick={async () => {
              if (!args) return
              const r = await run(() => generate(args), { success: t("compliance.contracts.created") })
              if (r) {
                onClose()
                onCreated(r.id)
              }
            }}
          >
            {t("compliance.contracts.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function TemplateDialog({ template, onClose }: { template: ComplianceTemplateView | null; onClose: () => void }) {
  const { t } = useT()
  const [name, setName] = useState(template?.name ?? "")
  const [language, setLanguage] = useState<"lt" | "en">(template?.language ?? "lt")
  const [description, setDescription] = useState(template?.description ?? "")
  const [body, setBody] = useState(template?.body ?? "# \n\n{{worker.fullName}}")
  const save = useMutation(api.compliance.saveTemplate)
  const { run, busy } = useAction()
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{template ? t("compliance.contracts.editTemplate") : t("compliance.contracts.newTemplate")}</DialogTitle>
        </DialogHeader>
        <FieldGroup>
          <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
            <Field>
              <FieldLabel htmlFor="tname">{t("compliance.contracts.templateName")}</FieldLabel>
              <Input id="tname" value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field>
              <FieldLabel htmlFor="tlang">{t("compliance.contracts.language")}</FieldLabel>
              <NativeSelect id="tlang" value={language} onChange={(v) => setLanguage(v as "lt" | "en")}>
                <option value="lt">LT</option>
                <option value="en">EN</option>
              </NativeSelect>
            </Field>
          </div>
          <Field>
            <FieldLabel htmlFor="tdesc">{t("compliance.contracts.description")}</FieldLabel>
            <Input id="tdesc" value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
          <Field>
            <FieldLabel htmlFor="tbody">{t("compliance.contracts.body")}</FieldLabel>
            <Textarea id="tbody" className="min-h-72 font-mono text-xs" value={body} onChange={(e) => setBody(e.target.value)} />
            <p className="text-xs text-muted-foreground">{t("compliance.contracts.bodyHint")}</p>
          </Field>
        </FieldGroup>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("staffing.common.cancel")}
          </Button>
          <Button
            disabled={busy}
            onClick={async () => {
              const r = await run(
                () => save({ ...(template ? { templateId: template.id as Id<"staffing_compliance_templates"> } : {}), name, language, body, ...(description.trim() ? { description } : {}) }),
                { success: t("staffing.common.saved") },
              )
              if (r) onClose()
            }}
          >
            {t("staffing.common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
