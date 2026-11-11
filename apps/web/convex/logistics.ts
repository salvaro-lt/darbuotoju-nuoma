// Staffing area "logistics" (packages/staffing/src/logistics, module
// `staffing-logistics`): accommodation, vehicles, travel legs, bed and seat
// allocation, workwear packing list, the computed plan and its warnings.
// Roles: compose staffing-logistics:viewer / staffing-logistics:coordinator.
//
// Coordinator notifications go to the n8n webhook `dr-nuoma-pranesimas`
// (env N8N_URL + N8N_WEBHOOK_SECRET; without them nothing is sent and the
// notification is recorded as "not_configured"). Daily digest: convex/crons.ts.
//
// Demo data (dev only, after staffing:_seedDemo):
//   npx convex run logistics:_seedDemo            (skips if accommodations exist)
//   npx convex run logistics:_seedDemo '{"reset":true}'
import { defineLogistics } from "@digimuza/staffing"
import { system } from "./system"

export const {
  listProjects,
  getPlan,
  saveAccommodation,
  deleteAccommodation,
  saveVehicle,
  deleteVehicle,
  saveTravelLeg,
  setTravelLegBooked,
  deleteTravelLeg,
  setAllocation,
  autoAssign,
  acknowledgePlan,
  setDailyDigest,
  notifyCoordinator,
  // internal
  _dailyDigest,
  _deliver,
  _markNotification,
  _seedDemo,
} = defineLogistics(system, { functionsPath: "logistics", notifyWebhook: "dr-nuoma-pranesimas" })
