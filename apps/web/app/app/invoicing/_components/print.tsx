"use client"
import { useQuery } from "convex/react"
import { Printer } from "lucide-react"
import { Button } from "@/components/ui/button"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { useT } from "@/lib/i18n/client"
import type { MessageKey } from "@/lib/i18n/messages"
import { fmtHours, useInvoicingEnabled, useMoney } from "./invoicing-ui"

/** A plain A4 invoice: the browser's "Print → Save as PDF" makes the PDF. Always in the client's language (LT for LT clients, else EN + LT). */
export function PrintableInvoice({ invoiceId }: { invoiceId: string }) {
  const { t } = useT()
  const money = useMoney()
  const enabled = useInvoicingEnabled()
  const d = useQuery(api.invoicing.getInvoice, enabled ? { invoiceId: invoiceId as Id<"staffing_invoicing_invoices"> } : "skip")
  if (d === undefined) return <p className="p-8 text-sm text-muted-foreground">…</p>
  if (d === null) return <p className="p-8 text-sm">{t("invoicing.notFound")}</p>
  const inv = d.invoice
  const bi = d.client.country !== "LT"
  const L = (lt: string, en: string) => (bi ? `${lt} / ${en}` : lt)
  const rate: Record<string, [string, string]> = { regular: ["Įprastos val.", "Regular hours"], overtime: ["Viršvalandžiai", "Overtime"], weekend: ["Savaitgalio val.", "Weekend hours"] }

  return (
    <div className="mx-auto max-w-[210mm] bg-white p-10 text-[13px] text-black print:p-0">
      <div className="mb-6 flex justify-end print:hidden">
        <Button size="sm" onClick={() => window.print()}>
          <Printer />
          {t("invoicing.print")}
        </Button>
      </div>
      <header className="flex items-start justify-between gap-6 border-b pb-5">
        <div>
          <h1 className="text-xl font-bold">{L("PVM SĄSKAITA FAKTŪRA", "VAT INVOICE")}</h1>
          <p className="mt-1 text-base font-semibold">
            {L("Serija ir Nr.", "No.")} {inv.number ?? t("invoicing.draftNumber")}
          </p>
        </div>
        <dl className="grid grid-cols-[auto_auto] gap-x-4 gap-y-0.5 text-right">
          <dt className="text-muted-foreground">{L("Išrašymo data", "Issue date")}</dt>
          <dd>{inv.issueDate ?? "—"}</dd>
          <dt className="text-muted-foreground">{L("Apmokėti iki", "Due date")}</dt>
          <dd className="font-semibold">{inv.dueDate ?? "—"}</dd>
          <dt className="text-muted-foreground">{L("Laikotarpis", "Period")}</dt>
          <dd>
            {inv.periodFrom} – {inv.periodTo}
          </dd>
        </dl>
      </header>

      <section className="grid grid-cols-2 gap-8 py-5">
        <div>
          <h2 className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{L("Pardavėjas", "Seller")}</h2>
          <p className="font-semibold">{d.seller.name}</p>
          <p>{d.seller.address}</p>
          <p>
            {L("Įm. kodas", "Reg. no.")} {d.seller.companyCode}
          </p>
          <p>
            {L("PVM kodas", "VAT no.")} {d.seller.vatCode}
          </p>
          <p>
            {d.seller.bank}, {d.seller.iban}
          </p>
        </div>
        <div>
          <h2 className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{L("Pirkėjas", "Buyer")}</h2>
          <p className="font-semibold">{d.client.name}</p>
          {d.client.address && <p>{d.client.address}</p>}
          {d.client.companyCode && (
            <p>
              {L("Įm. kodas", "Reg. no.")} {d.client.companyCode}
            </p>
          )}
          {d.client.vatCode && (
            <p>
              {L("PVM kodas", "VAT no.")} {d.client.vatCode}
            </p>
          )}
        </div>
      </section>

      <table className="w-full border-collapse">
        <thead>
          <tr className="border-y bg-muted text-left text-xs">
            <th className="py-2 pr-2">{L("Paslauga", "Service")}</th>
            <th className="py-2 pr-2">{L("Projektas", "Project")}</th>
            <th className="py-2 pr-2 text-right">{L("Kiekis, val.", "Qty, h")}</th>
            <th className="py-2 pr-2 text-right">{L("Kaina", "Price")}</th>
            <th className="py-2 text-right">{L("Suma", "Amount")}</th>
          </tr>
        </thead>
        <tbody>
          {d.lines.map((l, i) => (
            <tr key={i} className="border-b">
              <td className="py-1.5 pr-2">
                {L("Darbuotojų nuoma", "Staff leasing")}: {bi ? l.tradeNameEn : l.tradeNameLt}
                <span className="text-muted-foreground">
                  {" "}
                  – {L(...rate[l.rateType]!)}
                  {l.multiplierPct !== 100 ? ` (${l.multiplierPct}%)` : ""}
                </span>
              </td>
              <td className="py-1.5 pr-2 font-mono text-xs">{l.projectCode}</td>
              <td className="py-1.5 pr-2 text-right tabular-nums">{fmtHours(l.hours)}</td>
              <td className="py-1.5 pr-2 text-right tabular-nums">{money(l.unitPriceCents, inv.currency)}</td>
              <td className="py-1.5 text-right tabular-nums">{money(l.amountCents, inv.currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-4 ml-auto grid w-72 grid-cols-[1fr_auto] gap-x-4 gap-y-1">
        <span>{L("Suma be PVM", "Subtotal")}</span>
        <span className="text-right tabular-nums">{money(inv.subtotalCents, inv.currency)}</span>
        <span>
          {L("PVM", "VAT")} {d.vatRatePct}%
        </span>
        <span className="text-right tabular-nums">{money(inv.vatCents, inv.currency)}</span>
        <span className="border-t pt-1 font-bold">{L("Iš viso", "Total")}</span>
        <span className="border-t pt-1 text-right font-bold tabular-nums">{money(inv.totalCents, inv.currency)}</span>
      </div>
      {d.vatRatePct === 0 && <p className="mt-4 text-xs text-muted-foreground">{L("PVM neskaičiuojamas: atvirkštinis apmokestinimas (PVM direktyvos 196 str.).", "VAT reverse charge (Article 196, Council Directive 2006/112/EC).")}</p>}
      <p className="mt-8 text-xs text-muted-foreground">{t("invoicing.printNote" as MessageKey)}</p>
    </div>
  )
}
