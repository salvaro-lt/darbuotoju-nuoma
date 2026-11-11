// Signing templates: where each signer fills what on a PDF. Pure types and
// checks, shared by the Convex functions, the template builder and the public
// signing page. Coordinates are fractions of the page (0..1), origin top-left,
// so they survive any render scale.

export const SIGNING_FIELD_TYPES = ["signature", "initials", "text", "name", "email", "date", "checkbox"] as const
export type SigningFieldType = (typeof SIGNING_FIELD_TYPES)[number]

export interface SigningField {
  /** Stable within the template: values are keyed by it. */
  id: string
  type: SigningFieldType
  /** Index into the template's `roles`. */
  role: number
  label: string
  required: boolean
  /** 0-based page index. */
  page: number
  x: number
  y: number
  w: number
  h: number
}

export interface PageSize {
  width: number
  height: number
}

/** A signer's answer: image data URL for signature/initials, boolean for checkbox, text otherwise. */
export type SigningValue = string | boolean

export const MAX_ROLES = 10
export const MAX_FIELDS = 300
/** A drawn signature is a small PNG; anything larger is refused. */
export const MAX_IMAGE_CHARS = 300_000
export const MAX_TEXT = 1000

const ID = /^[A-Za-z0-9_-]{1,40}$/
const IMAGE = /^data:image\/png;base64,[A-Za-z0-9+/]+=*$/
const DATE = /^\d{4}-\d{2}-\d{2}$/

export const isImageField = (t: SigningFieldType) => t === "signature" || t === "initials"

/** Problems with a template's fields, as `fields.<index>.<what>`. Empty when valid. */
export function fieldProblems(fields: readonly SigningField[], roles: number, pages: number): string[] {
  const p: string[] = []
  if (fields.length > MAX_FIELDS) p.push("fields.count")
  const ids = new Set<string>()
  fields.forEach((f, i) => {
    if (!ID.test(f.id) || ids.has(f.id)) p.push(`fields.${i}.id`)
    ids.add(f.id)
    if (!(SIGNING_FIELD_TYPES as readonly string[]).includes(f.type)) p.push(`fields.${i}.type`)
    if (!Number.isInteger(f.role) || f.role < 0 || f.role >= roles) p.push(`fields.${i}.role`)
    if (!Number.isInteger(f.page) || f.page < 0 || f.page >= pages) p.push(`fields.${i}.page`)
    const inside = [f.x, f.y, f.w, f.h].every((n) => Number.isFinite(n) && n >= 0 && n <= 1) && f.w > 0.005 && f.h > 0.005 && f.x + f.w <= 1.0001 && f.y + f.h <= 1.0001
    if (!inside) p.push(`fields.${i}.box`)
    if (f.label.length > 100) p.push(`fields.${i}.label`)
  })
  return p
}

/** Fields of one role whose value is missing or malformed, by field ID. */
export function valueProblems(fields: readonly SigningField[], role: number, values: Record<string, SigningValue>): string[] {
  const bad: string[] = []
  for (const f of fields) {
    if (f.role !== role) continue
    const v = values[f.id]
    const empty = v === undefined || v === "" || v === false
    if (empty) {
      if (f.required) bad.push(f.id)
      continue
    }
    if (f.type === "checkbox") {
      if (typeof v !== "boolean") bad.push(f.id)
    } else if (typeof v !== "string") bad.push(f.id)
    else if (isImageField(f.type)) {
      if (v.length > MAX_IMAGE_CHARS || !IMAGE.test(v)) bad.push(f.id)
    } else if (f.type === "date") {
      if (!DATE.test(v)) bad.push(f.id)
    } else if (f.type === "email") {
      if (v.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) bad.push(f.id)
    } else if (v.length > MAX_TEXT) bad.push(f.id)
  }
  // Values for fields of other roles, or unknown fields, are refused.
  const mine = new Set(fields.filter((f) => f.role === role).map((f) => f.id))
  for (const k of Object.keys(values)) if (!mine.has(k)) bad.push(k)
  return bad
}

export const SUBMISSION_STATUSES = ["pending", "completed", "declined", "cancelled", "expired"] as const
export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number]
export const SUBMITTER_STATUSES = ["waiting", "pending", "opened", "completed", "declined"] as const
/** `waiting`: an earlier signer goes first (ordered signing). */
export type SubmitterStatus = (typeof SUBMITTER_STATUSES)[number]
