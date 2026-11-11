"use client"
// Shared pieces of the invoicing pages (staffing-invoicing module).
import { STAFFING_INVOICING_MODULE_ID, StaffingInvoicingPermissions } from "@digimuza/staffing/invoicing/manifest"
import type { InvoiceStatus } from "@digimuza/staffing/invoicing/pure"
import { useCan, useVisibleModules } from "@digimuza/system-core/react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import type { ReactNode } from "react"
import { Badge } from "@/components/ui/badge"
import { useT } from "@/lib/i18n/client"
import type { MessageKey } from "@/lib/i18n/messages"
import { useStaffingEnabled } from "../../staffing/_components/staffing-ui"

export function useInvoicingEnabled() {
  const staffingOn = useStaffingEnabled()
  const modules = useVisibleModules()
  return staffingOn && modules.some((m) => m.id === STAFFING_INVOICING_MODULE_ID && m.effective)
}

/** Renders the sidebar link only when the module is on and the user may read invoices. */
export function InvoicingNavGate({ children }: { children: ReactNode }) {
  const on = useInvoicingEnabled()
  const can = useCan(StaffingInvoicingPermissions.invoiceRead)
  return on && can ? children : null
}

export const invoiceHref = (id: string) => `/app/invoicing/${id}`
export const invoicePrintHref = (id: string) => `/print/invoices/${id}`
export const profitHref = (projectId: string) => `/app/invoicing/profitability/${projectId}`

/** 123456 → "1 234,56 €" (LT) / "€1,234.56" (EN). */
export function useMoney() {
  const { locale } = useT()
  const fmt = new Intl.NumberFormat(locale === "en" ? "en-IE" : "lt-LT", { style: "currency", currency: "EUR" })
  return (cents: number, currency = "EUR") => (currency === "EUR" ? fmt.format(cents / 100) : `${(cents / 100).toFixed(2)} ${currency}`)
}

export const fmtHours = (h: number) => (Math.round(h * 100) / 100).toLocaleString("lt-LT")

const STATUS_CLASS: Record<InvoiceStatus, string> = {
  draft: "border-dashed",
  approved: "bg-secondary text-foreground dark:bg-secondary dark:text-foreground border-transparent",
  sent: "bg-secondary text-foreground dark:bg-secondary dark:text-foreground border-transparent",
  partially_paid: "bg-marking/15 text-marking-foreground dark:text-marking dark:bg-marking/15 dark:text-marking border-transparent",
  paid: "bg-steel-green/15 text-steel-green dark:bg-steel-green/15 dark:text-steel-green border-transparent",
}

export function InvoiceStatusBadge({ status, overdueDays }: { status: InvoiceStatus; overdueDays?: number }) {
  const { t } = useT()
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <Badge variant="outline" className={STATUS_CLASS[status]}>
        {t(`invoicing.status.${status}` as MessageKey)}
      </Badge>
      {!!overdueDays && overdueDays > 0 && <Badge variant="destructive">{t("invoicing.overdueDays").replace("{days}", String(overdueDays))}</Badge>}
    </span>
  )
}

const TABS: { href: string; label: MessageKey; exact?: boolean }[] = [
  { href: "/app/invoicing", label: "invoicing.tabs.invoices", exact: true },
  { href: "/app/invoicing/chain", label: "invoicing.tabs.chain" },
  { href: "/app/invoicing/debts", label: "invoicing.tabs.debts" },
  { href: "/app/invoicing/purchases", label: "invoicing.tabs.purchases" },
  { href: "/app/invoicing/hours", label: "invoicing.tabs.hours" },
  { href: "/app/invoicing/profitability", label: "invoicing.tabs.profitability" },
]

/** Section tabs under the page header. */
export function InvoicingTabs() {
  const { t } = useT()
  const path = usePathname()
  const canProfit = useCan(StaffingInvoicingPermissions.profitRead)
  return (
    <nav className="mb-5 flex flex-wrap gap-1 border-b print:hidden" aria-label={t("invoicing.nav")}>
      {TABS.filter((x) => x.href !== "/app/invoicing/profitability" || canProfit).map((x) => {
        const active = x.exact ? path === x.href || (/^\/app\/invoicing\/[a-z0-9]{20,}$/.test(path) && x.href === "/app/invoicing") : path.startsWith(x.href)
        return (
          <Link
            key={x.href}
            href={x.href}
            aria-current={active ? "page" : undefined}
            className={`-mb-px border-b-2 px-3 py-2 text-sm transition-colors ${active ? "border-primary font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          >
            {t(x.label)}
          </Link>
        )
      })}
    </nav>
  )
}

export function InvoicingDisabled() {
  const { t } = useT()
  return <p className="text-sm text-muted-foreground">{t("invoicing.disabled")}</p>
}

/** A KPI tile. */
export function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "bad" | "good" | "warn" }) {
  const toneClass = tone === "bad" ? "text-destructive dark:text-destructive" : tone === "good" ? "text-steel-green dark:text-steel-green" : tone === "warn" ? "text-marking-foreground dark:text-marking dark:text-marking" : ""
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`mt-1 text-xl font-semibold tabular-nums ${toneClass}`}>{value}</div>
      {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
    </div>
  )
}

/** Saves text as a file in the browser. CSV gets a UTF-8 BOM so Excel and B1 read the Lithuanian letters. */
export function downloadText(fileName: string, text: string, mime = "text/csv;charset=utf-8") {
  const blob = new Blob(["\uFEFF", text], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export const marginTone = (pct: number | null): "bad" | "warn" | "good" | undefined => (pct === null ? undefined : pct < 10 ? "bad" : pct < 20 ? "warn" : "good")
