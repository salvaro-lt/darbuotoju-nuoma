import { defineTable } from "convex/server"
import { v } from "convex/values"
import { COST_PERIODS, TRAVEL_DIRECTIONS, TRAVEL_MODES, VEHICLE_COST_PERIODS, VEHICLE_OWNERSHIP } from "./pure"

const lit = <T extends string>(values: readonly T[]) => v.union(...values.map((x) => v.literal(x)))
export const costPeriodValidator = lit(COST_PERIODS)
export const vehicleCostPeriodValidator = lit(VEHICLE_COST_PERIODS)
export const vehicleOwnershipValidator = lit(VEHICLE_OWNERSHIP)
export const travelModeValidator = lit(TRAVEL_MODES)
export const travelDirectionValidator = lit(TRAVEL_DIRECTIONS)
export const snapshotEntryValidator = v.object({ workerId: v.string(), name: v.string(), ranges: v.string(), isDriver: v.boolean() })
export const notificationStatusValidator = v.union(v.literal("pending"), v.literal("sent"), v.literal("not_configured"), v.literal("failed"))

export const logisticsTables = {
  /** A flat, hostel or house booked for a project's team. Cost in cents per night or per month (whole place). */
  staffing_logistics_accommodations: defineTable({
    projectId: v.id("staffing_projects"),
    name: v.string(),
    address: v.string(),
    beds: v.number(),
    costCents: v.number(),
    costPeriod: costPeriodValidator,
    startDate: v.string(),
    endDate: v.string(),
    notes: v.string(),
    updatedAt: v.number(),
  }).index("by_project", ["projectId", "startDate"]),

  /** A car or van for the site. `seats` includes the driver. */
  staffing_logistics_vehicles: defineTable({
    projectId: v.id("staffing_projects"),
    plate: v.string(),
    model: v.string(),
    seats: v.number(),
    ownership: vehicleOwnershipValidator,
    costCents: v.number(),
    costPeriod: vehicleCostPeriodValidator,
    startDate: v.string(),
    endDate: v.string(),
    notes: v.string(),
    updatedAt: v.number(),
  }).index("by_project", ["projectId", "startDate"]),

  /** A worker's trip to (arrival) or from (departure) the site. */
  staffing_logistics_travelLegs: defineTable({
    projectId: v.id("staffing_projects"),
    workerId: v.id("staffing_workers"),
    direction: travelDirectionValidator,
    fromCity: v.string(),
    toCity: v.string(),
    date: v.string(),
    mode: travelModeValidator,
    ticketCostCents: v.number(),
    booked: v.boolean(),
    bookingRef: v.optional(v.string()),
    notes: v.string(),
    updatedAt: v.number(),
  })
    .index("by_project", ["projectId", "date"])
    .index("by_worker", ["workerId", "date"]),

  /** Where a worker sleeps and rides on a project. One row per (project, worker). */
  staffing_logistics_allocations: defineTable({
    projectId: v.id("staffing_projects"),
    workerId: v.id("staffing_workers"),
    accommodationId: v.optional(v.id("staffing_logistics_accommodations")),
    vehicleId: v.optional(v.id("staffing_logistics_vehicles")),
    driver: v.boolean(),
    updatedAt: v.number(),
  })
    .index("by_project", ["projectId", "workerId"])
    .index("by_accommodation", ["accommodationId"])
    .index("by_vehicle", ["vehicleId"]),

  /** Per project: the team the coordinator last acknowledged, and the daily warnings mail switch. */
  staffing_logistics_settings: defineTable({
    projectId: v.id("staffing_projects"),
    dailyDigest: v.boolean(),
    ackSnapshot: v.optional(v.array(snapshotEntryValidator)),
    ackAt: v.optional(v.number()),
    ackBy: v.optional(v.string()),
    updatedAt: v.number(),
  })
    .index("by_project", ["projectId"])
    .index("by_digest", ["dailyDigest"]),

  /** Warnings sent to the coordinator through the notification webhook. */
  staffing_logistics_notifications: defineTable({
    projectId: v.id("staffing_projects"),
    trigger: v.union(v.literal("manual"), v.literal("daily")),
    to: v.string(),
    title: v.string(),
    lines: v.array(v.string()),
    status: notificationStatusValidator,
    error: v.optional(v.string()),
    sentAt: v.optional(v.number()),
    createdBy: v.string(),
  }).index("by_project", ["projectId"]),
}

export type LogisticsTableName = keyof typeof logisticsTables
