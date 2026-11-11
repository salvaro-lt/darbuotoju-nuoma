"use client"
// Printable workwear and PPE packing list from the team's clothing sizes.
import type { LogisticsPlan } from "@digimuza/staffing"
import { AlertTriangle, Printer } from "lucide-react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useT } from "@/lib/i18n/client"
import type { MessageKey } from "@/lib/i18n/messages"
import { workerHref } from "../../staffing/_components/staffing-ui"

// Printing shows only the packing list.
const PRINT_CSS = `@media print {
  body * { visibility: hidden !important; }
  #packing-list, #packing-list * { visibility: visible !important; }
  #packing-list { position: absolute; inset: 0 auto auto 0; width: 100%; }
  #packing-list .no-print { display: none !important; }
}`

export function Workwear({ plan }: { plan: LogisticsPlan }) {
  const { t } = useT()
  const p = plan.packing
  const sizes = (title: string, rows: { size: string; count: number }[]) => (
    <div className="rounded-lg border">
      <p className="border-b px-3 py-2 text-sm font-medium">{title}</p>
      <table className="w-full text-sm">
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td className="px-3 py-1.5 text-muted-foreground">{t("logistics.common.none")}</td>
            </tr>
          ) : (
            rows.map((r) => (
              <tr key={r.size} className="border-b last:border-0">
                <td className="px-3 py-1.5">{r.size}</td>
                <td className="px-3 py-1.5 text-right font-medium tabular-nums">× {r.count}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
  return (
    <Card id="packing-list">
      <style>{PRINT_CSS}</style>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle>{t("logistics.ww.title")}</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            {plan.project.code} · {plan.project.name} · {plan.project.city} — {t("logistics.ww.people")}: <span className="font-medium tabular-nums">{p.people}</span>
          </p>
          <p className="no-print mt-1 text-xs text-muted-foreground">{t("logistics.ww.lead")}</p>
        </div>
        <Button size="sm" variant="outline" className="no-print" onClick={() => window.print()}>
          <Printer />
          {t("logistics.ww.print")}
        </Button>
      </CardHeader>
      <CardContent className="space-y-5">
        {p.missing.length > 0 && (
          <div className="rounded-lg border border-marking-foreground/50 bg-marking/15 px-3 py-2 text-sm dark:border-marking-foreground/50 dark:bg-marking/20">
            <p className="flex items-center gap-1.5 font-medium text-marking-foreground dark:text-marking dark:text-marking">
              <AlertTriangle className="size-4" />
              {t("logistics.ww.missing")}
            </p>
            <ul className="mt-1">
              {p.missing.map((m) => (
                <li key={m.workerId}>
                  <Link href={workerHref(m.workerId)} className="underline-offset-2 hover:underline">
                    {m.name}
                  </Link>
                  : <span className="text-muted-foreground">{m.fields.map((f) => t(`logistics.ww.${f}` as MessageKey).toLowerCase()).join(", ")}</span>
                </li>
              ))}
            </ul>
            <p className="no-print mt-1 text-xs text-muted-foreground">{t("logistics.ww.missingHint")}</p>
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-3">
          {sizes(t("logistics.ww.jacket"), p.jacket)}
          {sizes(t("logistics.ww.trousers"), p.trousers)}
          {sizes(t("logistics.ww.shoes"), p.shoes)}
        </div>
        <div>
          <p className="mb-2 text-sm font-medium">{t("logistics.ww.ppe")}</p>
          <div className="grid gap-x-6 sm:grid-cols-2">
            {p.ppe.map((i) => (
              <div key={i.item} className="flex justify-between border-b py-1.5 text-sm">
                <span>☐ {t(`logistics.ppe.${i.item}` as MessageKey)}</span>
                <span className="font-medium tabular-nums">× {i.qty}</span>
              </div>
            ))}
          </div>
        </div>
        <div>
          <p className="mb-2 text-sm font-medium">{t("logistics.ww.perPerson")}</p>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>{t("logistics.team.worker")}</TableHead>
                  <TableHead>{t("logistics.ww.jacket")}</TableHead>
                  <TableHead>{t("logistics.ww.trousers")}</TableHead>
                  <TableHead>{t("logistics.ww.shoes")}</TableHead>
                  <TableHead>{t("logistics.ww.ppe")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {p.perPerson.map((r) => (
                  <TableRow key={r.workerId}>
                    <TableCell className="font-medium">{r.name}</TableCell>
                    {(["jacket", "trousers", "shoes"] as const).map((f) => (
                      <TableCell key={f} className={r.sizes[f] ? "tabular-nums" : "font-medium text-destructive dark:text-destructive"}>
                        {r.sizes[f] || "?"}
                      </TableCell>
                    ))}
                    <TableCell className="text-xs text-muted-foreground">{r.kit.map((k) => `${t(`logistics.ppe.${k.item}` as MessageKey)}${k.qty > 1 ? ` ×${k.qty}` : ""}`).join(", ")}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
