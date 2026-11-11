// Staffing area "teams" (module `staffing-teams`): client team requests,
// the matching engine, team confirmation and the answer-to-client draft.
export { staffingTeams, StaffingTeamsPermissions, STAFFING_TEAMS_MODULE_ID } from "./manifest"
export { teamsTables, requestLineValidator, teamPickValidator, requestStatusValidator, draftStatusValidator } from "./tables"
export * from "./matching"
export { buildProposal, loadTeamCandidates, type Proposal, type TeamRequestLike } from "./operations"
export { defineTeams, type TeamsFunctions, type TeamsOptions, type RequestView, type RequestLineView, type ProposalView } from "./functions"
export { teamsTools, teamsProposeTeamTool } from "./ai-tools"
