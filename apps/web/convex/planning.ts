// Staffing area "planning" (module `staffing-planning`, packages/staffing/src/planning):
// worker rotation (rest / unavailable / available from), the weekly planning
// board, the quick capacity answer, subcontractor capacity, per-client team
// composition rules and per-client feedback on workers.
// Roles: compose staffing-planning:viewer / staffing-planning:planner with staffing:planner.
//
// Demo data (dev only, after staffing:_seedDemo and teams:_seedDemo):
//   npx convex run planning:_seedDemo            (skips if already seeded)
//   npx convex run planning:_seedDemo '{"reset":true}'
import { definePlanning } from "@digimuza/staffing"
import { system } from "./system"

export const {
  getBoard,
  capacity,
  getWorkerPlanning,
  addAvailability,
  deleteAvailability,
  setFeedback,
  deleteFeedback,
  getSettings,
  saveCapacity,
  deleteCapacity,
  saveClientRules,
  deleteClientRules,
  _seedDemo,
} = definePlanning(system)
