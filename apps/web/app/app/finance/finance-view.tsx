"use client"
import { Can, useCan, useFeatureFlag, useVisibleModules } from "@digimuza/system-core/react"
import { useMutation, useQuery } from "convex/react"
import { Check, FileText, Plus } from "lucide-react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useEffect, useState, type FormEvent } from "react"
import { DataTable, type ColumnDef } from "@/components/app/data-table"
import { EmptyState } from "@/components/app/empty-state"
import { PageHeader } from "@/components/app/page-header"
import { StatusBadge } from "@/components/app/status-badge"
import { useAction } from "@/components/app/use-action"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { formatDate, formatMoney } from "@/lib/format"
import { useT } from "@/lib/i18n/client"
import { FinancePermissions, type InvoiceView } from "@digimuza/system-core/finance"

export function FinanceView() {
  const { t, locale } = useT()
  const enabled = useVisibleModules().some((m) => m.id === "finance" && m.effective)
  const invoices = useQuery(api.finance.listInvoices, enabled ? {} : "skip")
  const approve = useMutation(api.finance.approveInvoice)
  const bulkApprove = useMutation(api.finance.bulkApproveInvoices)
  const canApprove = useCan(FinancePermissions.approve)
  const bulkOn = useFeatureFlag("finance:bulk-approve") && canApprove
  const { run, busy } = useAction()
  const [creating, setCreating] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  // Links from the command palette: ?invoice=<number> highlights that row, ?new=1 opens the create dialog.
  const params = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const target = params.get("invoice")
  const canCreate = useCan(FinancePermissions.create)
  const wantNew = params.get("new") === "1" && canCreate
  const targetFound = !!target && !!invoices?.some((i) => i.number === target)
  useEffect(() => {
    if (targetFound) document.querySelector(`[data-invoice-target]`)?.scrollIntoView({ block: "center", behavior: "smooth" })
  }, [targetFound, target])
  const setCreateOpen = (v: boolean) => {
    setCreating(v)
    if (!v && wantNew) router.replace(pathname)
  }

  if (!enabled) return <p className="text-sm text-muted-foreground">{t("fin.disabled")}</p>

  const drafts = (invoices ?? []).filter((i) => i.status === "draft")
  const toggle = (id: string, on: boolean) =>
    setSelected((s) => {
      const n = new Set(s)
      if (on) n.add(id)
      else n.delete(id)
      return n
    })

  const columns: ColumnDef<InvoiceView>[] = [
    ...(bulkOn
      ? [
          {
            id: "select",
            header: () => (
              <Checkbox
                aria-label={t("fin.approveSelected")}
                checked={drafts.length > 0 && drafts.every((d) => selected.has(d.id))}
                onCheckedChange={(v) => setSelected(v ? new Set(drafts.map((d) => d.id)) : new Set())}
              />
            ),
            meta: { className: "w-10" },
            cell: ({ row }: { row: { original: InvoiceView } }) =>
              row.original.status === "draft" ? (
                <Checkbox aria-label={`${t("fin.approve")} ${row.original.number}`} checked={selected.has(row.original.id)} onCheckedChange={(v) => toggle(row.original.id, v === true)} />
              ) : null,
          } satisfies ColumnDef<InvoiceView>,
        ]
      : []),
    { accessorKey: "number", header: t("fin.number"), cell: ({ row }) => <span className="font-mono text-[13px]" data-invoice-target={row.original.number === target || undefined}>{row.original.number}</span> },
    { accessorKey: "customer", header: t("fin.customer"), cell: ({ row }) => <span className="font-medium">{row.original.customer}</span> },
    { accessorKey: "createdAt", header: t("common.created"), cell: ({ row }) => <span className="text-muted-foreground">{formatDate(row.original.createdAt, locale)}</span> },
    { accessorKey: "amountCents", header: t("fin.amount"), meta: { align: "end" }, cell: ({ row }) => formatMoney(row.original.amountCents, row.original.currency, locale) },
    {
      accessorKey: "status",
      header: t("common.status"),
      cell: ({ row }) =>
        row.original.status === "draft" ? (
          <StatusBadge tone="neutral">{t("fin.status.draft")}</StatusBadge>
        ) : (
          <StatusBadge tone="positive">
            <Check />
            {t("fin.status.approved")}
          </StatusBadge>
        ),
    },
    {
      id: "actions",
      header: "",
      meta: { align: "end" },
      cell: ({ row }) =>
        row.original.status === "draft" && canApprove ? (
          // UI hint only: approveInvoice re-checks finance:invoice:approve on the server.
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void run(() => approve({ invoiceId: row.original.id as Id<"invoices"> }), { success: t("fin.approved") })}>
            {t("fin.approve")}
          </Button>
        ) : null,
    },
  ]

  async function approveSelected() {
    const ids = [...selected].filter((id) => drafts.some((d) => d.id === id)) as Id<"invoices">[]
    const res = await run(() => bulkApprove({ invoiceIds: ids }), { success: `${t("fin.bulkApproved")} ${ids.length}` })
    if (res) setSelected(new Set())
  }

  const newButton = (
    <Can permission={FinancePermissions.create}>
      <Button onClick={() => setCreating(true)}>
        <Plus />
        {t("fin.new")}
      </Button>
    </Can>
  )

  return (
    <>
      <PageHeader
        title={t("fin.title")}
        lead={t("fin.lead")}
        actions={
          <>
            {bulkOn && selected.size > 0 && (
              <Button variant="outline" disabled={busy} onClick={() => void approveSelected()}>
                <Check />
                {t("fin.approveSelected")} ({selected.size})
              </Button>
            )}
            {newButton}
          </>
        }
      />
      {invoices?.length === 0 ? (
        <EmptyState icon={<FileText />} title={t("fin.empty.title")} body={t("fin.empty.body")} action={newButton} />
      ) : (
        <div className="contents [&_tr:has([data-invoice-target])]:bg-primary/10 [&_tr:has([data-invoice-target])]:hover:bg-primary/15">
          <DataTable label={t("fin.title")} rows={invoices} columns={columns} getRowId={(i) => i.id} />
        </div>
      )}
      <NewInvoiceDialog open={creating || wantNew} onOpenChange={setCreateOpen} />
    </>
  )
}

function NewInvoiceDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { t } = useT()
  const create = useMutation(api.finance.createInvoice)
  const { run, busy } = useAction()
  const [number, setNumber] = useState("")
  const [customer, setCustomer] = useState("")
  const [amount, setAmount] = useState("")

  async function submit(e: FormEvent) {
    e.preventDefault()
    const value = Number(amount.replace(",", "."))
    if (!(value > 0)) return
    const res = await run(() => create({ number, customer, amountCents: Math.round(value * 100) }), { success: t("fin.created") })
    if (res) {
      setNumber("")
      setCustomer("")
      setAmount("")
      onOpenChange(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="grid gap-6">
          <DialogHeader>
            <DialogTitle>{t("fin.new")}</DialogTitle>
            <DialogDescription>{t("fin.empty.body")}</DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="inv-number">{t("fin.number")}</FieldLabel>
              <Input id="inv-number" required autoFocus value={number} onChange={(e) => setNumber(e.target.value)} />
            </Field>
            <Field>
              <FieldLabel htmlFor="inv-customer">{t("fin.customer")}</FieldLabel>
              <Input id="inv-customer" required value={customer} onChange={(e) => setCustomer(e.target.value)} />
            </Field>
            <Field>
              <FieldLabel htmlFor="inv-amount">{t("fin.amountEur")}</FieldLabel>
              <Input id="inv-amount" required inputMode="decimal" pattern="[0-9]+([.,][0-9]{1,2})?" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={busy}>
              {t("common.create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
