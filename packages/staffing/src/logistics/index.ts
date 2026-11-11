// Logistics area (module `staffing-logistics`): accommodation, vehicles, travel
// legs, workwear and the computed plan with warnings. See README.md → "Logistics".
export { staffingLogistics, StaffingLogisticsPermissions, STAFFING_LOGISTICS_MODULE_ID } from "./manifest"
export * from "./tables"
export * from "./pure"
export { loadPlan, alertLines, DEFAULT_WINDOW_DAYS, type LogisticsDataModel, type LogisticsPlan, type MemberRow, type AccommodationRow, type VehicleRow, type TravelLegRow, type Segment, type NotificationRow, type PoolStayRow } from "./plan"
export { defineLogistics, type LogisticsFunctions, type LogisticsOptions, type ProjectLogisticsSummary } from "./functions"
// Housing pool and fleet (DIG-110): pure rules/optimizer, loaders, `housingCostsByProject` for invoicing.
export * from "./housing"
export { loadHousingWorld, housingOverview, fleetOverview, incomingWorkers, housingCostsByProject, type HousingWorld, type HousingOverview, type FlatOverview, type FlatRow, type StayRow, type ResidentRow, type WeekCell, type SuggestionRow, type IncomingRow, type FleetOverview, type FleetRow, type FleetVehicle, type HousingCostsByProject, type ProjectHousingCostRow } from "./housing-data"
