import { defineTable } from "convex/server"
import { v } from "convex/values"
import { CLIENT_SHEET_SOURCES, CLIENT_SHEET_STATUSES, DISPUTE_KINDS, DISPUTE_STATUSES, REMINDER_STATUSES, RESOLUTION_ACTIONS, TIMESHEET_CADENCES } from "./pure"

const lit = <T extends string>(values: readonly T[]) => v.union(...values.map((x) => v.literal(x)))

export const timesheetCadenceValidator = lit(TIMESHEET_CADENCES)
export const clientSheetSourceValidator = lit(CLIENT_SHEET_SOURCES)
export const clientSheetStatusValidator = lit(CLIENT_SHEET_STATUSES)
export const resolutionActionValidator = lit(RESOLUTION_ACTIONS)
export const reminderStatusValidator = lit(REMINDER_STATUSES)
export const clientRowValidator = v.object({ name: v.string(), date: v.string(), hours: v.number() })
/** A line of a client export as written (13-minute scan rows and all). */
export const rawClientRowValidator = v.object({ name: v.string(), date: v.string(), minutes: v.number(), ref: v.optional(v.string()) })
export const disputeStatusValidator = lit(DISPUTE_STATUSES)
export const disputeKindValidator = lit(DISPUTE_KINDS)
export const sheetReviewValidator = v.union(v.literal("pending"), v.literal("confirmed"))
export const INTAKE_STATUSES = ["queued", "imported", "no_pdf", "no_match", "failed"] as const
export type IntakeStatus = (typeof INTAKE_STATUSES)[number]
export const intakeStatusValidator = lit(INTAKE_STATUSES)
const hoursOrNull = v.union(v.number(), v.null())

/** DIG-111: the worker's own hours (personal link), disputes and the email intake of client timesheets. */
export const timesheetsSourcesTables = {
  /** A worker's personal link (`/h/<token>`): no login, the token proves the worker. One active link per worker. */
  staffing_timesheets_workerLinks: defineTable({
    workerId: v.id("staffing_workers"),
    token: v.string(),
    createdAt: v.number(),
    createdBy: v.string(),
    revokedAt: v.optional(v.number()),
    lastSentAt: v.optional(v.number()),
    lastSentTo: v.optional(v.string()),
    lastSendStatus: v.optional(reminderStatusValidator),
    lastActivityAt: v.optional(v.number()),
  })
    .index("by_token", ["token"])
    .index("by_worker", ["workerId", "createdAt"]),

  /** The worker's own hours (source `worker`), next to the coordinator's entries. `disagree` = "nesutinku" with the client. */
  staffing_timesheets_workerEntries: defineTable({
    assignmentId: v.id("staffing_assignments"),
    projectId: v.id("staffing_projects"),
    workerId: v.id("staffing_workers"),
    date: v.string(),
    regularHours: v.number(),
    overtimeHours: v.number(),
    note: v.optional(v.string()),
    disagree: v.optional(v.object({ comment: v.string(), at: v.number() })),
    updatedAt: v.number(),
  })
    .index("by_worker_date", ["workerId", "date"])
    .index("by_project_date", ["projectId", "date"]),

  /** A disputed amount of one worker for one period (hours and EUR), with its timeline. */
  staffing_timesheets_disputes: defineTable({
    workerId: v.id("staffing_workers"),
    projectId: v.id("staffing_projects"),
    periodFrom: v.string(),
    periodTo: v.string(),
    kind: disputeKindValidator,
    status: disputeStatusValidator,
    /** Disputed hours (what we claim minus what the client accepts). */
    hours: v.number(),
    rateCents: v.number(),
    amountCents: v.number(),
    currency: v.string(),
    title: v.string(),
    /** Totals of the period per source when the case was opened. */
    sources: v.object({ worker: hoursOrNull, ours: hoursOrNull, client: hoursOrNull }),
    /** The disagreeing days when the case was opened. */
    lines: v.array(v.object({ date: v.string(), worker: hoursOrNull, ours: hoursOrNull, client: hoursOrNull, flag: v.optional(v.string()) })),
    sheetId: v.optional(v.id("staffing_timesheets_clientSheets")),
    timeline: v.array(
      v.object({
        at: v.number(),
        by: v.string(),
        byName: v.optional(v.string()),
        kind: v.union(v.literal("created"), v.literal("status"), v.literal("note")),
        status: v.optional(disputeStatusValidator),
        note: v.optional(v.string()),
      }),
    ),
    createdAt: v.number(),
    createdBy: v.string(),
    updatedAt: v.number(),
    resolvedAt: v.optional(v.number()),
  })
    .index("by_status", ["status", "createdAt"])
    .index("by_project", ["projectId", "periodFrom"])
    .index("by_worker", ["workerId", "periodFrom"]),

  /** Gavimas inboxes whose mail is read for client timesheets (ingest consumer `timesheets`). */
  staffing_timesheets_inboxLinks: defineTable({
    inboxId: v.string(),
    address: v.string(),
    createdAt: v.number(),
    createdBy: v.string(),
  }).index("by_inbox", ["inboxId"]),

  /** A received email handled as a client timesheet: matched client/project and the sheet it became. */
  staffing_timesheets_intake: defineTable({
    emailKey: v.string(),
    inboxAddress: v.string(),
    from: v.string(),
    fromName: v.optional(v.string()),
    subject: v.string(),
    text: v.optional(v.string()),
    receivedAt: v.number(),
    attachments: v.array(v.object({ id: v.optional(v.string()), name: v.string(), type: v.optional(v.string()), size: v.optional(v.number()) })),
    status: intakeStatusValidator,
    clientId: v.optional(v.id("staffing_clients")),
    projectId: v.optional(v.id("staffing_projects")),
    matchedBy: v.optional(v.union(v.literal("project_code"), v.literal("sender_domain"), v.literal("manual"))),
    sheetId: v.optional(v.id("staffing_timesheets_clientSheets")),
    error: v.optional(v.string()),
    createdAt: v.number(),
    createdBy: v.string(),
  })
    .index("by_email", ["emailKey"])
    .index("by_created", ["createdAt"]),
}

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
    /** Per worker per day (sums of `rawRows` when the client writes many lines a day). */
    rows: v.array(clientRowValidator),
    /** Client name → worker, chosen by hand where fuzzy matching failed. */
    nameMap: v.array(v.object({ name: v.string(), workerId: v.id("staffing_workers") })),
    error: v.optional(v.string()),
    receivedAt: v.number(),
    createdBy: v.string(),
    /** Every line as the client wrote it (kept for audit; `rows` holds the sums). */
    rawRows: v.optional(v.array(rawClientRowValidator)),
    /** Imported without a person (email intake): `pending` until someone checks it. */
    review: v.optional(sheetReviewValidator),
    /** The email it came in with (email intake). */
    email: v.optional(v.object({ from: v.string(), subject: v.string(), receivedAt: v.number() })),
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

  ...timesheetsSourcesTables,
}

export type TimesheetsTableName = keyof typeof timesheetsTables
