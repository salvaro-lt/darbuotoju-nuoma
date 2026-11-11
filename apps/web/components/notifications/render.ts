import { formatDate, formatMoney } from "@/lib/format"
import { MESSAGES, type Locale, type MessageKey } from "@/lib/i18n/messages"

// In-app text for notifications. Kept in step with `render` in convex/notifications.ts
// (the email): same subject as the title, same first line as the body.

type Params = Record<string, unknown>

const str = (v: unknown) => (typeof v === "string" ? v : Array.isArray(v) ? v.filter((x) => typeof x === "string").join(", ") : "")

/** `{name}` placeholders → values. */
export const fill = (template: string, values: Record<string, string | number>) => template.replace(/\{(\w+)\}/g, (m, k: string) => (k in values ? String(values[k]) : m))

const keyOf = (locale: Locale, key: string): MessageKey | null => (key in MESSAGES[locale] ? (key as MessageKey) : null)

/** Title and body of one notification in the UI language. Unknown types get a generic text. */
export function renderNotification(type: string, params: unknown, locale: Locale): { title: string; body: string } {
  const dict = MESSAGES[locale]
  const p = (params && typeof params === "object" ? params : {}) as Params
  const title = keyOf(locale, `notif.type.${type}.title`)
  const body = keyOf(locale, `notif.type.${type}.body`)
  if (!title || !body) return { title: dict["notif.type.unknown.title"], body: dict["notif.type.unknown.body"] }
  const values: Record<string, string> = {}
  for (const [k, v] of Object.entries(p)) values[k] = str(v)
  if (typeof p.amountCents === "number") values.amount = formatMoney(p.amountCents, typeof p.currency === "string" ? p.currency : "EUR", locale)
  return { title: fill(dict[title], values), body: fill(dict[body], values) }
}

/** Short name of a type for the preferences table; falls back to the module's description, then the id. */
export function typeName(type: string, fallback: string | null, locale: Locale) {
  const k = keyOf(locale, `notif.type.${type}.name`)
  return k ? MESSAGES[locale][k] : (fallback ?? type)
}

/** What the type means, or null when the app has no text for it. */
export function typeAbout(type: string, locale: Locale) {
  const k = keyOf(locale, `notif.type.${type}.about`)
  return k ? MESSAGES[locale][k] : null
}

export function moduleLabel(moduleId: string, locale: Locale) {
  const k = keyOf(locale, `notif.module.${moduleId || "other"}`)
  return k ? MESSAGES[locale][k] : moduleId
}

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["minute", 60],
  ["hour", 60 * 60],
  ["day", 24 * 60 * 60],
]

/** "ką tik", "prieš 5 min.", "vakar", … up to a week; older ones get the date. */
export function relativeTime(ms: number, now: number, locale: Locale) {
  const sec = Math.max(0, Math.round((now - ms) / 1000))
  if (sec < 60) return MESSAGES[locale]["notif.time.now"]
  if (sec >= 7 * 24 * 60 * 60) return formatDate(ms, locale)
  const rtf = new Intl.RelativeTimeFormat(locale === "lt" ? "lt-LT" : "en-GB", { numeric: "auto", style: "short" })
  const [unit, size] = [...UNITS].reverse().find(([, s]) => sec >= s)!
  return rtf.format(-Math.floor(sec / size), unit)
}

/** Unread count as shown in badges: the backend caps at 100. */
export const countLabel = (n: number) => (n > 99 ? "99+" : String(n))
