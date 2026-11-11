"use client"
import { StaffingInvoicingPermissions as P } from "@digimuza/staffing/invoicing/manifest"
import { INVOICE_STATUSES, type InvoiceStatus } from "@digimuza/staffing/invoicing/pure"
import { Can } from "@digimuza/system-core/react"
import { useConvex, useMutation, useQuery } from "convex/react"
import { ArrowLeft, BellRing, Check, Download, FileSpreadsheet, Plus, Printer, RefreshCw, Send, Trash2, Wallet } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState, type FormEvent } from "react"
import { EmptyState } from "@/components/app/empty-state"
import { PageHeader } from "@/components/app/page-header"
import { useAction } from "@/components/app/use-action"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { useT } from "@/lib/i18n/client"
import type { MessageKey } from "@/lib/i18n/messages"
import { ConfirmDelete, NativeSelect, projectHref } from "../../staffing/_components/staffing-ui"
import { downloadText, fmtHours, InvoiceStatusBadge, InvoicingDisabled, InvoicingTabs, invoiceHref, invoicePrintHref, useInvoicingEnabled, useMoney } from "./invoicing-ui"

type InvoiceId = Id<"staffing_invoicing_invoices">

// ---------------------------------------------------------------- list

export function InvoicesList() {
  const { t } = useT()
  const money = useMoney()
  const enabled = useInvoicingEnabled()
  const [status, setStatus] = useState<"" | InvoiceStatus | "overdue">("")
  const invoices = useQuery(api.invoicing.listInvoices, enabled ? (status === "overdue" ? { overdueOnly: true } : status ? { status } : {}) : "skip")
  const [creating, setCreating] = useState(false)
  const [exporting, setExporting] = useState(false)
  if (!enabled) return <InvoicingDisabled />
  const actions = (
    <>
      <Button size="sm" variant="outline" onClick={() => setExporting(true)}>
        <FileSpreadsheet />
        {t("invoicing.export.bulk")}
      </Button>
      <Can permission={P.invoiceManage}>
        <Button size="sm" onClick={() => setCreating(true)}>
          <Plus />
          {t("invoicing.new")}
        </Button>
      </Can>
    </>
  )
  const total = (invoices ?? []).reduce((s, i) => s + i.outstandingCents, 0)
  return (
    <div>
      <PageHeader title={t("invoicing.title")} lead={t("invoicing.lead")} actions={actions} />
      <InvoicingTabs />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <NativeSelect aria-label={t("invoicing.col.status")} value={status} onChange={(v) => setStatus(v as typeof status)}>
          <option value="">{t("invoicing.filter.all")}</option>
          {INVOICE_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`invoicing.status.${s}` as MessageKey)}
            </option>
          ))}
          <option value="overdue">{t("invoicing.filter.overdue")}</option>
        </NativeSelect>
        {invoices && invoices.length > 0 && (
          <span className="text-sm text-muted-foreground">
            {t("invoicing.outstandingTotal")}: <span className="font-medium text-foreground tabular-nums">{money(total)}</span>
          </span>
        )}
      </div>
      {!invoices ? (
        <Skeleton className="h-64 w-full rounded-xl" />
      ) : invoices.length === 0 ? (
        <EmptyState icon={<FileSpreadsheet />} title={t("invoicing.empty")} body={t("invoicing.emptyBody")} />
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="px-4">{t("invoicing.col.number")}</TableHead>
                <TableHead>{t("invoicing.col.client")}</TableHead>
                <TableHead>{t("invoicing.col.period")}</TableHead>
                <TableHead>{t("invoicing.col.projects")}</TableHead>
                <TableHead>{t("invoicing.col.issueDate")}</TableHead>
                <TableHead>{t("invoicing.col.dueDate")}</TableHead>
                <TableHead>{t("invoicing.col.status")}</TableHead>
                <TableHead className="text-right">{t("invoicing.col.total")}</TableHead>
                <TableHead className="pr-4 text-right">{t("invoicing.col.outstanding")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoices.map((i) => (
                <TableRow key={i.id}>
                  <TableCell className="px-4 font-mono text-xs">
                    <Link href={invoiceHref(i.id)} className="font-medium hover:underline">
                      {i.number ?? t("invoicing.draftNumber")}
                    </Link>
                  </TableCell>
                  <TableCell className="font-medium">{i.clientName}</TableCell>
                  <TableCell className="whitespace-nowrap tabular-nums">
                    {i.periodFrom} – {i.periodTo}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{i.projectCodes.join(", ")}</TableCell>
                  <TableCell className="tabular-nums">{i.issueDate ?? "—"}</TableCell>
                  <TableCell className="tabular-nums">{i.dueDate ?? "—"}</TableCell>
                  <TableCell>
                    <InvoiceStatusBadge status={i.status} overdueDays={i.daysOverdue} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{money(i.totalCents, i.currency)}</TableCell>
                  <TableCell className={`pr-4 text-right tabular-nums ${i.overdue ? "font-semibold text-red-600 dark:text-red-400" : ""}`}>{i.outstandingCents ? money(i.outstandingCents, i.currency) : "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {creating && <NewDraftDialog onClose={() => setCreating(false)} />}
      {exporting && <BulkExportDialog onClose={() => setExporting(false)} />}
    </div>
  )
}

function NewDraftDialog({ onClose }: { onClose: () => void }) {
  const { t } = useT()
  const router = useRouter()
  const overview = useQuery(api.invoicing.billingOverview, {})
  const create = useMutation(api.invoicing.createDraft)
  const { run, busy } = useAction()
  const [clientId, setClientId] = useState("")
  const [period, setPeriod] = useState({ from: "", to: "" })
  const client = overview?.find((c) => c.clientId === clientId)

  function pick(id: string) {
    setClientId(id)
    const c = overview?.find((x) => x.clientId === id)
    if (c) setPeriod(c.suggested)
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    const res = await run(() => create({ clientId: clientId as Id<"staffing_clients">, from: period.from, to: period.to }), { success: t("invoicing.created") })
    if (res) {
      onClose()
      router.push(invoiceHref(res.id))
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={(e) => void submit(e)} className="grid gap-5">
          <DialogHeader>
            <DialogTitle>{t("invoicing.new")}</DialogTitle>
            <DialogDescription>{t("invoicing.newLead")}</DialogDescription>
          </DialogHeader>
          <FieldGroup className="grid gap-4">
            <Field>
              <FieldLabel htmlFor="d-client">{t("invoicing.col.client")}</FieldLabel>
              <NativeSelect id="d-client" required value={clientId} onChange={pick}>
                <option value="" />
                {overview?.map((c) => (
                  <option key={c.clientId} value={c.clientId}>
                    {c.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            {client && (
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-lg bg-muted/50 p-3 text-sm">
                <dt className="text-muted-foreground">{t("invoicing.client.period")}</dt>
                <dd>{t(`invoicing.period.${client.invoicingPeriod}` as MessageKey)}</dd>
                <dt className="text-muted-foreground">{t("invoicing.client.terms")}</dt>
                <dd>{t("invoicing.days").replace("{days}", String(client.paymentTermsDays))}</dd>
                <dt className="text-muted-foreground">{t("invoicing.client.lastInvoiced")}</dt>
                <dd className="tabular-nums">{client.lastInvoicedTo ?? "—"}</dd>
                <dt className="text-muted-foreground">{t("invoicing.client.surcharges")}</dt>
                <dd>
                  {client.overtimePct}% / {client.weekendPct}%
                </dd>
                <dt className="text-muted-foreground">{t("invoicing.client.projects")}</dt>
                <dd className="font-mono text-xs">{client.activeProjects.map((p) => p.code).join(", ") || "—"}</dd>
              </dl>
            )}
            <div className="grid grid-cols-2 gap-4">
              <Field>
                <FieldLabel htmlFor="d-from">{t("invoicing.from")}</FieldLabel>
                <Input id="d-from" type="date" required value={period.from} onChange={(e) => setPeriod((p) => ({ ...p, from: e.target.value }))} />
              </Field>
              <Field>
                <FieldLabel htmlFor="d-to">{t("invoicing.to")}</FieldLabel>
                <Input id="d-to" type="date" required value={period.to} onChange={(e) => setPeriod((p) => ({ ...p, to: e.target.value }))} />
              </Field>
            </div>
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t("staffing.common.cancel")}
            </Button>
            <Button type="submit" disabled={busy || !clientId}>
              {t("invoicing.generate")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function BulkExportDialog({ onClose }: { onClose: () => void }) {
  const { t } = useT()
  const convex = useConvex()
  const { run, busy } = useAction()
  const today = new Date().toISOString().slice(0, 10)
  const [range, setRange] = useState({ from: `${today.slice(0, 7)}-01`, to: today })

  async function submit(e: FormEvent) {
    e.preventDefault()
    const res = await run(() => convex.query(api.invoicing.siteProExport, { from: range.from, to: range.to }))
    if (!res) return
    downloadText(res.fileName, res.csv)
    onClose()
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={(e) => void submit(e)} className="grid gap-5">
          <DialogHeader>
            <DialogTitle>{t("invoicing.export.title")}</DialogTitle>
            <DialogDescription>{t("invoicing.export.bulkLead")}</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4">
            <Field>
              <FieldLabel htmlFor="x-from">{t("invoicing.from")}</FieldLabel>
              <Input id="x-from" type="date" required value={range.from} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} />
            </Field>
            <Field>
              <FieldLabel htmlFor="x-to">{t("invoicing.to")}</FieldLabel>
              <Input id="x-to" type="date" required value={range.to} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} />
            </Field>
          </div>
          <p className="text-xs text-muted-foreground">{t("invoicing.export.formatNote")}</p>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t("staffing.common.cancel")}
            </Button>
            <Button type="submit" disabled={busy}>
              <Download />
              {t("invoicing.export.download")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------- detail

export function InvoiceDetailView({ invoiceId }: { invoiceId: string }) {
  const { t, locale } = useT()
  const money = useMoney()
  const router = useRouter()
  const convex = useConvex()
  const enabled = useInvoicingEnabled()
  const id = invoiceId as InvoiceId
  const d = useQuery(api.invoicing.getInvoice, enabled ? { invoiceId: id } : "skip")
  const approve = useMutation(api.invoicing.approveInvoice)
  const markSent = useMutation(api.invoicing.markSent)
  const refresh = useMutation(api.invoicing.refreshDraft)
  const del = useMutation(api.invoicing.deleteDraft)
  const remind = useMutation(api.invoicing.sendReminder)
  const delPayment = useMutation(api.invoicing.deletePayment)
  const { run, busy } = useAction()
  const [paying, setPaying] = useState(false)
  const [deleting, setDeleting] = useState(false)
  if (!enabled) return <InvoicingDisabled />
  if (d === undefined) return <Skeleton className="h-96 w-full rounded-xl" />
  if (d === null) return <p className="text-sm text-muted-foreground">{t("invoicing.notFound")}</p>
  const inv = d.invoice
  const open = inv.status === "approved" || inv.status === "sent" || inv.status === "partially_paid"

  async function exportCsv() {
    const res = await run(() => convex.query(api.invoicing.siteProExport, { invoiceId: id }))
    if (res) downloadText(res.fileName, res.csv)
  }

  const tradeName = (l: { tradeNameLt: string; tradeNameEn: string }) => (locale === "en" ? l.tradeNameEn : l.tradeNameLt)

  return (
    <div>
      <Link href="/app/invoicing" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" />
        {t("invoicing.back")}
      </Link>
      <PageHeader
        title={`${inv.number ?? t("invoicing.draftNumber")} · ${inv.clientName}`}
        lead={`${t("invoicing.col.period")}: ${inv.periodFrom} – ${inv.periodTo}`}
        actions={
          <>
            {inv.status === "draft" && (
              <>
                <Can permission={P.invoiceManage}>
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => void run(() => refresh({ invoiceId: id }), { success: t("invoicing.refreshed") })}>
                    <RefreshCw />
                    {t("invoicing.refresh")}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setDeleting(true)}>
                    <Trash2 />
                    {t("staffing.common.delete")}
                  </Button>
                </Can>
                <Can permission={P.invoiceApprove}>
                  <Button size="sm" disabled={busy} onClick={() => void run(() => approve({ invoiceId: id }), { success: t("invoicing.approved") })}>
                    <Check />
                    {t("invoicing.approve")}
                  </Button>
                </Can>
              </>
            )}
            {inv.status !== "draft" && (
              <>
                <Button size="sm" variant="outline" onClick={() => void exportCsv()} disabled={busy}>
                  <FileSpreadsheet />
                  {t("invoicing.export.one")}
                </Button>
                <Button size="sm" variant="outline" asChild>
                  <a href={invoicePrintHref(inv.id)} target="_blank" rel="noreferrer">
                    <Printer />
                    {t("invoicing.print")}
                  </a>
                </Button>
              </>
            )}
            {inv.status === "approved" && (
              <Can permission={P.invoiceManage}>
                <Button size="sm" disabled={busy} onClick={() => void run(() => markSent({ invoiceId: id }), { success: t("invoicing.markedSent") })}>
                  <Send />
                  {t("invoicing.markSent")}
                </Button>
              </Can>
            )}
            {open && (
              <Can permission={P.paymentManage}>
                <Button size="sm" onClick={() => setPaying(true)}>
                  <Wallet />
                  {t("invoicing.payment.add")}
                </Button>
              </Can>
            )}
            {open && inv.overdue && (
              <Can permission={P.invoiceManage}>
                <Button size="sm" variant="destructive" disabled={busy} onClick={() => void run(() => remind({ invoiceId: id }), { success: t("invoicing.reminder.queued") })}>
                  <BellRing />
                  {t("invoicing.reminder.send")}
                </Button>
              </Can>
            )}
          </>
        }
      />
      <InvoicingTabs />

      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("invoicing.lines")}</CardTitle>
          </CardHeader>
          <CardContent className="px-0">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="px-4">{t("invoicing.col.project")}</TableHead>
                  <TableHead>{t("invoicing.col.trade")}</TableHead>
                  <TableHead>{t("invoicing.col.rateType")}</TableHead>
                  <TableHead className="text-right">{t("invoicing.col.hours")}</TableHead>
                  <TableHead className="text-right">{t("invoicing.col.unitPrice")}</TableHead>
                  <TableHead className="pr-4 text-right">{t("invoicing.col.amount")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {d.lines.map((l, i) => (
                  <TableRow key={i}>
                    <TableCell className="px-4">
                      <Link href={projectHref(l.projectId)} className="font-mono text-xs hover:underline">
                        {l.projectCode}
                      </Link>
                    </TableCell>
                    <TableCell>{tradeName(l)}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      {t(`invoicing.rateType.${l.rateType}` as MessageKey)}
                      {l.multiplierPct !== 100 && <span className="ml-1 text-xs text-muted-foreground">×{(l.multiplierPct / 100).toFixed(2)}</span>}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{fmtHours(l.hours)}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(l.unitPriceCents, inv.currency)}</TableCell>
                    <TableCell className="pr-4 text-right tabular-nums">{money(l.amountCents, inv.currency)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={5} className="px-4 text-right">
                    {t("invoicing.subtotal")}
                  </TableCell>
                  <TableCell className="pr-4 text-right tabular-nums">{money(inv.subtotalCents, inv.currency)}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell colSpan={5} className="px-4 text-right">
                    {t("invoicing.vat")} {d.vatRatePct}%{d.vatRatePct === 0 && <span className="ml-1 text-xs font-normal text-muted-foreground">({t("invoicing.reverseCharge")})</span>}
                  </TableCell>
                  <TableCell className="pr-4 text-right tabular-nums">{money(inv.vatCents, inv.currency)}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell colSpan={5} className="px-4 text-right font-semibold">
                    {t("invoicing.total")}
                  </TableCell>
                  <TableCell className="pr-4 text-right font-semibold tabular-nums">{money(inv.totalCents, inv.currency)}</TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </CardContent>
        </Card>

        <div className="grid content-start gap-4">
          <Card>
            <CardContent className="grid gap-2 text-sm">
              <Row label={t("invoicing.col.status")}>
                <InvoiceStatusBadge status={inv.status} overdueDays={inv.daysOverdue} />
              </Row>
              <Row label={t("invoicing.col.issueDate")}>{inv.issueDate ?? "—"}</Row>
              <Row label={t("invoicing.col.dueDate")}>{inv.dueDate ?? `+${d.client.paymentTermsDays} d.`}</Row>
              <Row label={t("invoicing.paid")}>{money(inv.paidCents, inv.currency)}</Row>
              <Row label={t("invoicing.col.outstanding")}>
                <span className={inv.overdue ? "font-semibold text-red-600 dark:text-red-400" : "font-semibold"}>{money(inv.outstandingCents, inv.currency)}</span>
              </Row>
              <Row label={t("invoicing.client.contact")}>{d.client.contactName ? `${d.client.contactName}${d.client.contactEmail ? ` · ${d.client.contactEmail}` : ""}` : "—"}</Row>
              {d.nextReminder && (
                <Row label={t("invoicing.reminder.next")}>
                  {t(`invoicing.reminder.stage${d.nextReminder.stage}` as MessageKey)} · {d.nextReminder.on}
                </Row>
              )}
            </CardContent>
          </Card>

          {inv.status !== "draft" && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t("invoicing.payments")}</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-2 text-sm">
                {d.payments.length === 0 && <p className="text-muted-foreground">{t("invoicing.payment.none")}</p>}
                {d.payments.map((p) => (
                  <div key={p.id} className="flex items-center justify-between gap-2">
                    <div>
                      <div className="tabular-nums">
                        {p.date} · <span className="font-medium">{money(p.amountCents, inv.currency)}</span>
                      </div>
                      {p.reference && <div className="text-xs text-muted-foreground">{p.reference}</div>}
                    </div>
                    <Can permission={P.paymentManage}>
                      <Button size="icon" variant="ghost" aria-label={t("staffing.common.delete")} disabled={busy} onClick={() => void run(() => delPayment({ paymentId: p.id as Id<"staffing_invoicing_payments"> }), { success: t("staffing.common.deleted") })}>
                        <Trash2 />
                      </Button>
                    </Can>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {d.reminders.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t("invoicing.reminders")}</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-2 text-sm">
                {d.reminders.map((r) => (
                  <div key={r.id} className="flex items-center justify-between gap-2">
                    <span>
                      {t(`invoicing.reminder.stage${r.stage}` as MessageKey)} <span className="text-xs text-muted-foreground">(+{r.daysOverdue} d.)</span>
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {new Date(r.at).toLocaleDateString("lt-LT")} · {t(`invoicing.reminder.status.${r.status}` as MessageKey)}
                    </span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
          {d.notes && <p className="text-sm text-muted-foreground">{d.notes}</p>}
        </div>
      </div>

      {paying && <PaymentDialog invoiceId={id} outstandingCents={inv.outstandingCents} onClose={() => setPaying(false)} />}
      <ConfirmDelete
        open={deleting}
        title={t("invoicing.deleteDraft")}
        body={t("invoicing.deleteDraftBody")}
        busy={busy}
        onCancel={() => setDeleting(false)}
        onConfirm={async () => {
          if (await run(() => del({ invoiceId: id }), { success: t("staffing.common.deleted") })) router.push("/app/invoicing")
        }}
      />
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right">{children}</span>
    </div>
  )
}

function PaymentDialog({ invoiceId, outstandingCents, onClose }: { invoiceId: InvoiceId; outstandingCents: number; onClose: () => void }) {
  const { t } = useT()
  const record = useMutation(api.invoicing.recordPayment)
  const { run, busy } = useAction()
  const [f, setF] = useState({ date: new Date().toISOString().slice(0, 10), amount: (outstandingCents / 100).toFixed(2), reference: "" })

  async function submit(e: FormEvent) {
    e.preventDefault()
    const amountCents = Math.round(Number(f.amount.replace(",", ".")) * 100)
    if (await run(() => record({ invoiceId, date: f.date, amountCents, reference: f.reference || undefined }), { success: t("invoicing.payment.saved") })) onClose()
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={(e) => void submit(e)} className="grid gap-5">
          <DialogHeader>
            <DialogTitle>{t("invoicing.payment.add")}</DialogTitle>
          </DialogHeader>
          <FieldGroup className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="pay-date">{t("invoicing.payment.date")}</FieldLabel>
              <Input id="pay-date" type="date" required value={f.date} onChange={(e) => setF((s) => ({ ...s, date: e.target.value }))} />
            </Field>
            <Field>
              <FieldLabel htmlFor="pay-amount">{t("invoicing.payment.amount")}</FieldLabel>
              <Input id="pay-amount" inputMode="decimal" required value={f.amount} onChange={(e) => setF((s) => ({ ...s, amount: e.target.value }))} />
            </Field>
          </FieldGroup>
          <Field>
            <FieldLabel htmlFor="pay-ref">{t("invoicing.payment.reference")}</FieldLabel>
            <Input id="pay-ref" value={f.reference} onChange={(e) => setF((s) => ({ ...s, reference: e.target.value }))} />
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
