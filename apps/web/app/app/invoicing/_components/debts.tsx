"use client"
import { StaffingInvoicingPermissions as P } from "@digimuza/staffing/invoicing/manifest"
import { AGING_BUCKETS } from "@digimuza/staffing/invoicing/pure"
import { Can } from "@digimuza/system-core/react"
import { useMutation, useQuery } from "convex/react"
import { BellRing, PartyPopper } from "lucide-react"
import Link from "next/link"
import { toast } from "sonner"
import { EmptyState } from "@/components/app/empty-state"
import { PageHeader } from "@/components/app/page-header"
import { useAction } from "@/components/app/use-action"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { useT } from "@/lib/i18n/client"
import type { MessageKey } from "@/lib/i18n/messages"
import { invoiceHref, InvoicingDisabled, InvoicingTabs, Stat, useInvoicingEnabled, useMoney } from "./invoicing-ui"

export function DebtsView() {
  const { t } = useT()
  const money = useMoney()
  const enabled = useInvoicingEnabled()
  const data = useQuery(api.invoicing.debts, enabled ? {} : "skip")
  const remind = useMutation(api.invoicing.sendReminder)
  const runDue = useMutation(api.invoicing.runDueReminders)
  const { run, busy } = useAction()
  if (!enabled) return <InvoicingDisabled />

  const actions = (
    <Can permission={P.invoiceManage}>
      <Button
        size="sm"
        disabled={busy}
        onClick={async () => {
          const res = await run(() => runDue({}))
          if (res) toast.success(t("invoicing.debts.queued").replace("{count}", String(res.queued)))
        }}
      >
        <BellRing />
        {t("invoicing.debts.runDue")}
      </Button>
    </Can>
  )
  return (
    <div>
      <PageHeader title={t("invoicing.debts.title")} lead={t("invoicing.debts.lead")} actions={actions} />
      <InvoicingTabs />
      {!data ? (
        <Skeleton className="h-64 w-full rounded-xl" />
      ) : (
        <div className="grid gap-5">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Stat label={t("invoicing.debts.total")} value={money(data.totalOpenCents)} />
            {AGING_BUCKETS.map((b) => (
              <Stat
                key={b}
                label={t(`invoicing.aging.${b}` as MessageKey)}
                value={money(data.buckets[b].cents)}
                hint={t("invoicing.debts.invoices").replace("{count}", String(data.buckets[b].count))}
                tone={b === "current" ? undefined : b === "d0_30" ? "warn" : data.buckets[b].cents ? "bad" : undefined}
              />
            ))}
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("invoicing.debts.overdue")}</CardTitle>
            </CardHeader>
            <CardContent className="px-0">
              {data.overdue.length === 0 ? (
                <div className="px-4">
                  <EmptyState icon={<PartyPopper />} title={t("invoicing.debts.none")} />
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="px-4">{t("invoicing.col.number")}</TableHead>
                      <TableHead>{t("invoicing.col.client")}</TableHead>
                      <TableHead>{t("invoicing.col.dueDate")}</TableHead>
                      <TableHead className="text-right">{t("invoicing.debts.daysLate")}</TableHead>
                      <TableHead className="text-right">{t("invoicing.col.outstanding")}</TableHead>
                      <TableHead>{t("invoicing.reminders")}</TableHead>
                      <TableHead className="pr-4 text-right" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.overdue.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="px-4 font-mono text-xs">
                          <Link href={invoiceHref(r.id)} className="font-medium hover:underline">
                            {r.number}
                          </Link>
                        </TableCell>
                        <TableCell className="font-medium">{r.clientName}</TableCell>
                        <TableCell className="tabular-nums">{r.dueDate}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          <Badge variant={r.daysOverdue > 30 ? "destructive" : "outline"}>{r.daysOverdue}</Badge>
                        </TableCell>
                        <TableCell className="text-right font-semibold tabular-nums">{money(r.outstandingCents, r.currency)}</TableCell>
                        <TableCell>
                          <div className="flex flex-wrap items-center gap-1 text-xs">
                            {r.remindersSent.length === 0 && <span className="text-muted-foreground">—</span>}
                            {r.remindersSent.map((s) => (
                              <Badge key={s} variant="secondary">
                                {t(`invoicing.reminder.stage${s}` as MessageKey)} ✓
                              </Badge>
                            ))}
                            {r.reminderDue && (
                              <Badge variant="outline" className="border-amber-500 text-amber-700 dark:text-amber-300">
                                {t("invoicing.debts.due").replace("{stage}", t(`invoicing.reminder.stage${r.reminderDue}` as MessageKey))}
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="pr-4 text-right">
                          <Can permission={P.invoiceManage}>
                            <Button size="sm" variant="outline" disabled={busy} onClick={() => void run(() => remind({ invoiceId: r.id as Id<"staffing_invoicing_invoices"> }), { success: t("invoicing.reminder.queued") })}>
                              <BellRing />
                              {t("invoicing.reminder.send")}
                            </Button>
                          </Can>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("invoicing.debts.log")}</CardTitle>
              <p className="text-xs text-muted-foreground">{t("invoicing.debts.schedule")}</p>
            </CardHeader>
            <CardContent className="px-0">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="px-4">{t("invoicing.debts.when")}</TableHead>
                    <TableHead>{t("invoicing.col.number")}</TableHead>
                    <TableHead>{t("invoicing.col.client")}</TableHead>
                    <TableHead>{t("invoicing.debts.stage")}</TableHead>
                    <TableHead>{t("invoicing.debts.trigger")}</TableHead>
                    <TableHead className="pr-4">{t("invoicing.col.status")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.reminders.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="px-4 tabular-nums">{new Date(r.at).toLocaleString("lt-LT", { dateStyle: "short", timeStyle: "short" })}</TableCell>
                      <TableCell className="font-mono text-xs">{r.invoiceNumber}</TableCell>
                      <TableCell>{r.clientName}</TableCell>
                      <TableCell>
                        {t(`invoicing.reminder.stage${r.stage}` as MessageKey)} <span className="text-xs text-muted-foreground">(+{r.daysOverdue} d.)</span>
                      </TableCell>
                      <TableCell>{t(`invoicing.reminder.trigger.${r.trigger}` as MessageKey)}</TableCell>
                      <TableCell className="pr-4">
                        <Badge variant={r.status === "sent" ? "secondary" : r.status === "failed" ? "destructive" : "outline"} title={r.error ?? r.to ?? undefined}>
                          {t(`invoicing.reminder.status.${r.status}` as MessageKey)}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
