"use client"
import type { CertificateTypeView, TradeView } from "@digimuza/staffing"
import { useMutation } from "convex/react"
import { Pencil, Plus, Trash2 } from "lucide-react"
import { useState, type FormEvent } from "react"
import { PageHeader } from "@/components/app/page-header"
import { useAction } from "@/components/app/use-action"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { api } from "@/convex/_generated/api"
import { useT } from "@/lib/i18n/client"
import { ConfirmDelete, Disabled, useCertificateTypes, useStaffingEnabled, useTrades } from "./staffing-ui"

export function CatalogView() {
  const { t } = useT()
  const enabled = useStaffingEnabled()
  const trades = useTrades()
  const types = useCertificateTypes()
  if (!enabled) return <Disabled />
  return (
    <div>
      <PageHeader title={t("staffing.catalog.title")} lead={t("staffing.catalog.lead")} />
      <Tabs defaultValue="trades">
        <TabsList>
          <TabsTrigger value="trades">{t("staffing.catalog.trades")}</TabsTrigger>
          <TabsTrigger value="certs">{t("staffing.catalog.certTypes")}</TabsTrigger>
        </TabsList>
        <TabsContent value="trades" className="pt-4">
          {trades ? <Trades items={trades} /> : <Skeleton className="h-64 w-full rounded-xl" />}
        </TabsContent>
        <TabsContent value="certs" className="pt-4">
          {types ? <CertTypes items={types} /> : <Skeleton className="h-64 w-full rounded-xl" />}
        </TabsContent>
      </Tabs>
    </div>
  )
}

function Trades({ items }: { items: TradeView[] }) {
  const { t } = useT()
  const [editing, setEditing] = useState<TradeView | "new" | null>(null)
  const [deleting, setDeleting] = useState<TradeView | null>(null)
  const del = useMutation(api.staffing.deleteTrade)
  const { run, busy } = useAction()
  return (
    <div className="grid gap-3">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setEditing("new")}>
          <Plus />
          {t("staffing.catalog.newTrade")}
        </Button>
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("staffing.catalog.emptyTrades")}</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="px-4">{t("staffing.common.code")}</TableHead>
                <TableHead>{t("staffing.catalog.nameLt")}</TableHead>
                <TableHead>{t("staffing.catalog.nameEn")}</TableHead>
                <TableHead className="w-20" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((x) => (
                <TableRow key={x.id}>
                  <TableCell className="px-4 font-mono text-xs">{x.code}</TableCell>
                  <TableCell className="font-medium">{x.nameLt}</TableCell>
                  <TableCell className="text-muted-foreground">{x.nameEn}</TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1 pr-2">
                      <Button variant="ghost" size="icon-sm" aria-label={`${t("staffing.common.edit")}: ${x.code}`} onClick={() => setEditing(x)}>
                        <Pencil />
                      </Button>
                      <Button variant="ghost" size="icon-sm" aria-label={`${t("staffing.common.delete")}: ${x.code}`} onClick={() => setDeleting(x)}>
                        <Trash2 />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {editing && <TradeDialog trade={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
      <ConfirmDelete
        open={!!deleting}
        title={`${t("staffing.common.confirmDelete")} ${deleting?.nameLt ?? ""}`}
        body={deleting?.code ?? ""}
        busy={busy}
        onCancel={() => setDeleting(null)}
        onConfirm={() => void run(() => del({ tradeId: deleting!.id }), { success: t("staffing.common.deleted") }).then(() => setDeleting(null))}
      />
    </div>
  )
}

function TradeDialog({ trade, onClose }: { trade: TradeView | null; onClose: () => void }) {
  const { t } = useT()
  const create = useMutation(api.staffing.createTrade)
  const update = useMutation(api.staffing.updateTrade)
  const { run, busy } = useAction()
  const [code, setCode] = useState(trade?.code ?? "")
  const [nameLt, setNameLt] = useState(trade?.nameLt ?? "")
  const [nameEn, setNameEn] = useState(trade?.nameEn ?? "")
  async function submit(e: FormEvent) {
    e.preventDefault()
    const args = { code, nameLt, nameEn }
    const res = trade ? await run(() => update({ tradeId: trade.id, ...args }), { success: t("staffing.common.saved") }) : await run(() => create(args), { success: t("staffing.common.created") })
    if (res) onClose()
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={(e) => void submit(e)} className="grid gap-5">
          <DialogHeader>
            <DialogTitle>{trade ? trade.nameLt : t("staffing.catalog.newTrade")}</DialogTitle>
          </DialogHeader>
          <FieldGroup className="gap-4">
            <Field>
              <FieldLabel htmlFor="t-code">{t("staffing.common.code")}</FieldLabel>
              <Input id="t-code" required value={code} onChange={(e) => setCode(e.target.value)} placeholder="WELD-MAG" />
            </Field>
            <Field>
              <FieldLabel htmlFor="t-lt">{t("staffing.catalog.nameLt")}</FieldLabel>
              <Input id="t-lt" required value={nameLt} onChange={(e) => setNameLt(e.target.value)} />
            </Field>
            <Field>
              <FieldLabel htmlFor="t-en">{t("staffing.catalog.nameEn")}</FieldLabel>
              <Input id="t-en" required value={nameEn} onChange={(e) => setNameEn(e.target.value)} />
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

function CertTypes({ items }: { items: CertificateTypeView[] }) {
  const { t } = useT()
  const [editing, setEditing] = useState<CertificateTypeView | "new" | null>(null)
  const [deleting, setDeleting] = useState<CertificateTypeView | null>(null)
  const del = useMutation(api.staffing.deleteCertificateType)
  const { run, busy } = useAction()
  return (
    <div className="grid gap-3">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setEditing("new")}>
          <Plus />
          {t("staffing.catalog.newCertType")}
        </Button>
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("staffing.catalog.emptyCertTypes")}</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="px-4">{t("staffing.catalog.nameLt")}</TableHead>
                <TableHead>{t("staffing.catalog.nameEn")}</TableHead>
                <TableHead className="text-right">{t("staffing.catalog.validity")}</TableHead>
                <TableHead />
                <TableHead className="w-20" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((x) => (
                <TableRow key={x.id}>
                  <TableCell className="px-4 font-medium">{x.name}</TableCell>
                  <TableCell className="text-muted-foreground">{x.nameEn}</TableCell>
                  <TableCell className="text-right tabular-nums">{x.defaultValidityMonths ?? t("staffing.common.none")}</TableCell>
                  <TableCell>{x.mandatory && <Badge variant="secondary">{t("staffing.certs.mandatory")}</Badge>}</TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1 pr-2">
                      <Button variant="ghost" size="icon-sm" aria-label={`${t("staffing.common.edit")}: ${x.name}`} onClick={() => setEditing(x)}>
                        <Pencil />
                      </Button>
                      <Button variant="ghost" size="icon-sm" aria-label={`${t("staffing.common.delete")}: ${x.name}`} onClick={() => setDeleting(x)}>
                        <Trash2 />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {editing && <CertTypeDialog type={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
      <ConfirmDelete
        open={!!deleting}
        title={`${t("staffing.common.confirmDelete")} ${deleting?.name ?? ""}`}
        body=""
        busy={busy}
        onCancel={() => setDeleting(null)}
        onConfirm={() => void run(() => del({ certificateTypeId: deleting!.id }), { success: t("staffing.common.deleted") }).then(() => setDeleting(null))}
      />
    </div>
  )
}

function CertTypeDialog({ type, onClose }: { type: CertificateTypeView | null; onClose: () => void }) {
  const { t } = useT()
  const create = useMutation(api.staffing.createCertificateType)
  const update = useMutation(api.staffing.updateCertificateType)
  const { run, busy } = useAction()
  const [name, setName] = useState(type?.name ?? "")
  const [nameEn, setNameEn] = useState(type?.nameEn ?? "")
  const [months, setMonths] = useState(type?.defaultValidityMonths ? String(type.defaultValidityMonths) : "")
  const [mandatory, setMandatory] = useState(type?.mandatory ?? false)
  async function submit(e: FormEvent) {
    e.preventDefault()
    const args = { name, nameEn: nameEn || undefined, mandatory, defaultValidityMonths: months ? Number(months) : undefined }
    const res = type ? await run(() => update({ certificateTypeId: type.id, ...args }), { success: t("staffing.common.saved") }) : await run(() => create(args), { success: t("staffing.common.created") })
    if (res) onClose()
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={(e) => void submit(e)} className="grid gap-5">
          <DialogHeader>
            <DialogTitle>{type ? type.name : t("staffing.catalog.newCertType")}</DialogTitle>
          </DialogHeader>
          <FieldGroup className="gap-4">
            <Field>
              <FieldLabel htmlFor="ct-name">{t("staffing.catalog.nameLt")}</FieldLabel>
              <Input id="ct-name" required value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field>
              <FieldLabel htmlFor="ct-en">{t("staffing.catalog.nameEn")}</FieldLabel>
              <Input id="ct-en" value={nameEn} onChange={(e) => setNameEn(e.target.value)} />
            </Field>
            <Field>
              <FieldLabel htmlFor="ct-months">{t("staffing.catalog.validity")}</FieldLabel>
              <Input id="ct-months" type="number" min={1} max={240} value={months} onChange={(e) => setMonths(e.target.value)} />
            </Field>
            <Field>
              <Label className="flex items-center gap-2 font-normal">
                <Checkbox checked={mandatory} onCheckedChange={(v) => setMandatory(v === true)} />
                {t("staffing.catalog.mandatory")}
              </Label>
              <FieldDescription>{t("staffing.catalog.mandatoryHint")}</FieldDescription>
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
