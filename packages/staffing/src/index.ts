// `@digimuza/staffing`: the staffing base (workers, trades, certificates,
// clients, projects, assignments) for system-core apps, and the shared
// contract the staffing areas build on. See README.md → "The contract".
//
//   // modules/index.ts
//   import { staffing } from "@digimuza/staffing/manifest"
//   // convex/schema.ts
//   export default defineSchema({ ...systemTables, ...staffingTables })
//   // convex/staffing.ts
//   export const { listWorkers, getWorker, … } = defineStaffing(system)

// ---- base: manifest, tables, pure helpers
export { staffing, StaffingPermissions, STAFFING_MODULE_ID, type StaffingPermission } from "./manifest"
export * from "./tables"
export * from "./pure"

// ---- base: typed IDs, docs, db access, errors (for areas' own functions)
export * from "./shared"

// ---- base: shared read operations (no permission checks: guard first)
export * from "./operations"

// ---- base: Convex functions and AI tools
export { defineStaffing, type StaffingFunctions, type StaffingOptions, type ClientView, type ProjectView, type ProjectDetail } from "./functions"
export { staffingTools, staffingListWorkersTool, staffingGetWorkerTool, staffingFindAvailableWorkersTool, staffingListProjectsTool } from "./ai-tools"

// ---- areas: one block per area (teams, timesheets, invoicing, logistics, compliance).
// Each area lives in src/<area>/ and re-exports its manifest, tables, functions
// and tools here, e.g.:
//   export * from "./timesheets"
export * from "./teams"
export * from "./logistics"
export * from "./timesheets"
export * from "./compliance"
export * from "./invoicing"
// Both timesheets and invoicing define these helpers (quarter-hour vs cent
// rounding). The root exposes the timesheets ones; areas import their own
// from "./pure" relatively.
export { isWeekend, roundHours } from "./timesheets/pure"
