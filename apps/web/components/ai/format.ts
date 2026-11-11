import { MESSAGES, type Locale, type MessageKey } from "@/lib/i18n/messages"

/** Localized message for a stable system-core error code, or the raw text. */
export function errorText(t: (k: MessageKey) => string, codeOrMessage: string) {
  const key = `error.${codeOrMessage}`
  return key in MESSAGES.lt ? t(key as MessageKey) : codeOrMessage
}

/** Operation ID on an error object, when the backend includes one. */
export function operationIdOf(error: unknown): string | null {
  if (error && typeof error === "object" && "operationId" in error && typeof error.operationId === "string") return error.operationId
  return null
}

/** One-line value for the compact key/value summary of tool arguments. */
export function shortValue(v: unknown, max = 60) {
  const s = typeof v === "string" ? v : v === undefined ? "" : JSON.stringify(v)
  return s.length > max ? `${s.slice(0, max - 1)}…` : s
}

export function pretty(v: unknown) {
  return typeof v === "string" ? v : JSON.stringify(v, null, 2)
}

type T = (k: MessageKey) => string

function lookup(t: T, key: string): string | null {
  return key in MESSAGES.lt ? t(key as MessageKey) : null
}

/** "create_invoice" / "amountEur" → "Create invoice" / "Amount eur". */
export function humanize(id: string) {
  const s = id
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_\-.]+/g, " ")
    .trim()
    .toLowerCase()
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** Human label for a tool id (`ai.toolLabel.<id>`), else the humanized last segment. */
export function toolLabel(t: T, toolId: string) {
  return lookup(t, `ai.toolLabel.${toolId}`) ?? humanize(toolId.split(".").pop() ?? toolId)
}

/** Module part of a tool id, e.g. "finance" (shown as a quiet prefix). */
export function toolModule(toolId: string) {
  return toolId.includes(".") ? toolId.split(".")[0] : null
}

/** Human label for a tool argument (`ai.arg.<key>`), else humanized. */
export function argLabel(t: T, key: string) {
  return lookup(t, `ai.arg.${key}`) ?? humanize(key)
}

/** Display value for a tool argument: money for `…Eur` keys, locale numbers, short JSON otherwise. */
export function argValue(key: string, v: unknown, locale: Locale) {
  const tag = locale === "lt" ? "lt-LT" : "en-GB"
  if (typeof v === "number") {
    if (/eur$/i.test(key)) return new Intl.NumberFormat(tag, { style: "currency", currency: "EUR" }).format(v)
    return new Intl.NumberFormat(tag).format(v)
  }
  if (typeof v === "boolean") return v ? "✓" : "—"
  return shortValue(v)
}
