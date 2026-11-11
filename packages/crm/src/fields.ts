// `@digimuza/crm/fields`: the field type system, shared by the server
// (validation, search, filters) and the browser (forms, cells, filters).
// No Convex or Node imports: safe in client components.
//
// A record stores `values: { [fieldKey]: value }`. What a value may be is
// decided by its field's definition (type + settings), never by the record.

export const FIELD_TYPES = [
  "text",
  "longText",
  "number",
  "currency",
  "boolean",
  "date",
  "dateTime",
  "select",
  "multiSelect",
  "email",
  "phone",
  "url",
  "rating",
  "relation",
] as const

export type FieldType = (typeof FIELD_TYPES)[number]

export const OPTION_COLORS = ["gray", "red", "orange", "yellow", "green", "teal", "blue", "purple", "pink"] as const
export type OptionColor = (typeof OPTION_COLORS)[number]

export interface SelectOption {
  /** Stable stored value. Never reuse for another meaning. */
  value: string
  label: string
  color: OptionColor
}

/** Per-type configuration. Only the keys relevant to the field's type are read. */
export interface FieldSettings {
  /** text */
  maxLength?: number
  /** number */
  decimals?: number
  min?: number
  max?: number
  /** currency */
  defaultCurrency?: string
  /** select, multiSelect */
  options?: SelectOption[]
  /** rating: 3..10 stars */
  scale?: number
  /** relation: many-to-one to records of this object */
  objectKey?: string
  /** relation: heading of the reverse list on the target record (e.g. "People" on a company) */
  inverseLabel?: string
}

export interface FieldDefinition {
  key: string
  label: string
  type: FieldType
  settings: FieldSettings
  required: boolean
  description?: string
}

/** Stored money: integer minor units (cents) and an ISO 4217 code. */
export interface CurrencyValue {
  amount: number
  currency: string
}

export type FieldValue = string | number | boolean | string[] | CurrencyValue

// ---------------------------------------------------------------- keys

/** Object and field keys: camelCase ASCII, valid as Convex field names. */
export const KEY_PATTERN = /^[a-z][a-zA-Z0-9]{0,47}$/

/** Reserved: they would collide with record properties in API payloads. */
const RESERVED_KEYS = new Set(["settings", "new", "id", "label", "values", "object", "objectKey", "createdAt", "updatedAt", "archived", "position"])

export function isValidKey(key: string): boolean {
  return KEY_PATTERN.test(key) && !RESERVED_KEYS.has(key)
}

/** "Annual revenue (€)" → "annualRevenue". Lithuanian letters fold to ASCII. Empty if nothing usable is left. */
export function keyFromLabel(label: string): string {
  const words = label
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
  const key = words.map((w, i) => (i === 0 ? w.toLowerCase() : w[0]!.toUpperCase() + w.slice(1).toLowerCase())).join("")
  const trimmed = key.replace(/^[0-9]+/, "").slice(0, 48)
  return trimmed ? trimmed[0]!.toLowerCase() + trimmed.slice(1) : ""
}

// ---------------------------------------------------------------- settings

const CURRENCY = /^[A-Z]{3}$/
const DATE = /^\d{4}-\d{2}-\d{2}$/
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PHONE = /^\+?[0-9 ()./-]{5,32}$/

/** Problems with a field definition's type-specific settings. Empty when valid. */
export function settingsProblems(type: FieldType, s: FieldSettings): string[] {
  const p: string[] = []
  const int = (n: unknown) => typeof n === "number" && Number.isInteger(n)
  if (type === "text" && s.maxLength !== undefined && (!int(s.maxLength) || s.maxLength < 1 || s.maxLength > 10_000)) p.push("maxLength")
  if (type === "number") {
    if (s.decimals !== undefined && (!int(s.decimals) || s.decimals < 0 || s.decimals > 6)) p.push("decimals")
    if (s.min !== undefined && !Number.isFinite(s.min)) p.push("min")
    if (s.max !== undefined && !Number.isFinite(s.max)) p.push("max")
    if (s.min !== undefined && s.max !== undefined && s.min > s.max) p.push("min")
  }
  if (type === "currency" && s.defaultCurrency !== undefined && !CURRENCY.test(s.defaultCurrency)) p.push("defaultCurrency")
  if (type === "select" || type === "multiSelect") {
    const opts = s.options ?? []
    if (opts.length === 0 || opts.length > 100) p.push("options")
    const seen = new Set<string>()
    for (const o of opts) {
      if (!o.value || o.value.length > 64 || !o.label.trim() || o.label.length > 80 || !OPTION_COLORS.includes(o.color)) p.push("options")
      if (seen.has(o.value)) p.push("options")
      seen.add(o.value)
    }
  }
  if (type === "rating" && s.scale !== undefined && (!int(s.scale) || s.scale < 3 || s.scale > 10)) p.push("scale")
  if (type === "relation" && (!s.objectKey || !KEY_PATTERN.test(s.objectKey))) p.push("objectKey")
  return [...new Set(p)]
}

/** Keeps only the settings keys that apply to `type`, so stored settings never carry stale config. */
export function cleanSettings(type: FieldType, s: FieldSettings): FieldSettings {
  const pick = <K extends keyof FieldSettings>(...keys: K[]) => Object.fromEntries(keys.filter((k) => s[k] !== undefined).map((k) => [k, s[k]])) as FieldSettings
  switch (type) {
    case "text":
      return pick("maxLength")
    case "number":
      return pick("decimals", "min", "max")
    case "currency":
      return pick("defaultCurrency")
    case "select":
    case "multiSelect":
      return { options: (s.options ?? []).map((o) => ({ value: o.value, label: o.label.trim(), color: o.color })) }
    case "rating":
      return pick("scale")
    case "relation":
      return pick("objectKey", "inverseLabel")
    default:
      return {}
  }
}

export const ratingScale = (s: FieldSettings) => s.scale ?? 5

// ---------------------------------------------------------------- values

export type NormalizeResult = { ok: true; value: FieldValue | undefined } | { ok: false; reason: string }

export function isEmptyValue(v: unknown): boolean {
  return v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0)
}

/**
 * Validates and canonicalises one input value for `field`. `null`, `undefined`
 * and empty strings/arrays mean "no value" (`value: undefined`); required is
 * checked by the caller, which knows whether the whole record is being written.
 * Relation targets are checked by the server (they need the database).
 */
export function normalizeValue(field: FieldDefinition, raw: unknown): NormalizeResult {
  if (isEmptyValue(raw)) return { ok: true, value: undefined }
  const bad = (reason: string): NormalizeResult => ({ ok: false, reason })
  const s = field.settings
  switch (field.type) {
    case "text":
    case "longText": {
      if (typeof raw !== "string") return bad("not_text")
      const value = field.type === "text" ? raw.trim() : raw.replace(/\s+$/, "")
      const max = field.type === "text" ? (s.maxLength ?? 500) : 20_000
      if (value.length > max) return bad("too_long")
      return { ok: true, value: value || undefined }
    }
    case "email": {
      if (typeof raw !== "string") return bad("not_text")
      const value = raw.trim().toLowerCase()
      return EMAIL.test(value) && value.length <= 254 ? { ok: true, value } : bad("invalid_email")
    }
    case "phone": {
      if (typeof raw !== "string") return bad("not_text")
      const value = raw.trim()
      return PHONE.test(value) ? { ok: true, value } : bad("invalid_phone")
    }
    case "url": {
      if (typeof raw !== "string") return bad("not_text")
      const trimmed = raw.trim()
      const value = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`
      try {
        const u = new URL(value)
        if (u.protocol !== "http:" && u.protocol !== "https:") return bad("invalid_url")
        return value.length <= 2048 ? { ok: true, value } : bad("too_long")
      } catch {
        return bad("invalid_url")
      }
    }
    case "number": {
      const n = typeof raw === "string" ? Number(raw.replace(",", ".")) : raw
      if (typeof n !== "number" || !Number.isFinite(n)) return bad("not_number")
      if (s.min !== undefined && n < s.min) return bad("below_min")
      if (s.max !== undefined && n > s.max) return bad("above_max")
      const f = 10 ** (s.decimals ?? 2)
      return { ok: true, value: Math.round(n * f) / f }
    }
    case "currency": {
      if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return bad("not_currency")
      const { amount, currency } = raw as Partial<CurrencyValue>
      const code = (currency ?? s.defaultCurrency ?? "EUR").toUpperCase()
      if (typeof amount !== "number" || !Number.isSafeInteger(amount)) return bad("not_minor_units")
      if (!CURRENCY.test(code)) return bad("invalid_currency")
      return { ok: true, value: { amount, currency: code } }
    }
    case "boolean":
      return typeof raw === "boolean" ? { ok: true, value: raw } : bad("not_boolean")
    case "date": {
      if (typeof raw !== "string" || !DATE.test(raw) || Number.isNaN(Date.parse(`${raw}T00:00:00Z`))) return bad("invalid_date")
      return { ok: true, value: raw }
    }
    case "dateTime":
      return typeof raw === "number" && Number.isSafeInteger(raw) && raw > 0 ? { ok: true, value: raw } : bad("invalid_datetime")
    case "select": {
      if (typeof raw !== "string") return bad("not_option")
      return (s.options ?? []).some((o) => o.value === raw) ? { ok: true, value: raw } : bad("unknown_option")
    }
    case "multiSelect": {
      if (!Array.isArray(raw) || raw.some((x) => typeof x !== "string")) return bad("not_options")
      const allowed = new Set((s.options ?? []).map((o) => o.value))
      const value = [...new Set(raw as string[])]
      return value.every((x) => allowed.has(x)) ? { ok: true, value } : bad("unknown_option")
    }
    case "rating":
      return typeof raw === "number" && Number.isInteger(raw) && raw >= 1 && raw <= ratingScale(s) ? { ok: true, value: raw } : bad("invalid_rating")
    case "relation":
      return typeof raw === "string" && raw.length <= 64 ? { ok: true, value: raw } : bad("invalid_relation")
  }
}

/** Plain-text form of a value, for the record label and the search index. */
export function valueToText(field: FieldDefinition, v: unknown): string {
  if (isEmptyValue(v)) return ""
  switch (field.type) {
    case "select":
      return field.settings.options?.find((o) => o.value === v)?.label ?? String(v)
    case "multiSelect":
      return (v as string[]).map((x) => field.settings.options?.find((o) => o.value === x)?.label ?? x).join(", ")
    case "currency": {
      const c = v as CurrencyValue
      return `${(c.amount / 100).toFixed(2)} ${c.currency}`
    }
    case "boolean":
    case "dateTime":
    case "rating":
    case "relation":
      return ""
    default:
      return String(v)
  }
}

/** Field types whose text goes into the search index. */
export const SEARCHABLE_TYPES: ReadonlySet<FieldType> = new Set(["text", "longText", "email", "phone", "url", "select", "multiSelect"])

// ---------------------------------------------------------------- filters and sorting

export const FILTER_OPERATORS = ["eq", "neq", "contains", "notContains", "gt", "gte", "lt", "lte", "in", "isEmpty", "isNotEmpty"] as const
export type FilterOperator = (typeof FILTER_OPERATORS)[number]

export interface ViewFilter {
  fieldKey: string
  operator: FilterOperator
  /** Unused for isEmpty / isNotEmpty; a string[] for `in`. */
  value?: unknown
}

export interface ViewSort {
  fieldKey: string
  direction: "asc" | "desc"
}

/** Operators that make sense for each type (what filter UIs offer). */
export function operatorsFor(type: FieldType): FilterOperator[] {
  const empty: FilterOperator[] = ["isEmpty", "isNotEmpty"]
  switch (type) {
    case "text":
    case "longText":
    case "email":
    case "phone":
    case "url":
      return ["contains", "notContains", "eq", "neq", ...empty]
    case "number":
    case "rating":
    case "date":
    case "dateTime":
    case "currency":
      return ["eq", "neq", "gt", "gte", "lt", "lte", ...empty]
    case "boolean":
      return ["eq"]
    case "select":
      return ["in", "eq", "neq", ...empty]
    case "multiSelect":
      return ["in", "contains", ...empty]
    case "relation":
      return ["eq", "neq", ...empty]
  }
}

const comparable = (field: FieldDefinition, v: unknown): number | string | boolean | undefined => {
  if (isEmptyValue(v)) return undefined
  if (field.type === "currency") return (v as CurrencyValue).amount
  if (field.type === "select") {
    // Option order, so a "stage" field sorts by pipeline position, not alphabet.
    const i = field.settings.options?.findIndex((o) => o.value === v) ?? -1
    return i
  }
  if (field.type === "multiSelect") return (v as string[]).join(",")
  if (typeof v === "string" && field.type !== "date") return v.toLocaleLowerCase()
  return v as number | string | boolean
}

/** Whether a record's value for `field` passes `filter`. Unknown operators never match. */
export function matchesFilter(field: FieldDefinition, value: unknown, filter: ViewFilter): boolean {
  const op = filter.operator
  if (op === "isEmpty") return isEmptyValue(value)
  if (op === "isNotEmpty") return !isEmptyValue(value)
  if (field.type === "multiSelect") {
    const have = (value as string[] | undefined) ?? []
    const want = Array.isArray(filter.value) ? (filter.value as string[]) : [String(filter.value ?? "")]
    if (op === "in") return want.some((w) => have.includes(w))
    if (op === "contains") return want.every((w) => have.includes(w))
    return false
  }
  if (op === "in") {
    const want = Array.isArray(filter.value) ? filter.value : []
    return want.includes(value)
  }
  if (op === "contains" || op === "notContains") {
    const needle = String(filter.value ?? "").toLocaleLowerCase()
    const hay = String(value ?? "").toLocaleLowerCase()
    const has = needle === "" || hay.includes(needle)
    return op === "contains" ? has : !has
  }
  const a = comparable(field, value)
  const target = field.type === "currency" && typeof filter.value === "object" && filter.value !== null ? (filter.value as CurrencyValue).amount : filter.value
  const b = field.type === "select" ? comparable(field, target) : typeof target === "string" && field.type !== "date" ? target.toLocaleLowerCase() : target
  if (op === "eq") return a === b
  if (op === "neq") return a !== b
  if (a === undefined || b === undefined || b === null) return false
  if (typeof a !== typeof b) return false
  if (op === "gt") return a > (b as typeof a)
  if (op === "gte") return a >= (b as typeof a)
  if (op === "lt") return a < (b as typeof a)
  if (op === "lte") return a <= (b as typeof a)
  return false
}

/** Comparator for one field. Empty values always sort last. */
export function compareValues(field: FieldDefinition, a: unknown, b: unknown, direction: "asc" | "desc" = "asc"): number {
  const x = comparable(field, a)
  const y = comparable(field, b)
  if (x === undefined && y === undefined) return 0
  if (x === undefined) return 1
  if (y === undefined) return -1
  const r = typeof x === "string" && typeof y === "string" ? x.localeCompare(y) : x < y ? -1 : x > y ? 1 : 0
  return direction === "asc" ? r : -r
}
