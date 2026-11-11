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
// Housing pool of the Rotterdam region (flats, stays, fleet, fuel/km log):
//   npx convex run logistics:_seedHousing         (skips if pool flats exist; '{"reset":true}' rebuilds)
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
  // housing pool and fleet (DIG-110)
  housingOverview,
  fleetOverview,
  housingCosts,
  saveFlat,
  saveStay,
  endStay,
  applyConsolidation,
  autoAllocateHousing,
  saveFleetVehicle,
  addVehicleLog,
  deleteVehicleLog,
  // internal
  _dailyDigest,
  _deliver,
  _markNotification,
  _seedDemo,
  _seedHousing,
} =defineLogistics(system, { functionsPath: "logistics", notifyWebhook: "dr-nuoma-pranesimas" })
