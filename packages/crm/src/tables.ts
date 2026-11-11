import { defineTable } from "convex/server"
import { v } from "convex/values"
import { FIELD_TYPES, FILTER_OPERATORS } from "./fields"

const fieldType = v.union(...FIELD_TYPES.map((t) => v.literal(t)))
const operator = v.union(...FILTER_OPERATORS.map((o) => v.literal(o)))

export const viewSortValidator = v.object({ fieldKey: v.string(), direction: v.union(v.literal("asc"), v.literal("desc")) })
export const viewFilterValidator = v.object({ fieldKey: v.string(), operator, value: v.optional(v.any()) })
export const viewKindValidator = v.union(v.literal("table"), v.literal("kanban"))
export const fieldTypeValidator = fieldType

/**
 * Spread into the app schema next to `systemTables`. Metadata (objects,
 * fields, views) describes the data; records hold it as `values` keyed by
 * field key. Values are validated against the field definitions in code,
 * because the definitions change at runtime.
 */
export const crmTables = {
  crmObjects: defineTable({
    key: v.string(),
    nameSingular: v.string(),
    namePlural: v.string(),
    description: v.optional(v.string()),
    icon: v.string(),
    labelFieldKey: v.string(),
    /** From the blueprint: its key is part of the app's configuration. */
    isStandard: v.boolean(),
    archived: v.boolean(),
    position: v.number(),
  }).index("by_key", ["key"]),

  crmFields: defineTable({
    objectId: v.id("crmObjects"),
    key: v.string(),
    label: v.string(),
    description: v.optional(v.string()),
    type: fieldType,
    /** FieldSettings, checked by settingsProblems(). */
    settings: v.any(),
    required: v.boolean(),
    isStandard: v.boolean(),
    archived: v.boolean(),
    position: v.number(),
  }).index("by_object_key", ["objectId", "key"]),

  crmViews: defineTable({
    objectId: v.id("crmObjects"),
    name: v.string(),
    kind: viewKindValidator,
    columns: v.array(v.string()),
    groupBy: v.optional(v.string()),
    sort: v.optional(viewSortValidator),
    filters: v.array(viewFilterValidator),
    position: v.number(),
  }).index("by_object", ["objectId", "position"]),

  crmRecords: defineTable({
    objectId: v.id("crmObjects"),
    /** { [fieldKey]: value }, see FieldValue. */
    values: v.record(v.string(), v.any()),
    label: v.string(),
    searchText: v.string(),
    archived: v.boolean(),
    createdBy: v.string(),
    updatedBy: v.string(),
    updatedAt: v.number(),
  })
    .index("by_object", ["objectId", "archived"])
    .searchIndex("search", { searchField: "searchText", filterFields: ["objectId", "archived"] }),

  /** Reverse lookup for relation fields: which records point at `toRecordId`. */
  crmLinks: defineTable({
    fromRecordId: v.id("crmRecords"),
    fromObjectId: v.id("crmObjects"),
    fieldKey: v.string(),
    toRecordId: v.id("crmRecords"),
  })
    .index("by_from", ["fromRecordId", "fieldKey"])
    .index("by_to", ["toRecordId"]),

  crmNotes: defineTable({
    recordId: v.id("crmRecords"),
    body: v.string(),
    createdBy: v.string(),
    authorName: v.string(),
  }).index("by_record", ["recordId"]),
}
