"use client"
import type { TradeLevel, WorkerCard, WorkerSource, WorkerStatus } from "@digimuza/staffing"
import { TRADE_LEVELS } from "@digimuza/staffing/pure"
import { useMutation, useQuery } from "convex/react"
import { Plus, X } from "lucide-react"
import { useRouter } from "next/navigation"
import { useState, type FormEvent } from "react"
import { useAction } from "@/components/app/use-action"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { useT } from "@/lib/i18n/client"
import type { MessageKey } from "@/lib/i18n/messages"
import { NativeSelect, useTradeName, useTrades, workerHref } from "./staffing-ui"

/** Create (no `worker`) or edit a worker. */
export function WorkerFormDialog({ worker, onClose }: { worker?: WorkerCard["worker"]; onClose: () => void }) {
  const { t } = useT()
  const router = useRouter()
  const trades = useTrades() ?? []
  const tradeName = useTradeName()
  const subs = useQuery(api.staffing.listClients, { kind: "subcontractor" }) ?? []
  const create = useMutation(api.staffing.createWorker)
  const update = useMutation(api.staffing.updateWorker)
  const { run, busy } = useAction()
  const [f, setF] = useState({
    firstName: worker?.firstName ?? "",
    lastName: worker?.lastName ?? "",
    phone: worker?.phone ?? "",
    email: worker?.email ?? "",
    nationality: worker?.nationality ?? "LT",
    languages: worker?.languages.join(", ") ?? "lt",
    source: (worker?.source ?? "own") as WorkerSource,
    subcontractorClientId: (worker?.subcontractorClientId ?? "") as string,
    status: (worker?.status ?? "active") as WorkerStatus,
    license: worker?.driverLicenseCategories.join(", ") ?? "",
    licenseExpires: worker?.driverLicenseExpiresAt ?? "",
    jacket: worker?.clothingSizes.jacket ?? "",
    trousers: worker?.clothingSizes.trousers ?? "",
    shoes: worker?.clothingSizes.shoes ?? "",
    homeCountry: worker?.homeCountry ?? "LT",
    homeCity: worker?.homeCity ?? "",
    notes: worker?.notes ?? "",
  })
  const [wTrades, setWTrades] = useState<{ tradeId: string; level: TradeLevel }[]>(worker?.trades.map((x) => ({ tradeId: x.id, level: x.level })) ?? [])
  const set = (k: keyof typeof f) => (v: string) => setF((s) => ({ ...s, [k]: v }))
  const list = (s: string) => s.split(/[\s,;]+/).filter(Boolean)

  async function submit(e: FormEvent) {
    e.preventDefault()
    const args = {
      firstName: f.firstName,
      lastName: f.lastName,
      phone: f.phone,
      email: f.email || undefined,
      nationality: f.nationality,
      languages: list(f.languages),
      source: f.source,
      subcontractorClientId: f.source === "subcontractor" && f.subcontractorClientId ? (f.subcontractorClientId as Id<"staffing_clients">) : undefined,
      trades: wTrades.filter((x) => x.tradeId).map((x) => ({ tradeId: x.tradeId as Id<"staffing_trades">, level: x.level })),
      driverLicenseCategories: list(f.license),
      driverLicenseExpiresAt: f.licenseExpires || undefined,
      clothingSizes: { jacket: f.jacket || undefined, trousers: f.trousers || undefined, shoes: f.shoes || undefined },
      status: f.status,
      notes: f.notes,
      homeCountry: f.homeCountry,
      homeCity: f.homeCity,
    }
    if (worker) {
      if (await run(() => update({ workerId: worker.id, ...args }), { success: t("staffing.common.saved") })) onClose()
    } else {
      const res = await run(() => create(args), { success: t("staffing.common.created") })
      if (res) {
        onClose()
        router.push(workerHref(res.id))
      }
    }
  }

  const text = (k: keyof typeof f, label: MessageKey, props: { type?: string; required?: boolean; maxLength?: number } = {}) => (
    <Field>
      <FieldLabel htmlFor={`w-${k}`}>{t(label)}</FieldLabel>
      <Input id={`w-${k}`} value={f[k]} onChange={(e) => set(k)(e.target.value)} {...props} />
    </Field>
  )

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <form onSubmit={(e) => void submit(e)} className="grid gap-5">
          <DialogHeader>
            <DialogTitle>{worker ? t("staffing.worker.edit") : t("staffing.workers.new")}</DialogTitle>
          </DialogHeader>
          <FieldGroup className="grid gap-4 sm:grid-cols-2">
            {text("firstName", "staffing.worker.firstName", { required: true, maxLength: 120 })}
            {text("lastName", "staffing.worker.lastName", { required: true, maxLength: 120 })}
            {text("phone", "staffing.worker.phone", { required: true, maxLength: 40 })}
            {text("email", "staffing.worker.email", { type: "email" })}
            {text("nationality", "staffing.worker.nationality", { required: true, maxLength: 2 })}
            {text("languages", "staffing.worker.languages")}
            <Field>
              <FieldLabel htmlFor="w-source">{t("staffing.worker.source")}</FieldLabel>
              <NativeSelect id="w-source" value={f.source} onChange={set("source")}>
                <option value="own">{t("staffing.source.own")}</option>
                <option value="subcontractor">{t("staffing.source.subcontractor")}</option>
              </NativeSelect>
            </Field>
            {f.source === "subcontractor" ? (
              <Field>
                <FieldLabel htmlFor="w-sub">{t("staffing.worker.subcontractor")}</FieldLabel>
                <NativeSelect id="w-sub" required value={f.subcontractorClientId} onChange={set("subcontractorClientId")}>
                  <option value="" />
                  {subs.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            ) : (
              <div />
            )}
            {text("homeCountry", "staffing.worker.homeCountry", { required: true, maxLength: 2 })}
            {text("homeCity", "staffing.worker.homeCity")}
            {text("license", "staffing.worker.license")}
            {text("licenseExpires", "staffing.worker.licenseExpires", { type: "date" })}
            <Field>
              <FieldLabel htmlFor="w-status">{t("staffing.common.status")}</FieldLabel>
              <NativeSelect id="w-status" value={f.status} onChange={set("status")}>
                <option value="active">{t("staffing.workerStatus.active")}</option>
                <option value="inactive">{t("staffing.workerStatus.inactive")}</option>
              </NativeSelect>
            </Field>
            <Field>
              <FieldLabel>{t("staffing.worker.clothing")}</FieldLabel>
              <div className="grid grid-cols-3 gap-2">
                <Input aria-label={t("staffing.worker.jacket")} placeholder={t("staffing.worker.jacket")} value={f.jacket} onChange={(e) => set("jacket")(e.target.value)} />
                <Input aria-label={t("staffing.worker.trousers")} placeholder={t("staffing.worker.trousers")} value={f.trousers} onChange={(e) => set("trousers")(e.target.value)} />
                <Input aria-label={t("staffing.worker.shoes")} placeholder={t("staffing.worker.shoes")} value={f.shoes} onChange={(e) => set("shoes")(e.target.value)} />
              </div>
            </Field>
          </FieldGroup>
          <Field>
            <FieldLabel>{t("staffing.worker.trades")}</FieldLabel>
            <div className="grid gap-2">
              {wTrades.map((wt, i) => (
                <div key={i} className="flex gap-2">
                  <NativeSelect className="flex-1" aria-label={t("staffing.team.trade")} value={wt.tradeId} onChange={(v) => setWTrades((s) => s.map((x, j) => (j === i ? { ...x, tradeId: v } : x)))}>
                    <option value="" />
                    {trades.map((tr) => (
                      <option key={tr.id} value={tr.id}>
                        {tr.code} · {tradeName(tr)}
                      </option>
                    ))}
                  </NativeSelect>
                  <NativeSelect aria-label="level" value={wt.level} onChange={(v) => setWTrades((s) => s.map((x, j) => (j === i ? { ...x, level: v as TradeLevel } : x)))}>
                    {TRADE_LEVELS.map((l) => (
                      <option key={l} value={l}>
                        {t(`staffing.level.${l}` as MessageKey)}
                      </option>
                    ))}
                  </NativeSelect>
                  <Button type="button" variant="ghost" size="icon" aria-label={t("staffing.common.delete")} onClick={() => setWTrades((s) => s.filter((_, j) => j !== i))}>
                    <X />
                  </Button>
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" className="w-fit" onClick={() => setWTrades((s) => [...s, { tradeId: "", level: "skilled" }])}>
                <Plus />
                {t("staffing.worker.addTrade")}
              </Button>
            </div>
          </Field>
          <Field>
            <FieldLabel htmlFor="w-notes">{t("staffing.common.notes")}</FieldLabel>
            <Textarea id="w-notes" value={f.notes} onChange={(e) => set("notes")(e.target.value)} rows={3} />
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
