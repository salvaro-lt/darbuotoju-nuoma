import { defineTable } from "convex/server"
import { v } from "convex/values"
import { tradeLevelValidator } from "../tables"
import { DRAFT_STATUSES, REQUEST_STATUSES } from "./matching"

const lit = <T extends string>(values: readonly T[]) => v.union(...values.map((x) => v.literal(x)))
export const requestStatusValidator = lit(REQUEST_STATUSES)
export const draftStatusValidator = lit(DRAFT_STATUSES)

/** One line of a request: `count` people of a trade, with required certificates and drivers among them. */
export const requestLineValidator = v.object({
  tradeId: v.id("staffing_trades"),
  count: v.number(),
  minLevel: v.optional(tradeLevelValidator),
  certificateTypeIds: v.array(v.id("staffing_certificateTypes")),
  drivers: v.number(),
})
/** The planner's team draft: one pick per person, by request line. */
export const teamPickValidator = v.object({
  lineIndex: v.number(),
  workerId: v.id("staffing_workers"),
  isDriver: v.boolean(),
})

export const teamsTables = {
  /** A client's team request ("poreikis") and its team draft. */
  staffing_teams_requests: defineTable({
    clientId: v.id("staffing_clients"),
    /** Existing project, or none: confirming creates one from `projectName`. */
    projectId: v.optional(v.id("staffing_projects")),
    projectName: v.optional(v.string()),
    country: v.string(),
    site: v.string(),
    startDate: v.string(),
    endDate: v.optional(v.string()),
    lines: v.array(requestLineValidator),
    /** Languages the client wants in the team (ISO-639-1); a plus when ranking. */
    languages: v.array(v.string()),
    notes: v.string(),
    /** ID of the CRM `request` record this came from (text; the CRM is another module). */
    crmRecordId: v.optional(v.string()),
    status: requestStatusValidator,
    /** Planner's edits; missing: the matching engine's proposal is used. */
    selection: v.optional(v.array(teamPickValidator)),
    /** Assignments created from this request (proposed or confirmed). */
    assignmentIds: v.array(v.id("staffing_assignments")),
    draft: v.optional(v.object({ status: draftStatusValidator, at: v.number(), to: v.optional(v.string()), error: v.optional(v.string()) })),
    createdBy: v.string(),
    updatedAt: v.number(),
  })
    .index("by_status", ["status", "startDate"])
    .index("by_client", ["clientId", "startDate"]),
}
