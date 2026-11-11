"use client"
// Planning settings: subcontractor capacity per trade and team composition rules per client.
import type { SettingsView } from "@digimuza/staffing"
import { StaffingPlanningPermissions } from "@digimuza/staffing/planning/manifest"
import type { EnglishScope } from "@digimuza/staffing/planning/rules"
import { Can, useCan } from "@digimuza/system-core/react"
import { useMutation, useQuery } from "convex/react"
import { ArrowLeft, Plus, Trash2 } from "lucide-react"
import Link from "next/link"
import { useState, type FormEvent } from "react"
import { PageHeader } from "@/components/app/page-header"
import { useAction } from "@/components/app/use-action"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { useT } from "@/lib/i18n/client"
import type { MessageKey } from "@/lib/i18n/messages"
import { NativeSelect, Period, useTradeName, useTrades } from "../../staffing/_components/staffing-ui"
import { usePlanningEnabled } from "./planning-ui"

export function PlanningSettings() {
  const { t } = useT()
  const enabled = usePlanningEnabled()
  const data = useQuery(api.planning.getSettings, enabled ? {} : "skip")
  if (!enabled) return <p className="text-sm text-muted-foreground">{t("planning.disabled")}</p>
  return (
    <div className="grid gap-6">
      <div>
        <Button variant="ghost" size="sm" asChild className="-ml-2 mb-2">
          <Link href="/app/planning">
            <ArrowLeft />
            {t("planning.title")}
          </Link>
        </Button>
        <PageHeader title={t("planning.settings.title")} lead={t("planning.settings.lead")} />
      </div>
      {data === undefined ? (
        <Skeleton className="h-96 w-full" />
      ) : (
        <>
          <Capacities data={data} />
          <Rules data={data} />
        </>
      )}
    </div>
  )
}

function Capacities({ data }: { data: SettingsView }) {
  const { t } = useT()
  const trades = useTrades()
  const tradeName = useTradeName()
  const canWrite = useCan(StaffingPlanningPermissions.settingsWrite)
  const save = useMutation(api.planning.saveCapacity)
  const del = useMutation(api.planning.deleteCapacity)
  const { run, busy } = useAction()
  const today = new Date().toISOString().slice(0, 10)
  const [form, setForm] = useState({ clientId: "", tradeId: "", count: "2", validFrom: today, validTo: "", note: "" })
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }))

  async function submit(e: FormEvent) {
    e.preventDefault()
    const ok = await run(
      () =>
        save({
          clientId: form.clientId as Id<"staffing_clients">,
          tradeId: form.tradeId as Id<"staffing_trades">,
          count: Number(form.count),
          validFrom: form.validFrom,
          ...(form.validTo ? { validTo: form.validTo } : {}),
          note: form.note,
        }),
      { success: t("planning.settings.saved") },
    )
    if (ok) setForm((f) => ({ ...f, count: "2", note: "" }))
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("planning.cap.title")}</CardTitle>
        <CardDescription>{t("planning.cap.lead")}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 px-0">
        {data.capacities.length === 0 ? (
          <p className="px-4 text-sm text-muted-foreground">{t("planning.cap.empty")}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="px-4">{t("planning.cap.subcontractor")}</TableHead>
                <TableHead>{t("planning.cap.trade")}</TableHead>
                <TableHead className="text-right">{t("planning.cap.count")}</TableHead>
                <TableHead>{t("planning.cap.valid")}</TableHead>
                <TableHead>{t("staffing.common.notes")}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.capacities.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="px-4 font-medium">{c.clientName}</TableCell>
                  <TableCell>{tradeName({ nameLt: c.tradeName, nameEn: c.tradeNameEn })}</TableCell>
                  <TableCell className="text-right tabular-nums">{c.count}</TableCell>
                  <TableCell>
                    <Period from={c.validFrom} to={c.validTo} />
                  </TableCell>
                  <TableCell className="max-w-72 truncate text-muted-foreground">{c.note}</TableCell>
                  <TableCell className="w-10 pr-4">
                    {canWrite && (
                      <Button variant="ghost" size="icon" aria-label={t("staffing.common.delete")} disabled={busy} onClick={() => void run(() => del({ capacityId: c.id as Id<"staffing_planning_capacities"> }), { success: t("staffing.common.deleted") })}>
                        <Trash2 />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <Can permission={StaffingPlanningPermissions.settingsWrite}>
          <form onSubmit={(e) => void submit(e)} className="flex flex-wrap items-end gap-2 border-t px-4 pt-4">
            <NativeSelect aria-label={t("planning.cap.subcontractor")} required value={form.clientId} onChange={set("clientId")} className="min-w-52">
              <option value="">{t("planning.cap.subcontractor")}…</option>
              {data.subcontractors.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </NativeSelect>
            <NativeSelect aria-label={t("planning.cap.trade")} required value={form.tradeId} onChange={set("tradeId")} className="min-w-52">
              <option value="">{t("planning.cap.trade")}…</option>
              {trades?.map((x) => (
                <option key={x.id} value={x.id}>
                  {tradeName(x)}
                </option>
              ))}
            </NativeSelect>
            <Input aria-label={t("planning.cap.count")} inputMode="numeric" value={form.count} onChange={(e) => set("count")(e.target.value.replace(/\D/g, ""))} className="w-20 tabular-nums" />
            <Input aria-label={t("planning.cap.from")} type="date" required value={form.validFrom} onChange={(e) => set("validFrom")(e.target.value)} className="w-40" />
            <Input aria-label={t("planning.cap.to")} type="date" value={form.validTo} onChange={(e) => set("validTo")(e.target.value)} className="w-40" />
            <Input placeholder={t("staffing.common.notes")} value={form.note} onChange={(e) => set("note")(e.target.value)} className="w-56" />
            <Button type="submit" disabled={busy || !form.clientId || !form.tradeId}>
              <Plus />
              {t("planning.cap.add")}
            </Button>
          </form>
        </Can>
      </CardContent>
    </Card>
  )
}

const SCOPES: EnglishScope[] = ["team", "housing", "off"]

function Rules({ data }: { data: SettingsView }) {
  const { t } = useT()
  const canWrite = useCan(StaffingPlanningPermissions.settingsWrite)
  const save = useMutation(api.planning.saveClientRules)
  const del = useMutation(api.planning.deleteClientRules)
  const { run, busy } = useAction()
  const blank = { clientId: "", driversPerPeople: String(data.defaults.driversPerPeople), english: data.defaults.english as EnglishScope, languageCompatibility: data.defaults.languageCompatibility, housingGroupSize: String(data.defaults.housingGroupSize), note: "" }
  const [form, setForm] = useState(blank)

  async function submit(e: FormEvent) {
    e.preventDefault()
    const ok = await run(
      () =>
        save({
          clientId: form.clientId as Id<"staffing_clients">,
          driversPerPeople: Number(form.driversPerPeople),
          english: form.english,
          languageCompatibility: form.languageCompatibility,
          housingGroupSize: Number(form.housingGroupSize),
          note: form.note,
        }),
      { success: t("planning.settings.saved") },
    )
    if (ok) setForm(blank)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("planning.rules.title")}</CardTitle>
        <CardDescription>
          {t("planning.rules.lead")} {t("planning.rules.defaults")}: {t("planning.rules.driverEvery")} {data.defaults.driversPerPeople} {t("planning.rules.people")}, {t(`planning.rules.english.${data.defaults.english}` as MessageKey)}, {t("planning.rules.housing")} {data.defaults.housingGroupSize}.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 px-0">
        {data.rules.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="px-4">{t("planning.rules.client")}</TableHead>
                <TableHead>{t("planning.rules.drivers")}</TableHead>
                <TableHead>{t("planning.rules.englishCol")}</TableHead>
                <TableHead>{t("planning.rules.language")}</TableHead>
                <TableHead>{t("planning.rules.housingCol")}</TableHead>
                <TableHead>{t("staffing.common.notes")}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.rules.map((r) => (
                <TableRow key={r.clientId}>
                  <TableCell className="px-4 font-medium">{r.clientName}</TableCell>
                  <TableCell className="tabular-nums">{r.driversPerPeople ? `1 / ${r.driversPerPeople}` : t("planning.rules.off")}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{t(`planning.rules.english.${r.english}` as MessageKey)}</Badge>
                  </TableCell>
                  <TableCell>{r.languageCompatibility ? t("planning.rules.on") : t("planning.rules.off")}</TableCell>
                  <TableCell className="tabular-nums">{r.housingGroupSize}</TableCell>
                  <TableCell className="max-w-72 truncate text-muted-foreground" title={r.note}>
                    {r.note}
                  </TableCell>
                  <TableCell className="w-24 pr-4 text-right">
                    {canWrite && (
                      <>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            setForm({ clientId: r.clientId, driversPerPeople: String(r.driversPerPeople), english: r.english, languageCompatibility: r.languageCompatibility, housingGroupSize: String(r.housingGroupSize), note: r.note })
                          }
                        >
                          {t("staffing.common.edit")}
                        </Button>
                        <Button variant="ghost" size="icon" aria-label={t("staffing.common.delete")} disabled={busy} onClick={() => void run(() => del({ clientId: r.clientId as Id<"staffing_clients"> }), { success: t("staffing.common.deleted") })}>
                          <Trash2 />
                        </Button>
                      </>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <Can permission={StaffingPlanningPermissions.settingsWrite}>
          <form onSubmit={(e) => void submit(e)} className="flex flex-wrap items-end gap-3 border-t px-4 pt-4 text-sm">
            <NativeSelect aria-label={t("planning.rules.client")} required value={form.clientId} onChange={(v) => setForm((f) => ({ ...f, clientId: v }))} className="min-w-56">
              <option value="">{t("planning.rules.client")}…</option>
              {data.clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </NativeSelect>
            <label className="grid gap-1">
              <span className="text-xs text-muted-foreground">{t("planning.rules.drivers")}</span>
              <Input inputMode="numeric" value={form.driversPerPeople} onChange={(e) => setForm((f) => ({ ...f, driversPerPeople: e.target.value.replace(/\D/g, "") }))} className="w-20 tabular-nums" />
            </label>
            <label className="grid gap-1">
              <span className="text-xs text-muted-foreground">{t("planning.rules.englishCol")}</span>
              <NativeSelect value={form.english} onChange={(v) => setForm((f) => ({ ...f, english: v as EnglishScope }))}>
                {SCOPES.map((s) => (
                  <option key={s} value={s}>
                    {t(`planning.rules.english.${s}` as MessageKey)}
                  </option>
                ))}
              </NativeSelect>
            </label>
            <label className="grid gap-1">
              <span className="text-xs text-muted-foreground">{t("planning.rules.housingCol")}</span>
              <Input inputMode="numeric" value={form.housingGroupSize} onChange={(e) => setForm((f) => ({ ...f, housingGroupSize: e.target.value.replace(/\D/g, "") }))} className="w-20 tabular-nums" />
            </label>
            <label className="inline-flex h-9 items-center gap-2">
              <Checkbox checked={form.languageCompatibility} onCheckedChange={(v) => setForm((f) => ({ ...f, languageCompatibility: v === true }))} />
              {t("planning.rules.language")}
            </label>
            <Input placeholder={t("staffing.common.notes")} value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} className="w-64" />
            <Button type="submit" disabled={busy || !form.clientId}>
              {t("planning.rules.save")}
            </Button>
          </form>
        </Can>
      </CardContent>
    </Card>
  )
}
