// The CRM module's Convex functions, bound to an app's system:
//
//   // convex/crm.ts
//   export const { getCrmSchema, listRecords, … } = defineCrm(system, { blueprint: standardBlueprint("lt") })
//
// Every public function guards itself first (permission, module enabled, role
// view) in the same transaction as the change, then checks the object, writes
// and audits. Functions accept `apiKey` so agents can act with their own roles.
import { internalMutationGeneric, mutationGeneric, queryGeneric } from "convex/server"
import { v, type GenericId } from "convex/values"
import { isFeatureEnabled, recordAudit, SystemError, toConvexError, type Actor, type ConvexSystem } from "@digimuza/system-core/convex"
import { standardBlueprint, type BlueprintObject, type CrmBlueprint } from "./blueprint"
import {
  cleanSettings,
  compareValues,
  isEmptyValue,
  isValidKey,
  keyFromLabel,
  matchesFilter,
  normalizeValue,
  SEARCHABLE_TYPES,
  settingsProblems,
  valueToText,
  type FieldDefinition,
  type FieldSettings,
  type FieldType,
  type FieldValue,
  type ViewFilter,
  type ViewSort,
} from "./fields"
import { CrmFlags, CrmPermissions } from "./manifest"
import { fieldTypeValidator, viewFilterValidator, viewKindValidator, viewSortValidator } from "./tables"

// ---------------------------------------------------------------- public shapes

export type CrmObjectId = GenericId<"crmObjects">
export type CrmFieldId = GenericId<"crmFields">
export type CrmViewId = GenericId<"crmViews">
export type CrmRecordId = GenericId<"crmRecords">
export type CrmNoteId = GenericId<"crmNotes">

export interface CrmFieldView extends FieldDefinition {
  id: CrmFieldId
  isStandard: boolean
  archived: boolean
  position: number
}

export interface CrmViewView {
  id: CrmViewId
  name: string
  kind: "table" | "kanban"
  columns: string[]
  groupBy: string | null
  sort: ViewSort | null
  filters: ViewFilter[]
}

export interface CrmObjectView {
  id: CrmObjectId
  key: string
  nameSingular: string
  namePlural: string
  description: string | null
  icon: string
  labelFieldKey: string
  isStandard: boolean
  archived: boolean
  /** Ordered by position. Archived fields only with `includeArchived`. */
  fields: CrmFieldView[]
  views: CrmViewView[]
}

export interface CrmRecordView {
  id: CrmRecordId
  objectKey: string
  label: string
  values: Record<string, FieldValue>
  createdAt: number
  updatedAt: number
  archived: boolean
}

export interface CrmListResult {
  records: CrmRecordView[]
  /** Labels of records referenced by relation fields, by record ID. */
  relationLabels: Record<string, { label: string; objectKey: string }>
  /** Matches after filters, before `limit`. */
  total: number
  /** The scan stopped at the module's limit: filters ran on the newest rows only. */
  truncated: boolean
}

export interface CrmRelatedGroup {
  objectKey: string
  fieldKey: string
  label: string
  records: { id: CrmRecordId; label: string }[]
}

export interface CrmNoteView {
  id: CrmNoteId
  body: string
  authorName: string
  mine: boolean
  createdAt: number
}

export interface CrmRecordDetail {
  record: CrmRecordView
  relationLabels: CrmListResult["relationLabels"]
  related: CrmRelatedGroup[]
  notes: CrmNoteView[]
}

export interface CrmOptions {
  /** The data model `applyBlueprint` installs. Default: `standardBlueprint("lt")`. */
  blueprint?: CrmBlueprint
  /** Rows a list query reads before filtering (newest first). Default 2000, max 8000. */
  scanLimit?: number
}

// ---------------------------------------------------------------- documents

interface ObjectDoc {
  _id: CrmObjectId
  _creationTime: number
  key: string
  nameSingular: string
  namePlural: string
  description?: string
  icon: string
  labelFieldKey: string
  isStandard: boolean
  archived: boolean
  position: number
}
interface FieldDoc {
  _id: CrmFieldId
  objectId: CrmObjectId
  key: string
  label: string
  description?: string
  type: FieldType
  settings: FieldSettings
  required: boolean
  isStandard: boolean
  archived: boolean
  position: number
}
interface ViewDoc {
  _id: CrmViewId
  objectId: CrmObjectId
  name: string
  kind: "table" | "kanban"
  columns: string[]
  groupBy?: string
  sort?: ViewSort
  filters: ViewFilter[]
  position: number
}
interface RecordDoc {
  _id: CrmRecordId
  _creationTime: number
  objectId: CrmObjectId
  values: Record<string, FieldValue>
  label: string
  searchText: string
  archived: boolean
  createdBy: string
  updatedBy: string
  updatedAt: number
}
interface LinkDoc {
  _id: GenericId<"crmLinks">
  fromRecordId: CrmRecordId
  fromObjectId: CrmObjectId
  fieldKey: string
  toRecordId: CrmRecordId
}
interface NoteDoc {
  _id: CrmNoteId
  _creationTime: number
  recordId: CrmRecordId
  body: string
  createdBy: string
  authorName: string
}

type Docs = { crmObjects: ObjectDoc; crmFields: FieldDoc; crmViews: ViewDoc; crmRecords: RecordDoc; crmLinks: LinkDoc; crmNotes: NoteDoc }
type Table = keyof Docs

interface Range {
  eq(field: string, value: unknown): Range
}
interface Q<D> {
  withIndex(name: string, range?: (q: Range) => Range): Q<D>
  withSearchIndex(name: string, search: (q: { search(field: string, text: string): Range }) => unknown): Q<D>
  order(o: "asc" | "desc"): Q<D>
  take(n: number): Promise<D[]>
  collect(): Promise<D[]>
  first(): Promise<D | null>
  unique(): Promise<D | null>
}
/** A loosely typed db handle: the app's schema contains `crmTables`. */
interface Db {
  query<T extends Table>(t: T): Q<Docs[T]>
  get<T extends Table>(t: T, id: string): Promise<Docs[T] | null>
  insert<T extends Table>(t: T, doc: Omit<Docs[T], "_id" | "_creationTime">): Promise<Docs[T]["_id"]>
  patch<T extends Table>(t: T, id: string, doc: Partial<Omit<Docs[T], "_id" | "_creationTime">>): Promise<void>
  delete(t: Table, id: string): Promise<void>
}
const dbOf = (ctx: { db: unknown }) => ctx.db as Db

// ---------------------------------------------------------------- helpers

type Code = "NOT_FOUND" | "CONFLICT" | "VALIDATION" | "FORBIDDEN"
function fail(code: Code, reason: string, operationId: string, fields?: string[]): never {
  throw toConvexError(new SystemError(code, undefined, { reason, operationId, ...(fields ? { fields } : {}) }), operationId)
}

const actorId = (a: Actor) => (a.kind === "user" ? a.userId : a.apiKeyId)
const actorArgs = { apiKey: v.optional(v.string()), operationId: v.optional(v.string()) }
const opts = (a: { apiKey?: string | undefined; operationId?: string | undefined }) => ({ apiKey: a.apiKey, operationId: a.operationId })

const ICON = /^[a-z0-9-]{1,40}$/
const MAX_FIELDS = 200
const MAX_VIEWS = 50
const MAX_NOTE = 20_000
const MAX_SEARCH_TEXT = 4000

const definition = (f: FieldDoc): FieldDefinition => ({
  key: f.key,
  label: f.label,
  type: f.type,
  settings: f.settings ?? {},
  required: f.required,
  ...(f.description ? { description: f.description } : {}),
})

const fieldView = (f: FieldDoc): CrmFieldView => ({ ...definition(f), id: f._id, isStandard: f.isStandard, archived: f.archived, position: f.position })
const viewView = (w: ViewDoc): CrmViewView => ({
  id: w._id,
  name: w.name,
  kind: w.kind,
  columns: w.columns,
  groupBy: w.groupBy ?? null,
  sort: w.sort ?? null,
  filters: w.filters,
})
const recordView = (r: RecordDoc, objectKey: string): CrmRecordView => ({
  id: r._id,
  objectKey,
  label: r.label,
  values: r.values,
  createdAt: r._creationTime,
  updatedAt: r.updatedAt,
  archived: r.archived,
})

function cleanText(value: string | undefined, max: number, field: string, operationId: string, required = true): string | undefined {
  const s = value?.trim() ?? ""
  if (!s) {
    if (required) fail("VALIDATION", `missing_${field}`, operationId, [field])
    return undefined
  }
  if (s.length > max) fail("VALIDATION", `too_long_${field}`, operationId, [field])
  return s
}

async function fieldsOf(db: Db, objectId: CrmObjectId, includeArchived = false): Promise<FieldDoc[]> {
  const all = await db
    .query("crmFields")
    .withIndex("by_object_key", (q) => q.eq("objectId", objectId))
    .collect()
  return all.filter((f) => includeArchived || !f.archived).sort((a, b) => a.position - b.position)
}

async function viewsOf(db: Db, objectId: CrmObjectId): Promise<ViewDoc[]> {
  return db
    .query("crmViews")
    .withIndex("by_object", (q) => q.eq("objectId", objectId))
    .collect()
}

async function objectByKey(db: Db, key: string): Promise<ObjectDoc | null> {
  return db
    .query("crmObjects")
    .withIndex("by_key", (q) => q.eq("key", key))
    .unique()
}

function derived(object: ObjectDoc, fields: FieldDoc[], values: Record<string, FieldValue>) {
  const labelField = fields.find((f) => f.key === object.labelFieldKey)
  const label = labelField ? valueToText(definition(labelField), values[labelField.key]) : ""
  const searchText = fields
    .filter((f) => SEARCHABLE_TYPES.has(f.type))
    .map((f) => valueToText(definition(f), values[f.key]))
    .filter(Boolean)
    .join(" ")
    .slice(0, MAX_SEARCH_TEXT)
  return { label, searchText }
}

/** Labels for every record referenced by a relation field of `records`. */
async function relationLabels(db: Db, fields: FieldDoc[], records: { values: Record<string, FieldValue> }[]) {
  const rel = fields.filter((f) => f.type === "relation")
  const ids = new Set<string>()
  for (const r of records) for (const f of rel) if (typeof r.values[f.key] === "string") ids.add(r.values[f.key] as string)
  const out: CrmListResult["relationLabels"] = {}
  const objectKeys = new Map<string, string>()
  for (const id of ids) {
    const target = await db.get("crmRecords", id)
    if (!target || target.archived) continue
    let key = objectKeys.get(target.objectId)
    if (!key) {
      key = (await db.get("crmObjects", target.objectId))?.key ?? ""
      objectKeys.set(target.objectId, key)
    }
    out[id] = { label: target.label, objectKey: key }
  }
  return out
}

async function displayName(sys: { store: { get(t: "users" | "apiKeys", k: string): Promise<unknown> } }, actor: Actor): Promise<string> {
  if (actor.kind === "agent") {
    const key = (await sys.store.get("apiKeys", actor.apiKeyId)) as { name?: string } | null
    return key?.name ? `API: ${key.name}` : "API"
  }
  const user = (await sys.store.get("users", actor.userId)) as { displayName?: string; email?: string } | null
  return user?.displayName || user?.email || "?"
}

// ---------------------------------------------------------------- the module

/** The CRM module's Convex functions. Re-export them from the app's `convex/crm.ts`. */
export function defineCrm(system: ConvexSystem, options: CrmOptions = {}) {
  const blueprint = options.blueprint ?? standardBlueprint("lt")
  const scanLimit = Math.min(Math.max(options.scanLimit ?? 2000, 100), 8000)
  const problems = blueprintProblems(blueprint)
  if (problems.length) throw new Error(`defineCrm: invalid blueprint:\n  - ${problems.join("\n  - ")}`)

  /** Validates `input` against the object's fields and returns the full stored values. */
  async function buildValues(
    db: Db,
    operationId: string,
    fields: FieldDoc[],
    current: Record<string, FieldValue>,
    input: Record<string, unknown>,
    isCreate: boolean,
  ): Promise<{ values: Record<string, FieldValue>; changed: string[] }> {
    const byKey = new Map(fields.map((f) => [f.key, f]))
    const values: Record<string, FieldValue> = { ...current }
    const changed: string[] = []
    const invalid: string[] = []
    for (const [key, raw] of Object.entries(input)) {
      const field = byKey.get(key)
      if (!field) {
        invalid.push(key)
        continue
      }
      const res = normalizeValue(definition(field), raw)
      if (!res.ok) {
        invalid.push(key)
        continue
      }
      if (field.type === "relation" && res.value !== undefined) {
        const target = await db.get("crmRecords", res.value as string).catch(() => null)
        const targetObject = target ? await db.get("crmObjects", target.objectId) : null
        if (!target || target.archived || targetObject?.key !== field.settings.objectKey) {
          invalid.push(key)
          continue
        }
      }
      if (res.value === undefined) delete values[key]
      else values[key] = res.value
      changed.push(key)
    }
    if (invalid.length) fail("VALIDATION", "invalid_values", operationId, invalid)
    const missing = fields.filter((f) => f.required && isEmptyValue(values[f.key]) && (isCreate || changed.includes(f.key))).map((f) => f.key)
    if (missing.length) fail("VALIDATION", "required_values", operationId, missing)
    return { values, changed }
  }

  async function syncLinks(db: Db, record: { _id: CrmRecordId; objectId: CrmObjectId }, fields: FieldDoc[], values: Record<string, FieldValue>, keys: string[]) {
    for (const f of fields) {
      if (f.type !== "relation" || !keys.includes(f.key)) continue
      const existing = await db
        .query("crmLinks")
        .withIndex("by_from", (q) => q.eq("fromRecordId", record._id).eq("fieldKey", f.key))
        .collect()
      for (const l of existing) await db.delete("crmLinks", l._id)
      const to = values[f.key]
      if (typeof to === "string") await db.insert("crmLinks", { fromRecordId: record._id, fromObjectId: record.objectId, fieldKey: f.key, toRecordId: to as CrmRecordId })
    }
  }

  async function recomputeRecords(db: Db, object: ObjectDoc) {
    const fields = await fieldsOf(db, object._id)
    for (const archived of [false, true]) {
      const rows = await db
        .query("crmRecords")
        .withIndex("by_object", (q) => q.eq("objectId", object._id).eq("archived", archived))
        .take(scanLimit)
      for (const r of rows) {
        const d = derived(object, fields, r.values)
        if (d.label !== r.label || d.searchText !== r.searchText) await db.patch("crmRecords", r._id, d)
      }
    }
  }

  /** Installs missing objects, fields and (for new objects) views. Never changes or removes existing ones. */
  async function install(db: Db): Promise<{ objectsCreated: string[]; fieldsCreated: string[] }> {
    const objectsCreated: string[] = []
    const fieldsCreated: string[] = []
    const allObjects = await db.query("crmObjects").collect()
    let objectPos = allObjects.reduce((m, o) => Math.max(m, o.position), -1)
    for (const bo of blueprint.objects) {
      let object = await objectByKey(db, bo.key)
      const isNew = !object
      if (!object) {
        const id = await db.insert("crmObjects", {
          key: bo.key,
          nameSingular: bo.nameSingular,
          namePlural: bo.namePlural,
          ...(bo.description ? { description: bo.description } : {}),
          icon: bo.icon,
          labelFieldKey: bo.labelFieldKey,
          isStandard: true,
          archived: false,
          position: ++objectPos,
        })
        object = (await db.get("crmObjects", id))!
        objectsCreated.push(bo.key)
      }
      const existing = await fieldsOf(db, object._id, true)
      let fieldPos = existing.reduce((m, f) => Math.max(m, f.position), -1)
      for (const bf of bo.fields) {
        if (existing.some((f) => f.key === bf.key)) continue
        await db.insert("crmFields", {
          objectId: object._id,
          key: bf.key,
          label: bf.label,
          ...(bf.description ? { description: bf.description } : {}),
          type: bf.type,
          settings: cleanSettings(bf.type, bf.settings ?? {}),
          required: bf.required ?? false,
          isStandard: true,
          archived: false,
          position: ++fieldPos,
        })
        fieldsCreated.push(`${bo.key}.${bf.key}`)
      }
      if (isNew) {
        const views = bo.views?.length ? bo.views : [{ name: bo.namePlural, kind: "table" as const }]
        let i = 0
        for (const bv of views) {
          await db.insert("crmViews", {
            objectId: object._id,
            name: bv.name,
            kind: bv.kind,
            columns: bv.columns ?? bo.fields.map((f) => f.key),
            ...(bv.groupBy ? { groupBy: bv.groupBy } : {}),
            ...(bv.sort ? { sort: bv.sort } : {}),
            filters: bv.filters ?? [],
            position: i++,
          })
        }
      }
    }
    return { objectsCreated, fieldsCreated }
  }

  async function requireObject(db: Db, id: string, operationId: string): Promise<ObjectDoc> {
    const o = await db.get("crmObjects", id).catch(() => null)
    if (!o) fail("NOT_FOUND", "object_not_found", operationId)
    return o!
  }

  async function activeObjectByKey(db: Db, key: string, operationId: string): Promise<ObjectDoc> {
    const o = await objectByKey(db, key)
    if (!o || o.archived) fail("NOT_FOUND", "object_not_found", operationId)
    return o!
  }

  async function requireRecord(db: Db, id: string, operationId: string): Promise<RecordDoc> {
    const r = await db.get("crmRecords", id).catch(() => null)
    if (!r) fail("NOT_FOUND", "record_not_found", operationId)
    return r!
  }

  async function checkView(db: Db, sys: Parameters<typeof isFeatureEnabled>[0], operationId: string, object: ObjectDoc, w: { kind: "table" | "kanban"; columns: string[]; groupBy?: string | undefined; sort?: ViewSort | undefined; filters: ViewFilter[] }) {
    const fields = await fieldsOf(db, object._id)
    const keys = new Set(fields.map((f) => f.key))
    const bad: string[] = []
    if (w.columns.length === 0 || w.columns.length > MAX_FIELDS || w.columns.some((c) => !keys.has(c))) bad.push("columns")
    if (w.sort && !keys.has(w.sort.fieldKey)) bad.push("sort")
    if (w.filters.length > 20 || w.filters.some((f) => !keys.has(f.fieldKey))) bad.push("filters")
    if (w.kind === "kanban") {
      if (!(await isFeatureEnabled(sys, CrmFlags.kanban))) fail("FORBIDDEN", "flag_off", operationId)
      const g = fields.find((f) => f.key === w.groupBy)
      if (!g || g.type !== "select") bad.push("groupBy")
    }
    if (bad.length) fail("VALIDATION", "invalid_view", operationId, bad)
  }

  /** Records of one object after filters, search and sort. */
  async function queryRecords(db: Db, object: ObjectDoc, fields: FieldDoc[], a: { search?: string | undefined; filters?: ViewFilter[] | undefined; sort?: ViewSort | undefined; archived?: boolean | undefined }) {
    const archived = a.archived ?? false
    const search = a.search?.trim()
    const rows = search
      ? await db
          .query("crmRecords")
          .withSearchIndex("search", (q) => q.search("searchText", search).eq("objectId", object._id).eq("archived", archived))
          .take(Math.min(scanLimit, 1024))
      : await db
          .query("crmRecords")
          .withIndex("by_object", (q) => q.eq("objectId", object._id).eq("archived", archived))
          .order("desc")
          .take(scanLimit)
    const byKey = new Map(fields.map((f) => [f.key, definition(f)]))
    let out = rows
    for (const filter of a.filters ?? []) {
      const field = byKey.get(filter.fieldKey)
      if (field) out = out.filter((r) => matchesFilter(field, r.values[field.key], filter))
    }
    const sortField = a.sort && byKey.get(a.sort.fieldKey)
    if (sortField && a.sort) out = [...out].sort((x, y) => compareValues(sortField, x.values[sortField.key], y.values[sortField.key], a.sort!.direction))
    return { rows: out, truncated: rows.length >= (search ? Math.min(scanLimit, 1024) : scanLimit) }
  }

  return {
    // ------------------------------------------------------------ metadata

    /** Every object with its fields and views: what UIs and agents render from. */
    getCrmSchema: queryGeneric({
      args: { ...actorArgs, includeArchived: v.optional(v.boolean()) },
      handler: async (ctx, a): Promise<{ objects: CrmObjectView[] }> => {
        await system.requirePermission(ctx, CrmPermissions.read, opts(a))
        const db = dbOf(ctx)
        const objects = (await db.query("crmObjects").collect()).filter((o) => a.includeArchived || !o.archived).sort((x, y) => x.position - y.position)
        const out: CrmObjectView[] = []
        for (const o of objects) {
          const fields = await fieldsOf(db, o._id, a.includeArchived)
          const views = (await viewsOf(db, o._id)).sort((x, y) => x.position - y.position)
          out.push({
            id: o._id,
            key: o.key,
            nameSingular: o.nameSingular,
            namePlural: o.namePlural,
            description: o.description ?? null,
            icon: o.icon,
            labelFieldKey: o.labelFieldKey,
            isStandard: o.isStandard,
            archived: o.archived,
            fields: fields.map(fieldView),
            views: views.map(viewView),
          })
        }
        return { objects: out }
      },
    }),

    /** Installs the app's configured blueprint (missing parts only). */
    applyBlueprint: mutationGeneric({
      args: { ...actorArgs },
      handler: async (ctx, a) => {
        const { sys, actor } = await system.requirePermission(ctx, CrmPermissions.manageSchema, opts(a))
        const res = await install(dbOf(ctx))
        await recordAudit(sys, actor, { action: "crm.blueprint.apply", targetType: "crm", targetId: "blueprint", changes: { objects: res.objectsCreated.length, fields: res.fieldsCreated.length } })
        return { ...res, operationId: sys.operationId }
      },
    }),

    /** Deploy hook (`convex run crm:_applyBlueprint`): same as applyBlueprint, run by the system. */
    _applyBlueprint: internalMutationGeneric({
      args: {},
      handler: async (ctx) => install(dbOf(ctx)),
    }),

    createObject: mutationGeneric({
      args: {
        ...actorArgs,
        key: v.optional(v.string()),
        nameSingular: v.string(),
        namePlural: v.string(),
        description: v.optional(v.string()),
        icon: v.optional(v.string()),
      },
      handler: async (ctx, a): Promise<{ objectId: CrmObjectId; key: string; operationId: string }> => {
        const { sys, actor } = await system.requirePermission(ctx, CrmPermissions.manageSchema, opts(a))
        const op = sys.operationId
        if (!(await isFeatureEnabled(sys, CrmFlags.customObjects))) fail("FORBIDDEN", "flag_off", op)
        const db = dbOf(ctx)
        const nameSingular = cleanText(a.nameSingular, 80, "nameSingular", op)!
        const namePlural = cleanText(a.namePlural, 80, "namePlural", op)!
        const description = cleanText(a.description, 500, "description", op, false)
        const key = a.key?.trim() || keyFromLabel(nameSingular)
        if (!isValidKey(key)) fail("VALIDATION", "invalid_key", op, ["key"])
        const icon = a.icon ?? "box"
        if (!ICON.test(icon)) fail("VALIDATION", "invalid_icon", op, ["icon"])
        if (await objectByKey(db, key)) fail("CONFLICT", "object_key_taken", op, ["key"])
        const all = await db.query("crmObjects").collect()
        const objectId = await db.insert("crmObjects", {
          key,
          nameSingular,
          namePlural,
          ...(description ? { description } : {}),
          icon,
          labelFieldKey: "name",
          isStandard: false,
          archived: false,
          position: all.reduce((m, o) => Math.max(m, o.position), -1) + 1,
        })
        // Every object gets a title field, so records always have a label.
        await db.insert("crmFields", { objectId, key: "name", label: nameSingular, type: "text", settings: {}, required: true, isStandard: false, archived: false, position: 0 })
        await db.insert("crmViews", { objectId, name: namePlural, kind: "table", columns: ["name"], filters: [], position: 0 })
        await recordAudit(sys, actor, { action: "crm.object.create", targetType: "crmObject", targetId: objectId, changes: { key } })
        return { objectId, key, operationId: op }
      },
    }),

    updateObject: mutationGeneric({
      args: {
        ...actorArgs,
        objectId: v.id("crmObjects"),
        nameSingular: v.optional(v.string()),
        namePlural: v.optional(v.string()),
        description: v.optional(v.string()),
        icon: v.optional(v.string()),
        labelFieldKey: v.optional(v.string()),
      },
      handler: async (ctx, a): Promise<{ operationId: string }> => {
        const { sys, actor } = await system.requirePermission(ctx, CrmPermissions.manageSchema, opts(a))
        const op = sys.operationId
        const db = dbOf(ctx)
        const object = await requireObject(db, a.objectId, op)
        const patch: Partial<ObjectDoc> = {}
        if (a.nameSingular !== undefined) patch.nameSingular = cleanText(a.nameSingular, 80, "nameSingular", op)!
        if (a.namePlural !== undefined) patch.namePlural = cleanText(a.namePlural, 80, "namePlural", op)!
        if (a.description !== undefined) patch.description = cleanText(a.description, 500, "description", op, false) ?? ""
        if (a.icon !== undefined) {
          if (!ICON.test(a.icon)) fail("VALIDATION", "invalid_icon", op, ["icon"])
          patch.icon = a.icon
        }
        if (a.labelFieldKey !== undefined && a.labelFieldKey !== object.labelFieldKey) {
          const f = (await fieldsOf(db, object._id)).find((x) => x.key === a.labelFieldKey)
          if (!f || !["text", "email", "phone", "url"].includes(f.type)) fail("VALIDATION", "invalid_label_field", op, ["labelFieldKey"])
          patch.labelFieldKey = a.labelFieldKey
        }
        await db.patch("crmObjects", object._id, patch)
        if (patch.labelFieldKey) await recomputeRecords(db, { ...object, ...patch })
        await recordAudit(sys, actor, { action: "crm.object.update", targetType: "crmObject", targetId: object._id, changes: { fields: Object.keys(patch) } })
        return { operationId: op }
      },
    }),

    /** Hides an object and its records everywhere. Data stays; restoring brings it back. */
    setObjectArchived: mutationGeneric({
      args: { ...actorArgs, objectId: v.id("crmObjects"), archived: v.boolean() },
      handler: async (ctx, a): Promise<{ operationId: string }> => {
        const { sys, actor } = await system.requirePermission(ctx, CrmPermissions.manageSchema, opts(a))
        const db = dbOf(ctx)
        const object = await requireObject(db, a.objectId, sys.operationId)
        await db.patch("crmObjects", object._id, { archived: a.archived })
        await recordAudit(sys, actor, { action: a.archived ? "crm.object.archive" : "crm.object.restore", targetType: "crmObject", targetId: object._id })
        return { operationId: sys.operationId }
      },
    }),

    reorderObjects: mutationGeneric({
      args: { ...actorArgs, objectIds: v.array(v.id("crmObjects")) },
      handler: async (ctx, a): Promise<{ operationId: string }> => {
        const { sys, actor } = await system.requirePermission(ctx, CrmPermissions.manageSchema, opts(a))
        const db = dbOf(ctx)
        for (const [i, id] of a.objectIds.entries()) {
          await requireObject(db, id, sys.operationId)
          await db.patch("crmObjects", id, { position: i })
        }
        await recordAudit(sys, actor, { action: "crm.object.reorder", targetType: "crm", targetId: "objects" })
        return { operationId: sys.operationId }
      },
    }),

    createField: mutationGeneric({
      args: {
        ...actorArgs,
        objectId: v.id("crmObjects"),
        key: v.optional(v.string()),
        label: v.string(),
        type: fieldTypeValidator,
        settings: v.optional(v.any()),
        required: v.optional(v.boolean()),
        description: v.optional(v.string()),
      },
      handler: async (ctx, a): Promise<{ fieldId: CrmFieldId; key: string; operationId: string }> => {
        const { sys, actor } = await system.requirePermission(ctx, CrmPermissions.manageSchema, opts(a))
        const op = sys.operationId
        if (!(await isFeatureEnabled(sys, CrmFlags.customFields))) fail("FORBIDDEN", "flag_off", op)
        const db = dbOf(ctx)
        const object = await requireObject(db, a.objectId, op)
        const label = cleanText(a.label, 80, "label", op)!
        const description = cleanText(a.description, 500, "description", op, false)
        const key = a.key?.trim() || keyFromLabel(label)
        if (!isValidKey(key)) fail("VALIDATION", "invalid_key", op, ["key"])
        const existing = await fieldsOf(db, object._id, true)
        if (existing.some((f) => f.key === key)) fail("CONFLICT", "field_key_taken", op, ["key"])
        if (existing.length >= MAX_FIELDS) fail("VALIDATION", "too_many_fields", op)
        const settings = cleanSettings(a.type, (a.settings ?? {}) as FieldSettings)
        const problems = settingsProblems(a.type, settings)
        if (problems.length) fail("VALIDATION", "invalid_settings", op, problems)
        if (a.type === "relation") {
          const target = await objectByKey(db, settings.objectKey!)
          if (!target) fail("VALIDATION", "invalid_settings", op, ["objectKey"])
        }
        const fieldId = await db.insert("crmFields", {
          objectId: object._id,
          key,
          label,
          ...(description ? { description } : {}),
          type: a.type,
          settings,
          // A new required field would make every existing record invalid on its next edit of that field only.
          required: a.required ?? false,
          isStandard: false,
          archived: false,
          position: existing.reduce((m, f) => Math.max(m, f.position), -1) + 1,
        })
        await recordAudit(sys, actor, { action: "crm.field.create", targetType: "crmField", targetId: fieldId, changes: { object: object.key, key, type: a.type } })
        return { fieldId, key, operationId: op }
      },
    }),

    /** Label, description, settings and required. Key and type never change: stored values depend on them. */
    updateField: mutationGeneric({
      args: {
        ...actorArgs,
        fieldId: v.id("crmFields"),
        label: v.optional(v.string()),
        description: v.optional(v.string()),
        settings: v.optional(v.any()),
        required: v.optional(v.boolean()),
      },
      handler: async (ctx, a): Promise<{ operationId: string }> => {
        const { sys, actor } = await system.requirePermission(ctx, CrmPermissions.manageSchema, opts(a))
        const op = sys.operationId
        const db = dbOf(ctx)
        const field = await db.get("crmFields", a.fieldId)
        if (!field) fail("NOT_FOUND", "field_not_found", op)
        const patch: Partial<FieldDoc> = {}
        if (a.label !== undefined) patch.label = cleanText(a.label, 80, "label", op)!
        if (a.description !== undefined) patch.description = cleanText(a.description, 500, "description", op, false) ?? ""
        if (a.required !== undefined) patch.required = a.required
        if (a.settings !== undefined) {
          const settings = cleanSettings(field!.type, a.settings as FieldSettings)
          // The relation target is part of what stored values mean.
          if (field!.type === "relation" && settings.objectKey !== field!.settings.objectKey) fail("VALIDATION", "relation_target_fixed", op, ["objectKey"])
          const problems = settingsProblems(field!.type, settings)
          if (problems.length) fail("VALIDATION", "invalid_settings", op, problems)
          patch.settings = settings
        }
        await db.patch("crmFields", field!._id, patch)
        if (patch.settings && (field!.type === "select" || field!.type === "multiSelect")) {
          // Option labels are part of the search text.
          await recomputeRecords(db, await requireObject(db, field!.objectId, op))
        }
        await recordAudit(sys, actor, { action: "crm.field.update", targetType: "crmField", targetId: field!._id, changes: { fields: Object.keys(patch) } })
        return { operationId: op }
      },
    }),

    /** Archived fields disappear from forms, views and the API; their stored values are kept. */
    setFieldArchived: mutationGeneric({
      args: { ...actorArgs, fieldId: v.id("crmFields"), archived: v.boolean() },
      handler: async (ctx, a): Promise<{ operationId: string }> => {
        const { sys, actor } = await system.requirePermission(ctx, CrmPermissions.manageSchema, opts(a))
        const op = sys.operationId
        const db = dbOf(ctx)
        const field = await db.get("crmFields", a.fieldId)
        if (!field) fail("NOT_FOUND", "field_not_found", op)
        const object = await requireObject(db, field!.objectId, op)
        if (a.archived && object.labelFieldKey === field!.key) fail("CONFLICT", "label_field", op)
        await db.patch("crmFields", field!._id, { archived: a.archived })
        if (a.archived) {
          // Drop the field from views, so no view refers to something it can't show.
          for (const w of await viewsOf(db, object._id)) {
            const columns = w.columns.filter((c) => c !== field!.key)
            const filters = w.filters.filter((f) => f.fieldKey !== field!.key)
            const sortGone = w.sort?.fieldKey === field!.key
            const groupGone = w.groupBy === field!.key
            if (groupGone) {
              await db.patch("crmViews", w._id, { kind: "table", groupBy: undefined, columns: columns.length ? columns : [object.labelFieldKey], filters, ...(sortGone ? { sort: undefined } : {}) })
            } else if (columns.length !== w.columns.length || filters.length !== w.filters.length || sortGone) {
              await db.patch("crmViews", w._id, { columns: columns.length ? columns : [object.labelFieldKey], filters, ...(sortGone ? { sort: undefined } : {}) })
            }
          }
        }
        await recomputeRecords(db, object)
        await recordAudit(sys, actor, { action: a.archived ? "crm.field.archive" : "crm.field.restore", targetType: "crmField", targetId: field!._id })
        return { operationId: op }
      },
    }),

    reorderFields: mutationGeneric({
      args: { ...actorArgs, objectId: v.id("crmObjects"), fieldIds: v.array(v.id("crmFields")) },
      handler: async (ctx, a): Promise<{ operationId: string }> => {
        const { sys, actor } = await system.requirePermission(ctx, CrmPermissions.manageSchema, opts(a))
        const db = dbOf(ctx)
        await requireObject(db, a.objectId, sys.operationId)
        for (const [i, id] of a.fieldIds.entries()) {
          const f = await db.get("crmFields", id)
          if (!f || f.objectId !== a.objectId) fail("VALIDATION", "invalid_fields", sys.operationId, ["fieldIds"])
          await db.patch("crmFields", id, { position: i })
        }
        await recordAudit(sys, actor, { action: "crm.field.reorder", targetType: "crmObject", targetId: a.objectId })
        return { operationId: sys.operationId }
      },
    }),

    // ------------------------------------------------------------ views

    createView: mutationGeneric({
      args: {
        ...actorArgs,
        objectId: v.id("crmObjects"),
        name: v.string(),
        kind: viewKindValidator,
        columns: v.array(v.string()),
        groupBy: v.optional(v.string()),
        sort: v.optional(viewSortValidator),
        filters: v.optional(v.array(viewFilterValidator)),
      },
      handler: async (ctx, a): Promise<{ viewId: CrmViewId; operationId: string }> => {
        const { sys, actor } = await system.requirePermission(ctx, CrmPermissions.manageViews, opts(a))
        const op = sys.operationId
        const db = dbOf(ctx)
        const object = await requireObject(db, a.objectId, op)
        const name = cleanText(a.name, 80, "name", op)!
        const filters = (a.filters ?? []) as ViewFilter[]
        await checkView(db, sys, op, object, { kind: a.kind, columns: a.columns, groupBy: a.groupBy, sort: a.sort, filters })
        const views = await viewsOf(db, object._id)
        if (views.length >= MAX_VIEWS) fail("VALIDATION", "too_many_views", op)
        const viewId = await db.insert("crmViews", {
          objectId: object._id,
          name,
          kind: a.kind,
          columns: a.columns,
          ...(a.kind === "kanban" && a.groupBy ? { groupBy: a.groupBy } : {}),
          ...(a.sort ? { sort: a.sort } : {}),
          filters,
          position: views.reduce((m, w) => Math.max(m, w.position), -1) + 1,
        })
        await recordAudit(sys, actor, { action: "crm.view.create", targetType: "crmView", targetId: viewId, changes: { object: object.key } })
        return { viewId, operationId: op }
      },
    }),

    updateView: mutationGeneric({
      args: {
        ...actorArgs,
        viewId: v.id("crmViews"),
        name: v.optional(v.string()),
        columns: v.optional(v.array(v.string())),
        groupBy: v.optional(v.string()),
        sort: v.optional(v.union(viewSortValidator, v.null())),
        filters: v.optional(v.array(viewFilterValidator)),
      },
      handler: async (ctx, a): Promise<{ operationId: string }> => {
        const { sys, actor } = await system.requirePermission(ctx, CrmPermissions.manageViews, opts(a))
        const op = sys.operationId
        const db = dbOf(ctx)
        const view = await db.get("crmViews", a.viewId)
        if (!view) fail("NOT_FOUND", "view_not_found", op)
        const object = await requireObject(db, view!.objectId, op)
        const next = {
          kind: view!.kind,
          columns: a.columns ?? view!.columns,
          groupBy: a.groupBy ?? view!.groupBy,
          sort: a.sort === null ? undefined : (a.sort ?? view!.sort),
          filters: (a.filters ?? view!.filters) as ViewFilter[],
        }
        await checkView(db, sys, op, object, next)
        await db.patch("crmViews", view!._id, { ...next, ...(a.name !== undefined ? { name: cleanText(a.name, 80, "name", op)! } : {}) })
        await recordAudit(sys, actor, { action: "crm.view.update", targetType: "crmView", targetId: view!._id })
        return { operationId: op }
      },
    }),

    deleteView: mutationGeneric({
      args: { ...actorArgs, viewId: v.id("crmViews") },
      handler: async (ctx, a): Promise<{ operationId: string }> => {
        const { sys, actor } = await system.requirePermission(ctx, CrmPermissions.manageViews, opts(a))
        const db = dbOf(ctx)
        const view = await db.get("crmViews", a.viewId)
        if (!view) fail("NOT_FOUND", "view_not_found", sys.operationId)
        if ((await viewsOf(db, view!.objectId)).length <= 1) fail("CONFLICT", "last_view", sys.operationId)
        await db.delete("crmViews", view!._id)
        await recordAudit(sys, actor, { action: "crm.view.delete", targetType: "crmView", targetId: view!._id })
        return { operationId: sys.operationId }
      },
    }),

    // ------------------------------------------------------------ records

    /**
     * Records of one object. With `viewId`, the view's filters and sort apply
     * first; explicit `filters` are added and an explicit `sort` wins.
     */
    listRecords: queryGeneric({
      args: {
        ...actorArgs,
        objectKey: v.string(),
        viewId: v.optional(v.id("crmViews")),
        search: v.optional(v.string()),
        filters: v.optional(v.array(viewFilterValidator)),
        sort: v.optional(viewSortValidator),
        archived: v.optional(v.boolean()),
        limit: v.optional(v.number()),
      },
      handler: async (ctx, a): Promise<CrmListResult> => {
        const { sys } = await system.requirePermission(ctx, CrmPermissions.read, opts(a))
        const db = dbOf(ctx)
        const object = await activeObjectByKey(db, a.objectKey, sys.operationId)
        const fields = await fieldsOf(db, object._id)
        let filters = (a.filters ?? []) as ViewFilter[]
        let sort = a.sort as ViewSort | undefined
        if (a.viewId) {
          const view = await db.get("crmViews", a.viewId)
          if (!view || view.objectId !== object._id) fail("NOT_FOUND", "view_not_found", sys.operationId)
          filters = [...view!.filters, ...filters]
          sort = sort ?? view!.sort
        }
        const limit = Math.min(Math.max(Math.floor(a.limit ?? 200), 1), 1000)
        const { rows, truncated } = await queryRecords(db, object, fields, { search: a.search, filters, sort, archived: a.archived })
        const page = rows.slice(0, limit)
        return {
          records: page.map((r) => recordView(r, object.key)),
          relationLabels: await relationLabels(db, fields, page),
          total: rows.length,
          truncated,
        }
      },
    }),

    /** Record search for relation pickers: label matches across one object. */
    searchRecords: queryGeneric({
      args: { ...actorArgs, objectKey: v.string(), search: v.optional(v.string()), limit: v.optional(v.number()) },
      handler: async (ctx, a): Promise<{ id: CrmRecordId; label: string }[]> => {
        const { sys } = await system.requirePermission(ctx, CrmPermissions.read, opts(a))
        const db = dbOf(ctx)
        const object = await activeObjectByKey(db, a.objectKey, sys.operationId)
        const limit = Math.min(Math.max(Math.floor(a.limit ?? 20), 1), 50)
        const search = a.search?.trim()
        const rows = search
          ? await db
              .query("crmRecords")
              .withSearchIndex("search", (q) => q.search("searchText", search).eq("objectId", object._id).eq("archived", false))
              .take(limit)
          : await db
              .query("crmRecords")
              .withIndex("by_object", (q) => q.eq("objectId", object._id).eq("archived", false))
              .order("desc")
              .take(limit)
        return rows.map((r) => ({ id: r._id, label: r.label }))
      },
    }),

    getRecord: queryGeneric({
      args: { ...actorArgs, recordId: v.id("crmRecords") },
      handler: async (ctx, a): Promise<CrmRecordDetail> => {
        const { sys, actor } = await system.requirePermission(ctx, CrmPermissions.read, opts(a))
        const db = dbOf(ctx)
        const record = await requireRecord(db, a.recordId, sys.operationId)
        const object = await requireObject(db, record.objectId, sys.operationId)
        if (object.archived) fail("NOT_FOUND", "record_not_found", sys.operationId)
        const fields = await fieldsOf(db, object._id)
        const links = await db
          .query("crmLinks")
          .withIndex("by_to", (q) => q.eq("toRecordId", record._id))
          .take(1000)
        const groups = new Map<string, CrmRelatedGroup>()
        const objectCache = new Map<string, ObjectDoc | null>()
        const fieldCache = new Map<string, FieldDoc | undefined>()
        for (const l of links) {
          const from = await db.get("crmRecords", l.fromRecordId)
          if (!from || from.archived) continue
          if (!objectCache.has(l.fromObjectId)) objectCache.set(l.fromObjectId, await db.get("crmObjects", l.fromObjectId))
          const fromObject = objectCache.get(l.fromObjectId)
          if (!fromObject || fromObject.archived) continue
          const fk = `${l.fromObjectId}:${l.fieldKey}`
          if (!fieldCache.has(fk)) fieldCache.set(fk, (await fieldsOf(db, fromObject._id)).find((f) => f.key === l.fieldKey))
          const field = fieldCache.get(fk)
          if (!field) continue
          const g = groups.get(fk) ?? { objectKey: fromObject.key, fieldKey: field.key, label: field.settings.inverseLabel || fromObject.namePlural, records: [] }
          g.records.push({ id: from._id, label: from.label })
          groups.set(fk, g)
        }
        const notes = await db
          .query("crmNotes")
          .withIndex("by_record", (q) => q.eq("recordId", record._id))
          .order("desc")
          .take(200)
        const me = actorId(actor)
        return {
          record: recordView(record, object.key),
          relationLabels: await relationLabels(db, fields, [record]),
          related: [...groups.values()],
          notes: notes.map((n) => ({ id: n._id, body: n.body, authorName: n.authorName, mine: n.createdBy === me, createdAt: n._creationTime })),
        }
      },
    }),

    createRecord: mutationGeneric({
      args: { ...actorArgs, objectKey: v.string(), values: v.record(v.string(), v.any()) },
      handler: async (ctx, a): Promise<{ recordId: CrmRecordId; operationId: string }> => {
        const { sys, actor } = await system.requirePermission(ctx, CrmPermissions.create, opts(a))
        const op = sys.operationId
        const db = dbOf(ctx)
        const object = await activeObjectByKey(db, a.objectKey, op)
        const fields = await fieldsOf(db, object._id)
        const { values } = await buildValues(db, op, fields, {}, a.values, true)
        const by = actorId(actor)
        const recordId = await db.insert("crmRecords", { objectId: object._id, values, ...derived(object, fields, values), archived: false, createdBy: by, updatedBy: by, updatedAt: Date.now() })
        await syncLinks(db, { _id: recordId, objectId: object._id }, fields, values, Object.keys(values))
        await recordAudit(sys, actor, { action: "crm.record.create", targetType: "crmRecord", targetId: recordId, changes: { object: object.key, fields: Object.keys(values) } })
        return { recordId, operationId: op }
      },
    }),

    /** Partial update: only the given keys change; `null` clears a value. */
    updateRecord: mutationGeneric({
      args: { ...actorArgs, recordId: v.id("crmRecords"), values: v.record(v.string(), v.any()) },
      handler: async (ctx, a): Promise<{ operationId: string }> => {
        const { sys, actor } = await system.requirePermission(ctx, CrmPermissions.update, opts(a))
        const op = sys.operationId
        const db = dbOf(ctx)
        const record = await requireRecord(db, a.recordId, op)
        if (record.archived) fail("CONFLICT", "record_archived", op)
        const object = await requireObject(db, record.objectId, op)
        if (object.archived) fail("NOT_FOUND", "record_not_found", op)
        const fields = await fieldsOf(db, object._id)
        const { values, changed } = await buildValues(db, op, fields, record.values, a.values, false)
        if (changed.length === 0) return { operationId: op }
        await db.patch("crmRecords", record._id, { values, ...derived(object, fields, values), updatedBy: actorId(actor), updatedAt: Date.now() })
        await syncLinks(db, record, fields, values, changed)
        await recordAudit(sys, actor, { action: "crm.record.update", targetType: "crmRecord", targetId: record._id, changes: { fields: changed } })
        return { operationId: op }
      },
    }),

    setRecordsArchived: mutationGeneric({
      args: { ...actorArgs, recordIds: v.array(v.id("crmRecords")), archived: v.boolean() },
      handler: async (ctx, a): Promise<{ count: number; operationId: string }> => {
        const { sys, actor } = await system.requirePermission(ctx, CrmPermissions.delete, opts(a))
        const op = sys.operationId
        if (a.recordIds.length === 0 || a.recordIds.length > 100) fail("VALIDATION", "invalid_count", op, ["recordIds"])
        const db = dbOf(ctx)
        for (const id of a.recordIds) {
          const r = await requireRecord(db, id, op)
          await db.patch("crmRecords", r._id, { archived: a.archived, updatedBy: actorId(actor), updatedAt: Date.now() })
          await recordAudit(sys, actor, { action: a.archived ? "crm.record.archive" : "crm.record.restore", targetType: "crmRecord", targetId: r._id })
        }
        return { count: a.recordIds.length, operationId: op }
      },
    }),

    // ------------------------------------------------------------ notes

    addNote: mutationGeneric({
      args: { ...actorArgs, recordId: v.id("crmRecords"), body: v.string() },
      handler: async (ctx, a): Promise<{ noteId: CrmNoteId; operationId: string }> => {
        const { sys, actor } = await system.requirePermission(ctx, CrmPermissions.note, opts(a))
        const op = sys.operationId
        const db = dbOf(ctx)
        const record = await requireRecord(db, a.recordId, op)
        if (record.archived) fail("CONFLICT", "record_archived", op)
        const body = cleanText(a.body, MAX_NOTE, "body", op)!
        const noteId = await db.insert("crmNotes", { recordId: record._id, body, createdBy: actorId(actor), authorName: await displayName(sys as never, actor) })
        await recordAudit(sys, actor, { action: "crm.note.create", targetType: "crmRecord", targetId: record._id })
        return { noteId, operationId: op }
      },
    }),

    /** Authors delete their own notes; `crm:record:delete` deletes anyone's. */
    deleteNote: mutationGeneric({
      args: { ...actorArgs, noteId: v.id("crmNotes") },
      handler: async (ctx, a): Promise<{ operationId: string }> => {
        const { sys, actor } = await system.requirePermission(ctx, CrmPermissions.note, opts(a))
        const op = sys.operationId
        const db = dbOf(ctx)
        const note = await db.get("crmNotes", a.noteId)
        if (!note) fail("NOT_FOUND", "note_not_found", op)
        if (note!.createdBy !== actorId(actor)) await system.requirePermission(ctx, CrmPermissions.delete, opts(a))
        await db.delete("crmNotes", note!._id)
        await recordAudit(sys, actor, { action: "crm.note.delete", targetType: "crmRecord", targetId: note!.recordId })
        return { operationId: op }
      },
    }),
  }
}

export type CrmFunctions = ReturnType<typeof defineCrm>

/** Problems with a blueprint's internal consistency. Empty when valid. */
export function blueprintProblems(bp: CrmBlueprint): string[] {
  const p: string[] = []
  const keys = new Set<string>()
  for (const o of bp.objects) p.push(...objectProblems(o, keys, bp))
  return p
}

function objectProblems(o: BlueprintObject, keys: Set<string>, bp: CrmBlueprint): string[] {
  const p: string[] = []
  if (!isValidKey(o.key)) p.push(`object key "${o.key}"`)
  if (keys.has(o.key)) p.push(`duplicate object "${o.key}"`)
  keys.add(o.key)
  if (!ICON.test(o.icon)) p.push(`${o.key}: icon "${o.icon}"`)
  const fieldKeys = new Set<string>()
  for (const f of o.fields) {
    if (!isValidKey(f.key)) p.push(`${o.key}.${f.key}: key`)
    if (fieldKeys.has(f.key)) p.push(`${o.key}.${f.key}: duplicate`)
    fieldKeys.add(f.key)
    for (const s of settingsProblems(f.type, cleanSettings(f.type, f.settings ?? {}))) p.push(`${o.key}.${f.key}: settings.${s}`)
    if (f.type === "relation" && !bp.objects.some((x) => x.key === f.settings?.objectKey)) p.push(`${o.key}.${f.key}: relation target "${f.settings?.objectKey}" is not in the blueprint`)
  }
  const label = o.fields.find((f) => f.key === o.labelFieldKey)
  if (!label || !["text", "email", "phone", "url"].includes(label.type)) p.push(`${o.key}: labelFieldKey "${o.labelFieldKey}" must be a text field`)
  for (const w of o.views ?? []) {
    if (w.columns?.some((c) => !fieldKeys.has(c))) p.push(`${o.key}: view "${w.name}" columns`)
    if (w.kind === "kanban" && o.fields.find((f) => f.key === w.groupBy)?.type !== "select") p.push(`${o.key}: view "${w.name}" groupBy must be a select field`)
  }
  return p
}
