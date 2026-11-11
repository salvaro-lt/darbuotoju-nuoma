// `@digimuza/crm`: a metadata-driven CRM business module for system-core apps.
//
//   // modules/index.ts
//   import { crm } from "@digimuza/crm"
//   export const appModules = [finance, crm]
//   // convex/schema.ts
//   export default defineSchema({ ...systemTables, ...crmTables })
//   // convex/crm.ts
//   export const { getCrmSchema, listRecords, … } = defineCrm(system, { blueprint: standardBlueprint("lt") })
//
// Admins shape the data model at runtime (objects, fields, select options,
// relations, views); the app shapes the starting model and the limits in code.
export { crm, CrmFlags, CrmPermissions } from "./manifest"
export { crmTables } from "./tables"
export { emptyBlueprint, extendBlueprint, standardBlueprint, type BlueprintField, type BlueprintObject, type BlueprintView, type CrmBlueprint } from "./blueprint"
export {
  blueprintProblems,
  defineCrm,
  type CrmFieldId,
  type CrmFieldView,
  type CrmFunctions,
  type CrmListResult,
  type CrmNoteId,
  type CrmNoteView,
  type CrmObjectId,
  type CrmObjectView,
  type CrmOptions,
  type CrmRecordDetail,
  type CrmRecordId,
  type CrmRecordView,
  type CrmRelatedGroup,
  type CrmViewId,
  type CrmViewView,
} from "./functions"
export * from "./fields"
