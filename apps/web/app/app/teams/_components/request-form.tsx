"use client"
import { addDays, TRADE_LEVELS, type TradeLevel } from "@digimuza/staffing/pure"
import { useMutation, useQuery } from "convex/react"
import { ArrowLeft, Plus, Trash2 } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState, type FormEvent } from "react"
import { PageHeader } from "@/components/app/page-header"
import { useAction } from "@/components/app/use-action"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { useT } from "@/lib/i18n/client"
import type { MessageKey } from "@/lib/i18n/messages"
import { NativeSelect, useCertificateTypes, useTradeName, useTrades } from "../../staffing/_components/staffing-ui"
import { useTeamsEnabled } from "./teams-nav"

interface LineDraft {
  tradeId: string
  count: string
  drivers: string
  minLevel: "" | TradeLevel
  certificateTypeIds: string[]
}
const emptyLine = (): LineDraft => ({ tradeId: "", count: "1", drivers: "0", minLevel: "", certificateTypeIds: [] })

export function RequestForm() {
  const { t, locale } = useT()
  const router = useRouter()
  const enabled = useTeamsEnabled()
  const clients = useQuery(api.staffing.listClients, enabled ? { kind: "client" } : "skip") ?? []
  const trades = useTrades() ?? []
  const certTypes = (useCertificateTypes() ?? []).filter((c) => !c.mandatory)
  const tradeName = useTradeName()
  const create = useMutation(api.teams.createRequest)
  const { run, busy } = useAction()

  const [f, setF] = useState({ clientId: "", projectId: "", projectName: "", country: "", site: "", startDate: addDays(new Date().toISOString().slice(0, 10), 21), weeks: "8", languages: "en", notes: "", crmRecordId: "" })
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()])
  const projects = useQuery(api.staffing.listProjects, enabled && f.clientId ? { clientId: f.clientId as Id<"staffing_clients"> } : "skip") ?? []
  const openProjects = projects.filter((p) => p.status === "draft" || p.status === "active")
  const set = (k: keyof typeof f) => (v: string) => setF((s) => ({ ...s, [k]: v }))
  const weeks = Math.max(1, Math.round(Number(f.weeks) || 0))
  const endDate = f.startDate ? addDays(f.startDate, weeks * 7 - 1) : ""
  const setLine = (i: number, patch: Partial<LineDraft>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)))

  function pickClient(id: string) {
    const c = clients.find((x) => x.id === id)
    setF((s) => ({ ...s, clientId: id, projectId: "", country: c?.country ?? s.country }))
  }
  function pickProject(id: string) {
    const p = openProjects.find((x) => x.id === id)
    setF((s) => ({ ...s, projectId: id, ...(p ? { site: p.city, country: p.country, startDate: p.startDate > s.startDate ? p.startDate : s.startDate } : {}) }))
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    const res = await run(
      () =>
        create({
          clientId: f.clientId as Id<"staffing_clients">,
          ...(f.projectId ? { projectId: f.projectId as Id<"staffing_projects"> } : { projectName: f.projectName || undefined }),
          country: f.country,
          site: f.site,
          startDate: f.startDate,
          endDate,
          languages: f.languages
            .split(/[,\s]+/)
            .map((x) => x.trim())
            .filter(Boolean),
          lines: lines
            .filter((l) => l.tradeId)
            .map((l) => ({
              tradeId: l.tradeId as Id<"staffing_trades">,
              count: Number(l.count),
              drivers: Number(l.drivers) || 0,
              ...(l.minLevel ? { minLevel: l.minLevel } : {}),
              certificateTypeIds: l.certificateTypeIds as Id<"staffing_certificateTypes">[],
            })),
          notes: f.notes,
          crmRecordId: f.crmRecordId || undefined,
        }),
      { success: t("teams.form.created") },
    )
    if (res) router.push(`/app/teams/${res.id}`)
  }

  if (!enabled) return <p className="text-sm text-muted-foreground">{t("teams.disabled")}</p>
  const text = (k: keyof typeof f, label: MessageKey, props: { required?: boolean; type?: string; min?: number } = {}) => (
    <Field>
      <FieldLabel htmlFor={`r-${k}`}>{t(label)}</FieldLabel>
      <Input id={`r-${k}`} value={f[k]} onChange={(e) => set(k)(e.target.value)} {...props} />
    </Field>
  )

  return (
    <form onSubmit={(e) => void submit(e)} className="grid max-w-4xl gap-6">
      <div>
        <Button variant="ghost" size="sm" asChild className="-ml-2 mb-2">
          <Link href="/app/teams">
            <ArrowLeft />
            {t("teams.detail.back")}
          </Link>
        </Button>
        <PageHeader title={t("teams.form.title")} lead={t("teams.form.lead")} />
      </div>

      <Card>
        <CardContent>
          <FieldGroup className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="r-client">{t("teams.form.client")}</FieldLabel>
              <NativeSelect id="r-client" required value={f.clientId} onChange={pickClient}>
                <option value="" />
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field>
              <FieldLabel htmlFor="r-project">{t("teams.form.project")}</FieldLabel>
              <NativeSelect id="r-project" value={f.projectId} onChange={pickProject}>
                <option value="">{t("teams.form.newProject")}</option>
                {openProjects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.code} {p.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            {!f.projectId && <div className="sm:col-span-2">{text("projectName", "teams.form.projectName")}</div>}
            {text("country", "teams.form.country", { required: true })}
            {text("site", "teams.form.site", { required: true })}
            {text("startDate", "teams.form.start", { required: true, type: "date" })}
            <div className="grid grid-cols-2 gap-3">
              {text("weeks", "teams.form.weeks", { required: true, type: "number", min: 1 })}
              <Field>
                <FieldLabel>{t("teams.form.end")}</FieldLabel>
                <p className="flex h-9 items-center text-sm tabular-nums text-muted-foreground">{endDate}</p>
              </Field>
            </div>
            {text("languages", "teams.form.languages")}
            {text("crmRecordId", "teams.form.crm")}
          </FieldGroup>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("teams.form.lines")}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          {lines.map((l, i) => (
            <div key={i} className="grid gap-3 rounded-lg border p-3">
              <div className="grid items-end gap-3 sm:grid-cols-[1fr_6rem_8rem_9rem_auto]">
                <Field>
                  <FieldLabel htmlFor={`l-trade-${i}`}>{t("teams.form.trade")}</FieldLabel>
                  <NativeSelect id={`l-trade-${i}`} required={i === 0} value={l.tradeId} onChange={(v) => setLine(i, { tradeId: v })}>
                    <option value="" />
                    {trades.map((tr) => (
                      <option key={tr.id} value={tr.id}>
                        {tradeName(tr)}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
                <Field>
                  <FieldLabel htmlFor={`l-count-${i}`}>{t("teams.form.count")}</FieldLabel>
                  <Input id={`l-count-${i}`} type="number" min={1} max={60} value={l.count} onChange={(e) => setLine(i, { count: e.target.value })} />
                </Field>
                <Field>
                  <FieldLabel htmlFor={`l-drivers-${i}`}>{t("teams.form.drivers")}</FieldLabel>
                  <Input id={`l-drivers-${i}`} type="number" min={0} max={Number(l.count) || 0} value={l.drivers} onChange={(e) => setLine(i, { drivers: e.target.value })} />
                </Field>
                <Field>
                  <FieldLabel htmlFor={`l-level-${i}`}>{t("teams.form.minLevel")}</FieldLabel>
                  <NativeSelect id={`l-level-${i}`} value={l.minLevel} onChange={(v) => setLine(i, { minLevel: v as TradeLevel | "" })}>
                    <option value="">{t("teams.form.anyLevel")}</option>
                    {TRADE_LEVELS.map((lv) => (
                      <option key={lv} value={lv}>
                        {t(`staffing.level.${lv}` as MessageKey)}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
                <Button type="button" variant="ghost" size="icon" aria-label={t("teams.form.removeLine")} disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>
                  <Trash2 />
                </Button>
              </div>
              <div>
                <p className="mb-1.5 text-xs text-muted-foreground">{t("teams.form.certs")}</p>
                <div className="flex flex-wrap gap-1.5">
                  {certTypes.map((c) => {
                    const on = l.certificateTypeIds.includes(c.id)
                    return (
                      <button
                        key={c.id}
                        type="button"
                        aria-pressed={on}
                        onClick={() => setLine(i, { certificateTypeIds: on ? l.certificateTypeIds.filter((x) => x !== c.id) : [...l.certificateTypeIds, c.id] })}
                        className={`rounded-full border px-2.5 py-0.5 text-xs transition-colors ${on ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted"}`}
                      >
                        {locale === "en" ? (c.nameEn ?? c.name) : c.name}
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>
          ))}
          <div>
            <Button type="button" variant="outline" size="sm" onClick={() => setLines((ls) => [...ls, emptyLine()])}>
              <Plus />
              {t("teams.form.addLine")}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Field>
        <FieldLabel htmlFor="r-notes">{t("teams.form.notes")}</FieldLabel>
        <Textarea id="r-notes" rows={3} value={f.notes} onChange={(e) => set("notes")(e.target.value)} />
      </Field>
      <div>
        <Button type="submit" disabled={busy}>
          {t("teams.form.submit")}
        </Button>
      </div>
    </form>
  )
}
