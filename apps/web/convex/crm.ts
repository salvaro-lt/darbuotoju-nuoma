// The CRM business module (packages/crm). Every function guards itself
// (permission, module enabled, role view) and audits its writes.
//
// Per-client configuration lives here:
// - `blueprint`: the data model `pnpm deploy:convex` installs (crm:_applyBlueprint).
//   Additive only: admins' changes in the UI are never overwritten. Use
//   `extendBlueprint(standardBlueprint("lt"), { objects, fields, views })` to add
//   client objects or fields, or `emptyBlueprint` to start blank.
// - Feature flags (Super → Modules): crm:custom-objects, crm:custom-fields, crm:kanban.
// - Roles: compose crm:viewer / crm:member / crm:manager / crm:admin.
import { defineCrm, standardBlueprint } from "@digimuza/crm"
import { system } from "./system"

export const {
  getCrmSchema,
  applyBlueprint,
  _applyBlueprint,
  createObject,
  updateObject,
  setObjectArchived,
  reorderObjects,
  createField,
  updateField,
  setFieldArchived,
  reorderFields,
  createView,
  updateView,
  deleteView,
  listRecords,
  searchRecords,
  getRecord,
  createRecord,
  updateRecord,
  setRecordsArchived,
  addNote,
  deleteNote,
} = defineCrm(system, { blueprint: standardBlueprint("lt") })
