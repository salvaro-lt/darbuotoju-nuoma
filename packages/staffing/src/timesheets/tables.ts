import { defineTable } from "convex/server"
import { v } from "convex/values"
import { CLIENT_SHEET_SOURCES, CLIENT_SHEET_STATUSES, REMINDER_STATUSES, RESOLUTION_ACTIONS, TIMESHEET_CADENCES } from "./pure"

const lit = <T extends string>(values: readonly T[]) => v.union(...values.map((x) => v.literal(x)))

export const timesheetCadenceValidator = lit(TIMESHEET_CADENCES)
export const clientSheetSourceValidator = lit(CLIENT_SHEET_SOURCES)
export const clientSheetStatusValidator = lit(CLIENT_SHEET_STATUSES)
export const resolutionActionValidator = lit(RESOLUTION_ACTIONS)
export const reminderStatusValidator = lit(REMINDER_STATUSES)
export const clientRowValidator = v.object({ name: v.string(), date: v.string(), hours: v.number() })

export const timesheetsTables = {
  /** Our own hours: one row per assignment per day. `projectId`, `workerId`, `tradeId` copied from the assignment. */
  staffing_timesheets_entries: defineTable({
    assignmentId: v.id("staffing_assignments"),
    projectId: v.id("staffing_projects"),
    workerId: v.id("staffing_workers"),
    tradeId: v.id("staffing_trades"),
    date: v.string(),
    regularHours: v.number(),
    overtimeHours: v.number(),
    /** Saturday or Sunday (from the date). */
    weekend: v.boolean(),
    night: v.boolean(),
    note: v.optional(v.string()),
    updatedBy: v.string(),
    updatedAt: v.number(),
  })
    .index("by_project_date", ["projectId", "date"])
    .index("by_assignment_date", ["assignmentId", "date"])
    .index("by_worker_date", ["workerId", "date"]),

  /** An approved week of a project (Monday `weekStart`): its entries are locked for invoicing. */
  staffing_timesheets_weeks: defineTable({
    projectId: v.id("staffing_projects"),
    weekStart: v.string(),
    approvedBy: v.string(),
    approvedAt: v.number(),
  }).index("by_project_week", ["projectId", "weekStart"]),

  /** How often the client sends timesheets for a project (no row = weekly, 2 days grace). */
  staffing_timesheets_settings: defineTable({
    projectId: v.id("staffing_projects"),
    cadence: timesheetCadenceValidator,
    graceDays: v.number(),
    contactEmail: v.optional(v.string()),
    contactName: v.optional(v.string()),
    updatedAt: v.number(),
  }).index("by_project", ["projectId"]),

  /** A client timesheet as received (file in storage) and its parsed rows. */
  staffing_timesheets_clientSheets: defineTable({
    projectId: v.id("staffing_projects"),
    periodFrom: v.string(),
    periodTo: v.string(),
    source: clientSheetSourceValidator,
    status: clientSheetStatusValidator,
    fileStorageId: v.optional(v.id("_storage")),
    fileName: v.optional(v.string()),
    /** PDF pages rendered in the browser, for the AI reader. */
    pageImageIds: v.optional(v.array(v.id("_storage"))),
    /** PDF text layer, for the AI reader. */
    text: v.optional(v.string()),
    rows: v.array(clientRowValidator),
    /** Client name → worker, chosen by hand where fuzzy matching failed. */
    nameMap: v.array(v.object({ name: v.string(), workerId: v.id("staffing_workers") })),
    error: v.optional(v.string()),
    receivedAt: v.number(),
    createdBy: v.string(),
  }).index("by_project", ["projectId", "periodTo"]),

  /** A decision on one reconciliation line (worker + day) of a client sheet. */
  staffing_timesheets_resolutions: defineTable({
    sheetId: v.id("staffing_timesheets_clientSheets"),
    key: v.string(),
    action: resolutionActionValidator,
    note: v.optional(v.string()),
    resolvedBy: v.string(),
    resolvedAt: v.number(),
  }).index("by_sheet", ["sheetId", "key"]),

  /** Late timesheet reminders sent to the client (n8n `dr-nuoma-tabelio-priminimas`). */
  staffing_timesheets_reminders: defineTable({
    projectId: v.id("staffing_projects"),
    period: v.string(),
    to: v.optional(v.string()),
    trigger: v.union(v.literal("manual"), v.literal("cron")),
    status: reminderStatusValidator,
    error: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_project", ["projectId", "createdAt"]),
}

export type TimesheetsTableName = keyof typeof timesheetsTables
