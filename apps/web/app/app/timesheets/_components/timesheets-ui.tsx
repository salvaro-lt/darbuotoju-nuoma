"use client"
// Shared pieces of the timesheets pages.
import { STAFFING_TIMESHEETS_MODULE_ID, StaffingTimesheetsPermissions } from "@digimuza/staffing/timesheets/manifest"
import { useCan, useVisibleModules } from "@digimuza/system-core/react"
import { ClipboardCheck } from "lucide-react"
import type { ReactNode } from "react"
import { useT } from "@/lib/i18n/client"

export function useTimesheetsEnabled() {
  return useVisibleModules().some((m) => m.id === STAFFING_TIMESHEETS_MODULE_ID && m.effective)
}

/** The sidebar link; renders through the sidebar's own NavItem. */
export function TimesheetsNavItem({ render }: { render: (p: { href: string; icon: ReactNode; label: string }) => ReactNode }) {
  const { t } = useT()
  const on = useTimesheetsEnabled()
  const can = useCan(StaffingTimesheetsPermissions.read)
  if (!on || !can) return null
  return render({ href: "/app/timesheets", icon: <ClipboardCheck />, label: t("timesheets.nav") })
}

export const timesheetsHref = "/app/timesheets"
export const projectTimesheetHref = (projectId: string, week?: string) => `/app/timesheets/${projectId}${week ? `?week=${week}` : ""}`
export const sheetHref = (sheetId: string) => `/app/timesheets/sheets/${sheetId}`

/** Fills `{name}` placeholders. */
export function fmt(s: string, vars: Record<string, string | number>): string {
  return s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m))
}

/** Hours as written in the UI language (7,5 / 7.5); empty for 0 / null. */
export function useHours() {
  const { locale } = useT()
  return (h: number | null | undefined, keepZero = false) => {
    if (h === null || h === undefined || (!h && !keepZero)) return ""
    const s = Number.isInteger(h) ? String(h) : String(Math.round(h * 100) / 100)
    return locale === "lt" ? s.replace(".", ",") : s
  }
}

export const parseHoursInput = (s: string): number | null => {
  const t = s.trim().replace(",", ".")
  if (!t) return 0
  const n = Number(t)
  return Number.isFinite(n) && n >= 0 && n <= 24 ? Math.round(n * 4) / 4 : null
}

export function useDateFormat() {
  const { locale } = useT()
  const tag = locale === "lt" ? "lt-LT" : "en-GB"
  return {
    day: (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString(tag, { timeZone: "UTC", month: "2-digit", day: "2-digit" }),
    weekday: (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString(tag, { timeZone: "UTC", weekday: "short" }),
    full: (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString(tag, { timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit" }),
    stamp: (ms: number) => new Date(ms).toLocaleString(tag, { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }),
  }
}

export function TimesheetsDisabled() {
  const { t } = useT()
  return <p className="text-sm text-muted-foreground">{t("timesheets.disabled")}</p>
}
