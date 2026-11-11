"use client"
import type { CrmFieldView, CrmListResult } from "@digimuza/crm"
import { isEmptyValue, ratingScale, type CurrencyValue, type OptionColor } from "@digimuza/crm/fields"
import { Check, Star } from "lucide-react"
import Link from "next/link"
import { Badge } from "@/components/ui/badge"
import { formatDate, formatMoney } from "@/lib/format"
import { useT } from "@/lib/i18n/client"
import { cn } from "@/lib/utils"
import { recordHref } from "./use-crm"

/** Option colours as a small dot: the brand's accent stays for actions, options stay readable in both themes. */
export const OPTION_DOT: Record<OptionColor, string> = {
  gray: "bg-zinc-400",
  red: "bg-red-500",
  orange: "bg-orange-500",
  yellow: "bg-amber-400",
  green: "bg-emerald-500",
  teal: "bg-teal-500",
  blue: "bg-blue-500",
  purple: "bg-violet-500",
  pink: "bg-pink-500",
}

export function OptionBadge({ label, color }: { label: string; color: OptionColor }) {
  return (
    <Badge variant="outline" className="max-w-full gap-1.5 font-normal">
      <span className={cn("size-1.5 shrink-0 rounded-full", OPTION_DOT[color])} aria-hidden />
      <span className="truncate">{label}</span>
    </Badge>
  )
}

const tag = (l: string) => (l === "lt" ? "lt-LT" : "en-GB")

/** Read-only rendering of one value. Empty values render nothing (callers decide the placeholder). */
export function FieldValueDisplay({ field, value, relationLabels, compact }: { field: CrmFieldView; value: unknown; relationLabels?: CrmListResult["relationLabels"]; compact?: boolean }) {
  const { t, locale } = useT()
  if (isEmptyValue(value)) return null
  const s = field.settings
  switch (field.type) {
    case "text":
    case "phone":
      return <span className="truncate">{String(value)}</span>
    case "longText":
      return <span className={cn("whitespace-pre-wrap", compact && "line-clamp-2")}>{String(value)}</span>
    case "email":
      return (
        <a href={`mailto:${String(value)}`} className="truncate underline-offset-4 hover:underline" onClick={(e) => e.stopPropagation()}>
          {String(value)}
        </a>
      )
    case "url": {
      const href = String(value)
      return (
        <a href={href} target="_blank" rel="noreferrer noopener" className="truncate underline-offset-4 hover:underline" onClick={(e) => e.stopPropagation()}>
          {href.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}
        </a>
      )
    }
    case "number":
      return <span className="tabular-nums">{new Intl.NumberFormat(tag(locale), { maximumFractionDigits: s.decimals ?? 2 }).format(value as number)}</span>
    case "currency": {
      const c = value as CurrencyValue
      return <span className="tabular-nums">{formatMoney(c.amount, c.currency, locale)}</span>
    }
    case "boolean":
      return value ? (
        <span className="inline-flex items-center gap-1">
          <Check className="size-3.5" aria-hidden />
          {t("crm.yes")}
        </span>
      ) : (
        <span className="text-muted-foreground">{t("crm.no")}</span>
      )
    case "date":
      return <span className="tabular-nums">{formatDate(Date.parse(`${String(value)}T00:00:00`), locale)}</span>
    case "dateTime":
      return <span className="tabular-nums">{new Intl.DateTimeFormat(tag(locale), { dateStyle: "medium", timeStyle: "short" }).format(value as number)}</span>
    case "select": {
      const o = s.options?.find((x) => x.value === value)
      return o ? <OptionBadge label={o.label} color={o.color} /> : <span className="text-muted-foreground">{String(value)}</span>
    }
    case "multiSelect":
      return (
        <span className="flex flex-wrap gap-1">
          {(value as string[]).map((v) => {
            const o = s.options?.find((x) => x.value === v)
            return <OptionBadge key={v} label={o?.label ?? v} color={o?.color ?? "gray"} />
          })}
        </span>
      )
    case "rating": {
      const n = value as number
      return (
        <span className="inline-flex items-center gap-0.5" aria-label={`${n} / ${ratingScale(s)}`}>
          {Array.from({ length: ratingScale(s) }, (_, i) => (
            <Star key={i} className={cn("size-3.5", i < n ? "fill-foreground text-foreground" : "text-muted-foreground/40")} aria-hidden />
          ))}
        </span>
      )
    }
    case "relation": {
      const target = relationLabels?.[value as string]
      if (!target) return null
      return (
        <Link href={recordHref(target.objectKey, value as string)} className="truncate font-medium underline-offset-4 hover:underline" onClick={(e) => e.stopPropagation()}>
          {target.label || "…"}
        </Link>
      )
    }
  }
}
