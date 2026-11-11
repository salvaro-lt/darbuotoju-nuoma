"use client"
import type { ClientKind, ClientView, InvoicingPeriod } from "@digimuza/staffing"
import { CLIENT_KINDS, INVOICING_PERIODS } from "@digimuza/staffing/pure"
import { StaffingPermissions } from "@digimuza/staffing/manifest"
import { Can } from "@digimuza/system-core/react"
import { useMutation, useQuery } from "convex/react"
import { Building2, Pencil, Plus, Trash2, X } from "lucide-react"
import { useState, type FormEvent } from "react"
import { EmptyState } from "@/components/app/empty-state"
import { PageHeader } from "@/components/app/page-header"
import { useAction } from "@/components/app/use-action"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { useT } from "@/lib/i18n/client"
import type { MessageKey } from "@/lib/i18n/messages"
import { RatesEditor, type RateRow } from "./rates-editor"
import { centsToEur, ConfirmDelete, Disabled, eurToCents, NativeSelect, useStaffingEnabled } from "./staffing-ui"

export function ClientsList() {
  const { t } = useT()
  const enabled = useStaffingEnabled()
  const clients = useQuery(api.staffing.listClients, enabled ? {} : "skip")
  const del = useMutation(api.staffing.deleteClient)
  const { run, busy } = useAction()
  const [editing, setEditing] = useState<ClientView | "new" | null>(null)
  const [deleting, setDeleting] = useState<ClientView | null>(null)
  if (!enabled) return <Disabled />
  const newButton = (
    <Can permission={StaffingPermissions.clientCreate}>
      <Button size="sm" onClick={() => setEditing("new")}>
        <Plus />
        {t("staffing.clients.new")}
      </Button>
    </Can>
  )
  return (
    <div>
      <PageHeader title={t("staffing.clients.title")} lead={t("staffing.clients.lead")} actions={newButton} />
      {!clients ? (
        <Skeleton className="h-64 w-full rounded-xl" />
      ) : clients.length === 0 ? (
        <EmptyState icon={<Building2 />} title={t("staffing.clients.empty")} body={t("staffing.clients.emptyBody")} action={newButton} />
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="px-4">{t("staffing.common.name")}</TableHead>
                <TableHead>{t("staffing.common.code")}</TableHead>
                <TableHead>{t("staffing.clients.kind")}</TableHead>
                <TableHead>{t("staffing.common.country")}</TableHead>
                <TableHead>{t("staffing.clients.invoicing")}</TableHead>
                <TableHead className="text-right">{t("staffing.clients.paymentTerms")}</TableHead>
                <TableHead className="text-right">{t("staffing.clients.projects")}</TableHead>
                <TableHead className="text-right">{t("staffing.clients.workers")}</TableHead>
                <TableHead className="w-20" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {clients.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="px-4 font-medium">{c.name}</TableCell>
                  <TableCell className="font-mono text-xs">{c.code}</TableCell>
                  <TableCell>{t(`staffing.clientKind.${c.kind}` as MessageKey)}</TableCell>
                  <TableCell>{c.country}</TableCell>
                  <TableCell>{t(`staffing.period.${c.invoicingPeriod}` as MessageKey)}</TableCell>
                  <TableCell className="text-right tabular-nums">{c.paymentTermsDays}</TableCell>
                  <TableCell className="text-right tabular-nums">{c.projectCount}</TableCell>
                  <TableCell className="text-right tabular-nums">{c.workerCount}</TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1 pr-2">
                      <Can permission={StaffingPermissions.clientUpdate}>
                        <Button variant="ghost" size="icon-sm" aria-label={`${t("staffing.common.edit")}: ${c.name}`} onClick={() => setEditing(c)}>
                          <Pencil />
                        </Button>
                      </Can>
                      <Can permission={StaffingPermissions.clientDelete}>
                        <Button variant="ghost" size="icon-sm" aria-label={`${t("staffing.common.delete")}: ${c.name}`} onClick={() => setDeleting(c)}>
                          <Trash2 />
                        </Button>
                      </Can>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {editing && <ClientDialog client={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
      <ConfirmDelete
        open={!!deleting}
        title={`${t("staffing.common.confirmDelete")} ${deleting?.name ?? ""}`}
        body={t("staffing.clients.deleteBody")}
        busy={busy}
        onCancel={() => setDeleting(null)}
        onConfirm={() => void run(() => del({ clientId: deleting!.id }), { success: t("staffing.common.deleted") }).then(() => setDeleting(null))}
      />
    </div>
  )
}

function ClientDialog({ client, onClose }: { client: ClientView | null; onClose: () => void }) {
  const { t } = useT()
  const create = useMutation(api.staffing.createClient)
  const update = useMutation(api.staffing.updateClient)
  const { run, busy } = useAction()
  const [f, setF] = useState({
    name: client?.name ?? "",
    code: client?.code ?? "",
    kind: (client?.kind ?? "client") as ClientKind,
    country: client?.country ?? "",
    vatCode: client?.vatCode ?? "",
    companyCode: client?.companyCode ?? "",
    address: client?.address ?? "",
    paymentTermsDays: String(client?.paymentTermsDays ?? 30),
    invoicingPeriod: (client?.invoicingPeriod ?? "monthly") as InvoicingPeriod,
    notes: client?.notes ?? "",
  })
  const [contacts, setContacts] = useState(client?.contacts.map((c) => ({ name: c.name, role: c.role ?? "", email: c.email ?? "", phone: c.phone ?? "" })) ?? [])
  const [rates, setRates] = useState<RateRow[]>(client?.defaultRates.map((r) => ({ tradeId: r.tradeId, eur: centsToEur(r.hourlyRateCents) })) ?? [])
  const set = (k: keyof typeof f) => (v: string) => setF((s) => ({ ...s, [k]: v }))

  async function submit(e: FormEvent) {
    e.preventDefault()
    const args = {
      name: f.name,
      code: f.code,
      kind: f.kind,
      country: f.country,
      vatCode: f.vatCode || undefined,
      companyCode: f.companyCode || undefined,
      address: f.address || undefined,
      contacts: contacts.filter((c) => c.name.trim()).map((c) => ({ name: c.name, role: c.role || undefined, email: c.email || undefined, phone: c.phone || undefined })),
      defaultRates: rates.filter((r) => r.tradeId && r.eur).map((r) => ({ tradeId: r.tradeId as Id<"staffing_trades">, hourlyRateCents: eurToCents(r.eur) })),
      paymentTermsDays: Number(f.paymentTermsDays),
      invoicingPeriod: f.invoicingPeriod,
      notes: f.notes,
    }
    const res = client ? await run(() => update({ clientId: client.id, ...args }), { success: t("staffing.common.saved") }) : await run(() => create(args), { success: t("staffing.common.created") })
    if (res) onClose()
  }

  const text = (k: keyof typeof f, label: MessageKey, props: { required?: boolean; type?: string } = {}) => (
    <Field>
      <FieldLabel htmlFor={`c-${k}`}>{t(label)}</FieldLabel>
      <Input id={`c-${k}`} value={f[k]} onChange={(e) => set(k)(e.target.value)} {...props} />
    </Field>
  )

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <form onSubmit={(e) => void submit(e)} className="grid gap-5">
          <DialogHeader>
            <DialogTitle>{client ? t("staffing.clients.edit") : t("staffing.clients.new")}</DialogTitle>
          </DialogHeader>
          <FieldGroup className="grid gap-4 sm:grid-cols-2">
            {text("name", "staffing.common.name", { required: true })}
            {text("code", "staffing.common.code", { required: true })}
            <Field>
              <FieldLabel htmlFor="c-kind">{t("staffing.clients.kind")}</FieldLabel>
              <NativeSelect id="c-kind" value={f.kind} onChange={set("kind")}>
                {CLIENT_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {t(`staffing.clientKind.${k}` as MessageKey)}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            {text("country", "staffing.common.country", { required: true })}
            {text("vatCode", "staffing.clients.vat")}
            {text("companyCode", "staffing.clients.companyCode")}
            {text("address", "staffing.clients.address")}
            {text("paymentTermsDays", "staffing.clients.paymentTerms", { required: true, type: "number" })}
            <Field>
              <FieldLabel htmlFor="c-period">{t("staffing.clients.invoicing")}</FieldLabel>
              <NativeSelect id="c-period" value={f.invoicingPeriod} onChange={set("invoicingPeriod")}>
                {INVOICING_PERIODS.map((p) => (
                  <option key={p} value={p}>
                    {t(`staffing.period.${p}` as MessageKey)}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </FieldGroup>
          <Field>
            <FieldLabel>{t("staffing.clients.contacts")}</FieldLabel>
            <div className="grid gap-2">
              {contacts.map((c, i) => (
                <div key={i} className="grid grid-cols-[1fr_1fr_1fr_1fr_auto] gap-2">
                  {(["name", "role", "email", "phone"] as const).map((k) => (
                    <Input
                      key={k}
                      aria-label={k}
                      placeholder={k === "name" ? t("staffing.clients.contactName") : k === "role" ? t("staffing.clients.contactRole") : k === "email" ? t("staffing.worker.email") : t("staffing.worker.phone")}
                      value={c[k]}
                      onChange={(e) => setContacts((s) => s.map((x, j) => (j === i ? { ...x, [k]: e.target.value } : x)))}
                    />
                  ))}
                  <Button type="button" variant="ghost" size="icon" aria-label={t("staffing.common.delete")} onClick={() => setContacts((s) => s.filter((_, j) => j !== i))}>
                    <X />
                  </Button>
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" className="w-fit" onClick={() => setContacts((s) => [...s, { name: "", role: "", email: "", phone: "" }])}>
                <Plus />
                {t("staffing.clients.addContact")}
              </Button>
            </div>
          </Field>
          <Field>
            <FieldLabel>{t("staffing.common.rates")}</FieldLabel>
            <RatesEditor rows={rates} onChange={setRates} />
          </Field>
          <Field>
            <FieldLabel htmlFor="c-notes">{t("staffing.common.notes")}</FieldLabel>
            <Textarea id="c-notes" rows={2} value={f.notes} onChange={(e) => set("notes")(e.target.value)} />
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
