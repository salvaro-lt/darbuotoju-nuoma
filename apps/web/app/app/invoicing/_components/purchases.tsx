"use client"
// Pirkimo sąskaitos: supplier invoices wait here for the director's approval
// before they become project costs and go to the accountant (SitePro).
import { StaffingInvoicingPermissions as P } from "@digimuza/staffing/invoicing/manifest"
import { COST_CATEGORIES, type CostCategory, type PurchaseStatus } from "@digimuza/staffing/invoicing/pure"
import { Can, useCan } from "@digimuza/system-core/react"
import { useMutation, useQuery } from "convex/react"
import type { FunctionReturnType } from "convex/server"
import { Check, FileText, Inbox, Pencil, Plus, Send, ShieldQuestion, Upload, UserCheck, X } from "lucide-react"
import { useState, type FormEvent } from "react"
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
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { useT } from "@/lib/i18n/client"
import type { MessageKey } from "@/lib/i18n/messages"
import { NativeSelect } from "../../staffing/_components/staffing-ui"
import { InvoicingDisabled, InvoicingTabs, Stat, useInvoicingEnabled, useMoney } from "./invoicing-ui"

type PurchaseList = FunctionReturnType<typeof api.invoicing.listPurchases>
type Purchase = PurchaseList["items"][number]
type Supplier = FunctionReturnType<typeof api.invoicing.listSuppliers>[number]

const STATUS_CLASS: Record<PurchaseStatus, string> = {
  review: "border-transparent bg-marking/15 text-marking-foreground dark:text-marking",
  pending: "border-transparent bg-secondary text-foreground",
  approved: "border-transparent bg-steel-green/15 text-steel-green",
  rejected: "border-dashed text-muted-foreground",
}

const FILTERS: (PurchaseStatus | "all")[] = ["all", "review", "pending", "approved", "rejected"]
const toCents = (s: string) => Math.round((Number(s.replace(/\s/g, "").replace(",", ".")) || 0) * 100)
const fromCents = (c: number) => (c ? (c / 100).toFixed(2).replace(".", ",") : "")

export function PurchasesView() {
  const { t, locale } = useT()
  const money = useMoney()
  const enabled = useInvoicingEnabled()
  const [filter, setFilter] = useState<PurchaseStatus | "all">("all")
  const data = useQuery(api.invoicing.listPurchases, enabled ? {} : "skip")
  const approve = useMutation(api.invoicing.approvePurchase)
  const forward = useMutation(api.invoicing.forwardPurchase)
  const canApprove = useCan(P.purchaseApprove)
  const { run, busy } = useAction()
  const [editing, setEditing] = useState<Purchase | null>(null)
  const [uploading, setUploading] = useState(false)
  const [rejecting, setRejecting] = useState<Purchase | null>(null)
  const [accepting, setAccepting] = useState<Purchase | null>(null)
  if (!enabled) return <InvoicingDisabled />
  const items = (data?.items ?? []).filter((p) => filter === "all" || p.status === filter)
  const fmtDate = (ms: number) => new Date(ms).toLocaleDateString(locale === "en" ? "en-GB" : "lt-LT")

  return (
    <div>
      <PageHeader
        title={t("invoicing.purchases.title")}
        lead={t("invoicing.purchases.lead")}
        actions={
          <Can permission={P.costManage}>
            <Button size="sm" onClick={() => setUploading(true)}>
              <Upload />
              {t("invoicing.purchases.upload")}
            </Button>
          </Can>
        }
      />
      <InvoicingTabs />
      {!data ? (
        <Skeleton className="h-96 w-full rounded-xl" />
      ) : (
        <div className="grid gap-5">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label={t("invoicing.purchases.stat.pending")} value={String(data.counts.pending)} hint={`${t("invoicing.purchases.stat.waiting")}: ${money(data.waitingCents)}`} tone={data.counts.pending ? "warn" : undefined} />
            <Stat label={t("invoicing.purchases.stat.review")} value={String(data.counts.review)} hint={t("invoicing.purchases.stat.reviewHint")} tone={data.counts.review ? "warn" : undefined} />
            <Stat label={t("invoicing.purchases.stat.approved")} value={String(data.counts.approved)} hint={t("invoicing.purchases.stat.approvedHint")} tone="good" />
            <Stat label={t("invoicing.purchases.stat.ready")} value={String(data.readyToForward)} hint={data.siteProConfigured ? t("invoicing.purchases.sitepro.on") : t("invoicing.purchases.sitepro.off")} tone={data.readyToForward ? "warn" : undefined} />
          </div>

          <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("invoicing.col.status")}>
            {FILTERS.map((f) => (
              <Button key={f} size="sm" variant={filter === f ? "default" : "outline"} onClick={() => setFilter(f)}>
                {t(f === "all" ? "invoicing.filter.all" : (`invoicing.purchases.status.${f}` as MessageKey))}
                {f !== "all" && <span className="tabular-nums opacity-70">{data.counts[f]}</span>}
              </Button>
            ))}
          </div>

          {items.length === 0 ? (
            <EmptyState icon={<Inbox />} title={t("invoicing.purchases.empty")} />
          ) : (
            <div className="overflow-x-auto rounded-xl border bg-card">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="px-4">{t("invoicing.purchases.received")}</TableHead>
                    <TableHead>{t("invoicing.purchases.supplier")}</TableHead>
                    <TableHead>{t("invoicing.col.number")}</TableHead>
                    <TableHead>{t("invoicing.col.project")}</TableHead>
                    <TableHead>{t("invoicing.cost.category")}</TableHead>
                    <TableHead className="text-right">{t("invoicing.col.total")}</TableHead>
                    <TableHead>{t("invoicing.col.status")}</TableHead>
                    <TableHead>SitePro</TableHead>
                    <TableHead className="pr-4 text-right" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="px-4 whitespace-nowrap tabular-nums">
                        {fmtDate(p.receivedAt)}
                        <div className="text-xs text-muted-foreground">{t(`invoicing.purchases.source.${p.source}` as MessageKey)}</div>
                      </TableCell>
                      <TableCell className="min-w-[14rem] whitespace-normal">
                        <div className="font-medium">{p.supplierName}</div>
                        <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                          {p.senderEmail}
                          {!p.knownSender && p.source === "email" && (
                            <Badge variant="outline" className="border-transparent bg-marking/15 text-marking-foreground dark:text-marking">
                              <ShieldQuestion />
                              {t("invoicing.purchases.unknownSender")}
                            </Badge>
                          )}
                        </div>
                        {p.subject && <div className="max-w-80 truncate text-xs text-muted-foreground">{p.subject}</div>}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {p.number || <span className="text-destructive">{t("invoicing.purchases.noNumber")}</span>}
                        <div className="text-muted-foreground">{p.issueDate}</div>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{p.projectCode ?? <span className="font-sans text-muted-foreground">{t("invoicing.purchases.general")}</span>}</TableCell>
                      <TableCell>{t(`invoicing.cost.cat.${p.category}` as MessageKey)}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {p.totalCents ? money(p.totalCents) : <span className="text-destructive">{t("invoicing.purchases.noAmount")}</span>}
                        {p.vatCents > 0 && <div className="text-xs text-muted-foreground">{t("invoicing.purchases.vatIncl").replace("{vat}", money(p.vatCents))}</div>}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={STATUS_CLASS[p.status]} title={p.rejectReason ?? undefined}>
                          {t(`invoicing.purchases.status.${p.status}` as MessageKey)}
                        </Badge>
                        {p.rejectReason && <div className="mt-1 max-w-48 text-xs text-muted-foreground">{p.rejectReason}</div>}
                      </TableCell>
                      <TableCell className="text-xs whitespace-nowrap">
                        {p.forward === "none" ? <span className="text-muted-foreground">—</span> : <span className={p.forward === "sent" ? "text-steel-green" : p.forward === "failed" ? "text-destructive" : p.forward === "ready" ? "text-marking-foreground dark:text-marking" : ""}>{t(`invoicing.purchases.forward.${p.forward}` as MessageKey)}</span>}
                        {p.forwardError && <div className="text-destructive">{p.forwardError}</div>}
                      </TableCell>
                      <TableCell className="pr-4">
                        <div className="flex justify-end gap-1">
                          {(p.status === "pending" || p.status === "review") && (
                            <Can permission={P.costManage}>
                              <Button size="icon" variant="ghost" aria-label={t("staffing.common.edit")} onClick={() => setEditing(p)}>
                                <Pencil />
                              </Button>
                            </Can>
                          )}
                          {p.status === "review" && (
                            <Can permission={P.costManage}>
                              <Button size="sm" variant="outline" onClick={() => setAccepting(p)}>
                                <UserCheck />
                                {t("invoicing.purchases.accept")}
                              </Button>
                            </Can>
                          )}
                          {p.status === "pending" && canApprove && (
                            <Button size="sm" disabled={busy} onClick={() => void run(() => approve({ purchaseId: p.id as Id<"staffing_invoicing_purchases"> }), { success: t("invoicing.purchases.approved") })}>
                              <Check />
                              {t("invoicing.purchases.approve")}
                            </Button>
                          )}
                          {(p.status === "pending" || p.status === "review") && canApprove && (
                            <Button size="sm" variant="outline" onClick={() => setRejecting(p)}>
                              <X />
                              {t("invoicing.purchases.reject")}
                            </Button>
                          )}
                          {p.status === "approved" && (p.forward === "ready" || p.forward === "failed") && (
                            <Can permission={P.costManage}>
                              <Button size="sm" variant="outline" disabled={busy} onClick={() => void run(() => forward({ purchaseId: p.id as Id<"staffing_invoicing_purchases"> }), { success: t("invoicing.purchases.forwardQueued") })}>
                                <Send />
                                {t("invoicing.purchases.forwardNow")}
                              </Button>
                            </Can>
                          )}
                          {p.hasFile && <FileLink id={p.id} />}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          <p className="text-xs text-muted-foreground">{t("invoicing.purchases.note")}</p>
          <SuppliersCard />
        </div>
      )}
      {editing && <PurchaseDialog purchase={editing} onClose={() => setEditing(null)} />}
      {uploading && <PurchaseDialog onClose={() => setUploading(false)} />}
      {rejecting && <RejectDialog purchase={rejecting} onClose={() => setRejecting(null)} />}
      {accepting && <AcceptDialog purchase={accepting} onClose={() => setAccepting(null)} />}
    </div>
  )
}

function FileLink({ id }: { id: string }) {
  const { t } = useT()
  const url = useQuery(api.invoicing.getPurchaseFileUrl, { purchaseId: id as Id<"staffing_invoicing_purchases"> })
  if (!url) return null
  return (
    <Button size="icon" variant="ghost" asChild aria-label={t("invoicing.purchases.file")}>
      <a href={url} target="_blank" rel="noreferrer">
        <FileText />
      </a>
    </Button>
  )
}

function useProjects() {
  return useQuery(api.staffing.listProjects, {})?.filter((p) => p.status !== "cancelled")
}

/** Edit a queued invoice, or upload a new one (no `purchase`). */
function PurchaseDialog({ purchase, onClose }: { purchase?: Purchase; onClose: () => void }) {
  const { t } = useT()
  const projects = useProjects()
  const suppliers = useQuery(api.invoicing.listSuppliers, {})
  const update = useMutation(api.invoicing.updatePurchase)
  const create = useMutation(api.invoicing.createPurchase)
  const uploadUrl = useMutation(api.invoicing.generatePurchaseUploadUrl)
  const { run, busy } = useAction()
  const [file, setFile] = useState<File | null>(null)
  const [f, setF] = useState({
    supplierId: purchase?.supplierId ?? "",
    supplierName: purchase?.supplierName ?? "",
    number: purchase?.number ?? "",
    issueDate: purchase?.issueDate ?? new Date().toISOString().slice(0, 10),
    net: fromCents(purchase?.netCents ?? 0),
    vat: fromCents(purchase?.vatCents ?? 0),
    category: (purchase?.category ?? "accommodation") as CostCategory,
    projectId: purchase?.projectId ?? "",
    note: purchase?.note ?? "",
  })

  function pickSupplier(id: string) {
    const s = suppliers?.find((x) => x.id === id)
    setF((x) => ({ ...x, supplierId: id, ...(s ? { supplierName: s.name, category: s.category, projectId: s.defaultProjectId ?? x.projectId } : {}) }))
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    const common = {
      ...(f.supplierId ? { supplierId: f.supplierId as Id<"staffing_invoicing_suppliers"> } : { supplierName: f.supplierName }),
      number: f.number,
      issueDate: f.issueDate,
      netCents: toCents(f.net),
      vatCents: toCents(f.vat),
      category: f.category,
      note: f.note,
    }
    if (purchase) {
      const ok = await run(() => update({ purchaseId: purchase.id as Id<"staffing_invoicing_purchases">, ...common, projectId: f.projectId ? (f.projectId as Id<"staffing_projects">) : null }), { success: t("staffing.common.saved") })
      if (ok) onClose()
      return
    }
    const ok = await run(
      async () => {
        let fileStorageId: Id<"_storage"> | undefined
        if (file) {
          const url = await uploadUrl({})
          const res = await fetch(url, { method: "POST", headers: { "Content-Type": file.type || "application/octet-stream" }, body: file })
          fileStorageId = ((await res.json()) as { storageId: Id<"_storage"> }).storageId
        }
        return create({ ...common, ...(f.projectId ? { projectId: f.projectId as Id<"staffing_projects"> } : {}), ...(fileStorageId ? { fileStorageId, fileName: file!.name } : {}) })
      },
      { success: t("invoicing.purchases.uploaded") },
    )
    if (ok) onClose()
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <form onSubmit={(e) => void submit(e)} className="grid gap-5">
          <DialogHeader>
            <DialogTitle>{purchase ? t("invoicing.purchases.edit") : t("invoicing.purchases.upload")}</DialogTitle>
            {!purchase && <DialogDescription>{t("invoicing.purchases.uploadLead")}</DialogDescription>}
          </DialogHeader>
          <FieldGroup className="grid gap-4 sm:grid-cols-2">
            {!purchase && (
              <Field className="sm:col-span-2">
                <FieldLabel htmlFor="pu-file">{t("invoicing.purchases.file")}</FieldLabel>
                <Input id="pu-file" type="file" accept="application/pdf,image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              </Field>
            )}
            <Field>
              <FieldLabel htmlFor="pu-sup">{t("invoicing.purchases.knownSupplier")}</FieldLabel>
              <NativeSelect id="pu-sup" value={f.supplierId} onChange={pickSupplier}>
                <option value="">{t("invoicing.purchases.otherSupplier")}</option>
                {suppliers?.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field>
              <FieldLabel htmlFor="pu-name">{t("invoicing.purchases.supplier")}</FieldLabel>
              <Input id="pu-name" required disabled={!!f.supplierId} value={f.supplierName} onChange={(e) => setF((x) => ({ ...x, supplierName: e.target.value }))} />
            </Field>
            <Field>
              <FieldLabel htmlFor="pu-no">{t("invoicing.col.number")}</FieldLabel>
              <Input id="pu-no" value={f.number} onChange={(e) => setF((x) => ({ ...x, number: e.target.value }))} />
            </Field>
            <Field>
              <FieldLabel htmlFor="pu-date">{t("invoicing.col.issueDate")}</FieldLabel>
              <Input id="pu-date" type="date" required value={f.issueDate} onChange={(e) => setF((x) => ({ ...x, issueDate: e.target.value }))} />
            </Field>
            <Field>
              <FieldLabel htmlFor="pu-net">{t("invoicing.purchases.net")}</FieldLabel>
              <Input id="pu-net" inputMode="decimal" value={f.net} onChange={(e) => setF((x) => ({ ...x, net: e.target.value }))} />
            </Field>
            <Field>
              <FieldLabel htmlFor="pu-vat">{t("invoicing.purchases.vat")}</FieldLabel>
              <Input id="pu-vat" inputMode="decimal" value={f.vat} onChange={(e) => setF((x) => ({ ...x, vat: e.target.value }))} />
            </Field>
            <Field>
              <FieldLabel htmlFor="pu-cat">{t("invoicing.cost.category")}</FieldLabel>
              <NativeSelect id="pu-cat" value={f.category} onChange={(v) => setF((x) => ({ ...x, category: v as CostCategory }))}>
                {COST_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {t(`invoicing.cost.cat.${c}` as MessageKey)}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field>
              <FieldLabel htmlFor="pu-proj">{t("invoicing.col.project")}</FieldLabel>
              <NativeSelect id="pu-proj" value={f.projectId} onChange={(v) => setF((x) => ({ ...x, projectId: v }))}>
                <option value="">{t("invoicing.purchases.general")}</option>
                {projects?.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.code} · {p.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field className="sm:col-span-2">
              <FieldLabel htmlFor="pu-note">{t("staffing.common.notes")}</FieldLabel>
              <Input id="pu-note" value={f.note} onChange={(e) => setF((x) => ({ ...x, note: e.target.value }))} />
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

function RejectDialog({ purchase, onClose }: { purchase: Purchase; onClose: () => void }) {
  const { t } = useT()
  const reject = useMutation(api.invoicing.rejectPurchase)
  const { run, busy } = useAction()
  const [reason, setReason] = useState("")
  async function submit(e: FormEvent) {
    e.preventDefault()
    if (await run(() => reject({ purchaseId: purchase.id as Id<"staffing_invoicing_purchases">, reason: reason || undefined }), { success: t("invoicing.purchases.rejected") })) onClose()
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={(e) => void submit(e)} className="grid gap-5">
          <DialogHeader>
            <DialogTitle>{t("invoicing.purchases.rejectTitle")}</DialogTitle>
            <DialogDescription>
              {purchase.supplierName} {purchase.number}
            </DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor="rj-reason">{t("invoicing.purchases.rejectReason")}</FieldLabel>
            <Input id="rj-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t("staffing.common.cancel")}
            </Button>
            <Button type="submit" variant="destructive" disabled={busy}>
              {t("invoicing.purchases.reject")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Unknown sender → a known supplier (new or existing); the invoice moves to the approval queue. */
function AcceptDialog({ purchase, onClose }: { purchase: Purchase; onClose: () => void }) {
  const { t } = useT()
  const suppliers = useQuery(api.invoicing.listSuppliers, {})
  const accept = useMutation(api.invoicing.acceptSender)
  const { run, busy } = useAction()
  const [supplierId, setSupplierId] = useState("")
  const [name, setName] = useState(purchase.supplierName)
  const [category, setCategory] = useState<CostCategory>(purchase.category)
  async function submit(e: FormEvent) {
    e.preventDefault()
    const ok = await run(() => accept({ purchaseId: purchase.id as Id<"staffing_invoicing_purchases">, ...(supplierId ? { supplierId: supplierId as Id<"staffing_invoicing_suppliers"> } : { name, category }) }), { success: t("invoicing.purchases.acceptedSender") })
    if (ok) onClose()
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={(e) => void submit(e)} className="grid gap-5">
          <DialogHeader>
            <DialogTitle>{t("invoicing.purchases.acceptTitle")}</DialogTitle>
            <DialogDescription>{t("invoicing.purchases.acceptLead").replace("{email}", purchase.senderEmail ?? "")}</DialogDescription>
          </DialogHeader>
          <FieldGroup className="grid gap-4">
            <Field>
              <FieldLabel htmlFor="ac-sup">{t("invoicing.purchases.knownSupplier")}</FieldLabel>
              <NativeSelect id="ac-sup" value={supplierId} onChange={setSupplierId}>
                <option value="">{t("invoicing.purchases.newSupplier")}</option>
                {suppliers?.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            {!supplierId && (
              <>
                <Field>
                  <FieldLabel htmlFor="ac-name">{t("invoicing.purchases.supplier")}</FieldLabel>
                  <Input id="ac-name" required value={name} onChange={(e) => setName(e.target.value)} />
                </Field>
                <Field>
                  <FieldLabel htmlFor="ac-cat">{t("invoicing.cost.category")}</FieldLabel>
                  <NativeSelect id="ac-cat" value={category} onChange={(v) => setCategory(v as CostCategory)}>
                    {COST_CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {t(`invoicing.cost.cat.${c}` as MessageKey)}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
              </>
            )}
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t("staffing.common.cancel")}
            </Button>
            <Button type="submit" disabled={busy}>
              {t("invoicing.purchases.accept")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function SuppliersCard() {
  const { t } = useT()
  const suppliers = useQuery(api.invoicing.listSuppliers, {})
  const [editing, setEditing] = useState<Supplier | "new" | null>(null)
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
        <div>
          <CardTitle className="text-base">{t("invoicing.suppliers.title")}</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">{t("invoicing.suppliers.lead")}</p>
        </div>
        <Can permission={P.costManage}>
          <Button size="sm" variant="outline" onClick={() => setEditing("new")}>
            <Plus />
            {t("invoicing.suppliers.add")}
          </Button>
        </Can>
      </CardHeader>
      <CardContent className="px-0">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="px-4">{t("invoicing.purchases.supplier")}</TableHead>
              <TableHead>{t("invoicing.suppliers.emails")}</TableHead>
              <TableHead>{t("invoicing.cost.category")}</TableHead>
              <TableHead>{t("invoicing.suppliers.defaultProject")}</TableHead>
              <TableHead className="pr-4" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {suppliers?.map((s) => (
              <TableRow key={s.id} className={s.active ? "" : "opacity-60"}>
                <TableCell className="px-4 font-medium">{s.name}</TableCell>
                <TableCell className="font-mono text-xs whitespace-normal">{s.emails.join(", ")}</TableCell>
                <TableCell>{t(`invoicing.cost.cat.${s.category}` as MessageKey)}</TableCell>
                <TableCell className="font-mono text-xs">{s.defaultProjectCode ?? "—"}</TableCell>
                <TableCell className="pr-4 text-right">
                  <Can permission={P.costManage}>
                    <Button size="icon" variant="ghost" aria-label={t("staffing.common.edit")} onClick={() => setEditing(s)}>
                      <Pencil />
                    </Button>
                  </Can>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
      {editing && <SupplierDialog supplier={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </Card>
  )
}

function SupplierDialog({ supplier, onClose }: { supplier: Supplier | null; onClose: () => void }) {
  const { t } = useT()
  const projects = useProjects()
  const save = useMutation(api.invoicing.saveSupplier)
  const { run, busy } = useAction()
  const [f, setF] = useState({ name: supplier?.name ?? "", emails: supplier?.emails.join(", ") ?? "", category: (supplier?.category ?? "accommodation") as CostCategory, projectId: supplier?.defaultProjectId ?? "", active: supplier?.active ?? true })
  async function submit(e: FormEvent) {
    e.preventDefault()
    const ok = await run(
      () =>
        save({
          ...(supplier ? { supplierId: supplier.id as Id<"staffing_invoicing_suppliers"> } : {}),
          name: f.name,
          emails: f.emails.split(/[,\s]+/).filter(Boolean),
          category: f.category,
          defaultProjectId: f.projectId ? (f.projectId as Id<"staffing_projects">) : null,
          active: f.active,
        }),
      { success: t("staffing.common.saved") },
    )
    if (ok) onClose()
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={(e) => void submit(e)} className="grid gap-5">
          <DialogHeader>
            <DialogTitle>{supplier ? supplier.name : t("invoicing.suppliers.add")}</DialogTitle>
            <DialogDescription>{t("invoicing.suppliers.emailsHint")}</DialogDescription>
          </DialogHeader>
          <FieldGroup className="grid gap-4">
            <Field>
              <FieldLabel htmlFor="su-name">{t("invoicing.purchases.supplier")}</FieldLabel>
              <Input id="su-name" required value={f.name} onChange={(e) => setF((x) => ({ ...x, name: e.target.value }))} />
            </Field>
            <Field>
              <FieldLabel htmlFor="su-emails">{t("invoicing.suppliers.emails")}</FieldLabel>
              <Input id="su-emails" placeholder="saskaitos@tiekejas.lt, @tiekejas.lt" value={f.emails} onChange={(e) => setF((x) => ({ ...x, emails: e.target.value }))} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="su-cat">{t("invoicing.cost.category")}</FieldLabel>
                <NativeSelect id="su-cat" value={f.category} onChange={(v) => setF((x) => ({ ...x, category: v as CostCategory }))}>
                  {COST_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {t(`invoicing.cost.cat.${c}` as MessageKey)}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field>
                <FieldLabel htmlFor="su-proj">{t("invoicing.suppliers.defaultProject")}</FieldLabel>
                <NativeSelect id="su-proj" value={f.projectId} onChange={(v) => setF((x) => ({ ...x, projectId: v }))}>
                  <option value="">—</option>
                  {projects?.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.code}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={f.active} onChange={(e) => setF((x) => ({ ...x, active: e.target.checked }))} />
              {t("invoicing.suppliers.active")}
            </label>
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
