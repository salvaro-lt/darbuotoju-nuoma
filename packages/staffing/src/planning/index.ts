// Staffing area "planning" (module `staffing-planning`): worker rotation,
// the weekly board, the quick capacity answer, subcontractor capacity, team
// composition rules and per-client feedback on workers.
export { staffingPlanning, StaffingPlanningPermissions, STAFFING_PLANNING_MODULE_ID } from "./manifest"
export { planningTables, FEEDBACK_VERDICTS, feedbackVerdictValidator, englishScopeValidator, type FeedbackVerdict } from "./tables"
export * from "./rules"
export * from "./pure"
export { loadPlanData, clientRulesFor, clientFeedback, capacityOffers, workerClientHistory, tradesForText, type ClientHistory, type FeedbackNote, type CapacityOffer, type PlanningDataModel } from "./operations"
export {
  definePlanning,
  capacityFor,
  tradeGroupNames,
  type PlanningFunctions,
  type BoardView,
  type BoardRow,
  type BoardTrade,
  type AvailabilityView,
  type WorkerPlanningView,
  type CapacityView,
  type SettingsView,
} from "./functions"
export { planningTools, planningCapacityTool } from "./ai-tools"
