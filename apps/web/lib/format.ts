import type { Locale } from "@/lib/i18n/messages"

const tag = (l: Locale) => (l === "lt" ? "lt-LT" : "en-GB")

export const formatMoney = (cents: number, currency: string, l: Locale) =>
  new Intl.NumberFormat(tag(l), { style: "currency", currency }).format(cents / 100)

export const formatDate = (ms: number, l: Locale) => new Intl.DateTimeFormat(tag(l), { dateStyle: "medium" }).format(ms)

export const formatTime = (ms: number, l: Locale) => new Intl.DateTimeFormat(tag(l), { timeStyle: "short" }).format(ms)
