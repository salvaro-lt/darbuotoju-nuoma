"use client"
import { StaffingInvoicingPermissions as P } from "@digimuza/staffing/invoicing/manifest"
import { COST_CATEGORIES, type CostCategory } from "@digimuza/staffing/invoicing/pure"
import { Can } from "@digimuza/system-core/react"
import { useMutation, useQuery } from "convex/react"
import { ArrowLeft, Plus, Trash2, TrendingUp } from "lucide-react"
import Link from "next/link"
import { useState, type FormEvent } from "react"
import { EmptyState } from "@/components/app/empty-state"
import { PageHeader } from "@/components/app/page-header"
import { useAction } from "@/components/app/use-action"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { useT } from "@/lib/i18n/client"
import type { MessageKey } from "@/lib/i18n/messages"
import { NativeSelect, ProjectStatusBadge } from "../../staffing/_components/staffing-ui"
import { InvoicingDisabled, InvoicingTabs, marginTone, profitHref, Stat, useInvoicingEnabled, useMoney } from "./invoicing-ui"

const pct = (p: number | null) => (p === null ? "—" : `${p.toLocaleString("lt-LT")} %`)

function MarginBadge({ value }: { value: number | null }) {
  const tone = marginTone(value)
  const cls = tone === "bad" ? "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200" : tone === "warn" ? "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200" : tone === "good" ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200" : ""
  return (
    <Badge variant="outline" className={`border-transparent tabular-nums ${cls}`}>
      {pct(value)}
    </Badge>
  )
}

// ---------------------------------------------------------------- portfolio

export function PortfolioView() {
  const { t } = useT()
  const money = useMoney()
  const enabled = useInvoicingEnabled()
  const rows = useQuery(api.invoicing.portfolio, enabled ? {} : "skip")
  if (!enabled) return <InvoicingDisabled />
  const withData = rows?.filter((r) => r.invoicedCents || r.costCents || r.earnedCents) ?? []
  const tot = withData.reduce((s, r) => ({ inv: s.inv + r.invoicedCents, earned: s.earned + r.earnedCents, cost: s.cost + r.costCents, margin: s.margin + r.marginCents, un: s.un + r.uninvoicedCents }), { inv: 0, earned: 0, cost: 0, margin: 0, un: 0 })
  const totalPct = tot.earned ? Math.round((tot.margin / tot.earned) * 1000) / 10 : null
  return (
    <div>
      <PageHeader title={t("invoicing.profit.title")} lead={t("invoicing.profit.lead")} />
      <InvoicingTabs />
      {!rows ? (
        <Skeleton className="h-64 w-full rounded-xl" />
      ) : withData.length === 0 ? (
        <EmptyState icon={<TrendingUp />} title={t("invoicing.profit.empty")} />
      ) : (
        <div className="grid gap-5">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label={t("invoicing.profit.earned")} value={money(tot.earned)} hint={`${t("invoicing.profit.invoiced")}: ${money(tot.inv)}`} />
            <Stat label={t("invoicing.profit.costs")} value={money(tot.cost)} />
            <Stat label={t("invoicing.profit.margin")} value={money(tot.margin)} hint={pct(totalPct)} tone={marginTone(totalPct)} />
            <Stat label={t("invoicing.profit.uninvoiced")} value={money(tot.un)} hint={t("invoicing.profit.uninvoicedHint")} />
          </div>
          <div className="overflow-x-auto rounded-xl border bg-card">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="px-4">{t("invoicing.col.project")}</TableHead>
                  <TableHead>{t("invoicing.col.client")}</TableHead>
                  <TableHead>{t("invoicing.col.status")}</TableHead>
                  <TableHead className="text-right">{t("invoicing.profit.earned")}</TableHead>
                  <TableHead className="text-right">{t("invoicing.profit.invoiced")}</TableHead>
                  <TableHead className="text-right">{t("invoicing.profit.paid")}</TableHead>
                  <TableHead className="text-right">{t("invoicing.profit.costs")}</TableHead>
                  <TableHead className="text-right">{t("invoicing.profit.margin")}</TableHead>
                  <TableHead className="text-right">{t("invoicing.profit.marginPct")}</TableHead>
                  <TableHead className="pr-4 text-right">{t("invoicing.profit.uninvoiced")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {withData.map((r) => (
                  <TableRow key={r.projectId}>
                    <TableCell className="px-4">
                      <Link href={profitHref(r.projectId)} className="font-medium hover:underline">
                        <span className="font-mono text-xs">{r.code}</span> · {r.name}
                      </Link>
                    </TableCell>
                    <TableCell>{r.clientName}</TableCell>
                    <TableCell>
                      <ProjectStatusBadge status={r.status as "active"} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{money(r.earnedCents)}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(r.invoicedCents)}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(r.paidCents)}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(r.costCents)}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(r.marginCents)}</TableCell>
                    <TableCell className="text-right">
                      <MarginBadge value={r.marginPct} />
                    </TableCell>
                    <TableCell className="pr-4 text-right tabular-nums text-muted-foreground">{money(r.uninvoicedCents)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <p className="text-xs text-muted-foreground">{t("invoicing.profit.note")}</p>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- one project

export function ProjectProfitView({ projectId }: { projectId: string }) {
  const { t } = useT()
  const money = useMoney()
  const enabled = useInvoicingEnabled()
  const id = projectId as Id<"staffing_projects">
  const d = useQuery(api.invoicing.projectProfitability, enabled ? { projectId: id } : "skip")
  const del = useMutation(api.invoicing.deleteCost)
  const { run, busy } = useAction()
  const [adding, setAdding] = useState(false)
  if (!enabled) return <InvoicingDisabled />
  if (d === undefined) return <Skeleton className="h-96 w-full rounded-xl" />
  if (d === null) return <p className="text-sm text-muted-foreground">{t("invoicing.notFound")}</p>
  const max = Math.max(1, ...d.weeks.map((w) => Math.max(w.revenueCents, w.costCents)))
  const costTotal = d.costCents || 1

  return (
    <div>
      <Link href="/app/invoicing/profitability" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" />
        {t("invoicing.profit.back")}
      </Link>
      <PageHeader
        title={`${d.code} · ${d.name}`}
        lead={d.clientName}
        actions={
          <Can permission={P.costManage}>
            <Button size="sm" onClick={() => setAdding(true)}>
              <Plus />
              {t("invoicing.cost.add")}
            </Button>
          </Can>
        }
      />
      <InvoicingTabs />
      <div className="grid gap-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Stat label={t("invoicing.profit.invoiced")} value={money(d.invoicedCents)} hint={`${t("invoicing.profit.paid")}: ${money(d.paidCents)}`} />
          <Stat label={t("invoicing.profit.earned")} value={money(d.earnedCents)} hint={`${t("invoicing.profit.uninvoiced")}: ${money(d.uninvoicedCents)}`} />
          <Stat label={t("invoicing.profit.costs")} value={money(d.costCents)} />
          <Stat label={t("invoicing.profit.margin")} value={money(d.marginCents)} tone={marginTone(d.marginPct)} />
          <Stat label={t("invoicing.profit.marginPct")} value={pct(d.marginPct)} tone={marginTone(d.marginPct)} />
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("invoicing.profit.weekly")}</CardTitle>
            <div className="flex gap-4 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <span className="size-2.5 rounded-sm bg-primary" aria-hidden />
                {t("invoicing.profit.earned")}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="size-2.5 rounded-sm bg-rose-400" aria-hidden />
                {t("invoicing.profit.costs")}
              </span>
            </div>
          </CardHeader>
          <CardContent>
            {d.weeks.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("invoicing.profit.noWeeks")}</p>
            ) : (
              <div className="flex h-56 items-end gap-2 overflow-x-auto pb-1" role="img" aria-label={t("invoicing.profit.weekly")}>
                {d.weeks.map((w) => {
                  const m = w.revenueCents ? Math.round(((w.revenueCents - w.costCents) / w.revenueCents) * 100) : null
                  return (
                    <div key={w.week} className="flex min-w-12 flex-1 flex-col items-center gap-1" title={`${w.week}: ${money(w.revenueCents)} / ${money(w.costCents)}`}>
                      <span className={`text-[10px] tabular-nums ${m !== null && m < 10 ? "text-red-600 dark:text-red-400" : "text-muted-foreground"}`}>{m === null ? "" : `${m}%`}</span>
                      <div className="flex h-40 w-full items-end justify-center gap-0.5">
                        <div className="w-1/2 max-w-5 rounded-t bg-primary" style={{ height: `${(w.revenueCents / max) * 100}%` }} />
                        <div className="w-1/2 max-w-5 rounded-t bg-rose-400" style={{ height: `${(w.costCents / max) * 100}%` }} />
                      </div>
                      <span className="text-[10px] whitespace-nowrap text-muted-foreground tabular-nums">{w.week.slice(5)}</span>
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="grid gap-4 lg:grid-cols-[20rem_1fr]">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("invoicing.cost.byCategory")}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2.5 text-sm">
              {COST_CATEGORIES.map((c) => (
                <div key={c}>
                  <div className="flex justify-between">
                    <span>{t(`invoicing.cost.cat.${c}` as MessageKey)}</span>
                    <span className="tabular-nums">{money(d.byCategory[c])}</span>
                  </div>
                  <div className="mt-1 h-1.5 rounded-full bg-muted">
                    <div className="h-1.5 rounded-full bg-rose-400" style={{ width: `${(d.byCategory[c] / costTotal) * 100}%` }} />
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("invoicing.cost.entries")}</CardTitle>
            </CardHeader>
            <CardContent className="max-h-[28rem] overflow-y-auto px-0">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="px-4">{t("invoicing.hours.date")}</TableHead>
                    <TableHead>{t("invoicing.cost.category")}</TableHead>
                    <TableHead>{t("staffing.common.notes")}</TableHead>
                    <TableHead className="text-right">{t("invoicing.col.amount")}</TableHead>
                    <TableHead className="pr-4" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {d.costs.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="px-4 tabular-nums">{c.date}</TableCell>
                      <TableCell>{t(`invoicing.cost.cat.${c.category}` as MessageKey)}</TableCell>
                      <TableCell className="max-w-64 truncate text-muted-foreground">{c.note}</TableCell>
                      <TableCell className="text-right tabular-nums">{money(c.amountCents)}</TableCell>
                      <TableCell className="pr-4 text-right">
                        <Can permission={P.costManage}>
                          <Button size="icon" variant="ghost" aria-label={t("staffing.common.delete")} disabled={busy} onClick={() => void run(() => del({ costId: c.id as Id<"staffing_invoicing_costs"> }), { success: t("staffing.common.deleted") })}>
                            <Trash2 />
                          </Button>
                        </Can>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter>
                  <TableRow>
                    <TableCell colSpan={3} className="px-4 font-semibold">
                      {t("invoicing.total")}
                    </TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">{money(d.costCents)}</TableCell>
                    <TableCell />
                  </TableRow>
                </TableFooter>
              </Table>
            </CardContent>
          </Card>
        </div>
      </div>
      {adding && <CostDialog projectId={id} onClose={() => setAdding(false)} />}
    </div>
  )
}

function CostDialog({ projectId, onClose }: { projectId: Id<"staffing_projects">; onClose: () => void }) {
  const { t } = useT()
  const add = useMutation(api.invoicing.addCost)
  const { run, busy } = useAction()
  const [f, setF] = useState({ category: "accommodation" as CostCategory, date: new Date().toISOString().slice(0, 10), amount: "", note: "" })

  async function submit(e: FormEvent) {
    e.preventDefault()
    const amountCents = Math.round(Number(f.amount.replace(",", ".")) * 100)
    if (await run(() => add({ projectId, category: f.category, date: f.date, amountCents, note: f.note || undefined }), { success: t("staffing.common.created") })) onClose()
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={(e) => void submit(e)} className="grid gap-5">
          <DialogHeader>
            <DialogTitle>{t("invoicing.cost.add")}</DialogTitle>
          </DialogHeader>
          <FieldGroup className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="c-cat">{t("invoicing.cost.category")}</FieldLabel>
              <NativeSelect id="c-cat" value={f.category} onChange={(v) => setF((s) => ({ ...s, category: v as CostCategory }))}>
                {COST_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {t(`invoicing.cost.cat.${c}` as MessageKey)}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field>
              <FieldLabel htmlFor="c-date">{t("invoicing.hours.date")}</FieldLabel>
              <Input id="c-date" type="date" required value={f.date} onChange={(e) => setF((s) => ({ ...s, date: e.target.value }))} />
            </Field>
            <Field>
              <FieldLabel htmlFor="c-amount">{t("invoicing.payment.amount")}</FieldLabel>
              <Input id="c-amount" inputMode="decimal" required value={f.amount} onChange={(e) => setF((s) => ({ ...s, amount: e.target.value }))} />
            </Field>
          </FieldGroup>
          <Field>
            <FieldLabel htmlFor="c-note">{t("staffing.common.notes")}</FieldLabel>
            <Input id="c-note" value={f.note} onChange={(e) => setF((s) => ({ ...s, note: e.target.value }))} />
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
