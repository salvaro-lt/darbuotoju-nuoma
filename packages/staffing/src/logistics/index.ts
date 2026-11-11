// Logistics area (module `staffing-logistics`): accommodation, vehicles, travel
// legs, workwear and the computed plan with warnings. See README.md → "Logistics".
export { staffingLogistics, StaffingLogisticsPermissions, STAFFING_LOGISTICS_MODULE_ID } from "./manifest"
export * from "./tables"
export * from "./pure"
export { loadPlan, alertLines, DEFAULT_WINDOW_DAYS, type LogisticsDataModel, type LogisticsPlan, type MemberRow, type AccommodationRow, type VehicleRow, type TravelLegRow, type Segment, type NotificationRow } from "./plan"
export { defineLogistics, type LogisticsFunctions, type LogisticsOptions, type ProjectLogisticsSummary } from "./functions"
