// Staffing area "teams" (module `staffing-teams`, packages/staffing/src/teams):
// client team requests ("poreikiai"), the matching engine's team proposal, the
// planner's confirmation into assignments and the answer-to-client draft
// (n8n webhook `dr-nuoma-komandos-pasiulymas`; skipped when N8N_URL is unset).
// Roles: compose staffing-teams:viewer / staffing-teams:planner with staffing:planner.
//
// Demo data (dev only, after staffing:_seedDemo):
//   npx convex run teams:_seedDemo            (skips if requests exist)
//   npx convex run teams:_seedDemo '{"reset":true}'
import { defineTeams } from "@digimuza/staffing"
import { system } from "./system"

export const {
  listRequests,
  getRequest,
  createRequest,
  saveSelection,
  cancelRequest,
  confirmTeam,
  requestClientDraft,
  _sendClientDraft,
  _recordDraftResult,
  _seedDemo,
} = defineTeams(system, { functionsModule: "teams" })
