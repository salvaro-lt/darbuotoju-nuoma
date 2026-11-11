import { defineTable } from "convex/server"
import { v } from "convex/values"
import { ENGLISH_SCOPES } from "./rules"

const lit = <T extends string>(values: readonly T[]) => v.union(...values.map((x) => v.literal(x)))

export const FEEDBACK_VERDICTS = ["suitable", "unsuitable"] as const
export type FeedbackVerdict = (typeof FEEDBACK_VERDICTS)[number]
export const feedbackVerdictValidator = lit(FEEDBACK_VERDICTS)
export const englishScopeValidator = lit(ENGLISH_SCOPES)

/**
 * Tables of the "planning" area. Worker availability (rest, unavailable,
 * available from) is a base table (`staffing_workerAvailability`): the base's
 * `listAvailableWorkers` respects it.
 */
export const planningTables = {
  /** How many people of a trade a subcontractor can supply, and when (declared by the subcontractor). */
  staffing_planning_capacities: defineTable({
    /** A `staffing_clients` row of kind `subcontractor` or `both`. */
    clientId: v.id("staffing_clients"),
    tradeId: v.id("staffing_trades"),
    count: v.number(),
    validFrom: v.string(),
    /** Missing: until further notice. */
    validTo: v.optional(v.string()),
    note: v.string(),
    createdBy: v.string(),
    updatedAt: v.number(),
  })
    .index("by_client", ["clientId", "tradeId"])
    .index("by_trade", ["tradeId", "validFrom"]),

  /** Team composition rules per client (missing fields / no row: `DEFAULT_TEAM_RULES`). */
  staffing_planning_clientRules: defineTable({
    clientId: v.id("staffing_clients"),
    driversPerPeople: v.number(),
    english: englishScopeValidator,
    languageCompatibility: v.boolean(),
    housingGroupSize: v.number(),
    note: v.string(),
    createdBy: v.string(),
    updatedAt: v.number(),
  }).index("by_client", ["clientId"]),

  /** The planner's verdict on a worker for one client: `unsuitable` keeps the worker out of that client's teams. */
  staffing_planning_feedback: defineTable({
    workerId: v.id("staffing_workers"),
    clientId: v.id("staffing_clients"),
    verdict: feedbackVerdictValidator,
    comment: v.string(),
    createdBy: v.string(),
    updatedAt: v.number(),
  })
    .index("by_worker", ["workerId", "clientId"])
    .index("by_client", ["clientId", "verdict"]),
}
