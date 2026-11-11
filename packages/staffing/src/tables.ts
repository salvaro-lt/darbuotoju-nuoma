import { defineTable } from "convex/server"
import { v } from "convex/values"
import {
  ASSIGNMENT_STATUSES,
  CERT_APPLIES_TO,
  CLIENT_KINDS,
  INVOICING_PERIODS,
  PROJECT_STATUSES,
  TRADE_LEVELS,
  WORKER_SOURCES,
  WORKER_STATUSES,
} from "./pure"

const lit = <T extends string>(values: readonly T[]) => v.union(...values.map((x) => v.literal(x)))

export const workerStatusValidator = lit(WORKER_STATUSES)
export const workerSourceValidator = lit(WORKER_SOURCES)
export const tradeLevelValidator = lit(TRADE_LEVELS)
export const clientKindValidator = lit(CLIENT_KINDS)
export const invoicingPeriodValidator = lit(INVOICING_PERIODS)
export const projectStatusValidator = lit(PROJECT_STATUSES)
export const assignmentStatusValidator = lit(ASSIGNMENT_STATUSES)
export const certAppliesToValidator = lit(CERT_APPLIES_TO)

/** A worker's trade and how well they master it. */
export const workerTradeValidator = v.object({ tradeId: v.id("staffing_trades"), level: tradeLevelValidator })
/** Hourly sell rate for a trade, in cents. */
export const tradeRateValidator = v.object({ tradeId: v.id("staffing_trades"), hourlyRateCents: v.number() })
export const clientContactValidator = v.object({
  name: v.string(),
  role: v.optional(v.string()),
  email: v.optional(v.string()),
  phone: v.optional(v.string()),
})
export const clothingSizesValidator = v.object({
  jacket: v.optional(v.string()),
  trousers: v.optional(v.string()),
  shoes: v.optional(v.string()),
})

/**
 * The staffing base. Spread into the app schema next to `systemTables`:
 * `defineSchema({ ...systemTables, ...staffingTables })`.
 *
 * Every table is prefixed `staffing_`; areas built on top (teams, timesheets,
 * invoicing, logistics, compliance) add their own `staffing_<area>_*` tables in
 * `src/<area>/tables.ts` and reference these by typed ID
 * (`v.id("staffing_workers")`). Dates: `YYYY-MM-DD`. Money: integer cents.
 */
export const staffingTables = {
  /** Catalog of trades (specialybės / kvalifikacijos): welder, fitter, … */
  staffing_trades: defineTable({
    /** Short unique code, upper case: `WELD-MAG`. */
    code: v.string(),
    nameLt: v.string(),
    nameEn: v.string(),
    position: v.number(),
  })
    .index("by_code", ["code"])
    .index("by_position", ["position"]),

  /** Catalog of certificate / document types a worker may need. */
  staffing_certificateTypes: defineTable({
    name: v.string(),
    nameEn: v.optional(v.string()),
    /** Who holds it. Only `worker` today; areas may add more. */
    appliesTo: certAppliesToValidator,
    /** Every worker must hold a usable one to be sent to work (passport, A1, safety induction). */
    mandatory: v.boolean(),
    /** Suggested expiry for new certificates: issued + N months. */
    defaultValidityMonths: v.optional(v.number()),
    position: v.number(),
  })
    .index("by_name", ["name"])
    .index("by_position", ["position"]),

  staffing_workers: defineTable({
    firstName: v.string(),
    lastName: v.string(),
    phone: v.string(),
    email: v.optional(v.string()),
    /** ISO 3166-1 alpha-2, upper case: `LT`, `UA`. */
    nationality: v.string(),
    /** ISO 639-1, lower case: `lt`, `ru`, `en`. */
    languages: v.array(v.string()),
    source: workerSourceValidator,
    /** The company that supplies the worker, when `source` is `subcontractor`. */
    subcontractorClientId: v.optional(v.id("staffing_clients")),
    trades: v.array(workerTradeValidator),
    /** Driving licence categories: `B`, `C`, `BE`, … */
    driverLicenseCategories: v.array(v.string()),
    driverLicenseExpiresAt: v.optional(v.string()),
    clothingSizes: clothingSizesValidator,
    status: workerStatusValidator,
    notes: v.string(),
    homeCountry: v.string(),
    homeCity: v.string(),
    /** Folded (lower case, no accents) name, phone, email, city: maintained by the module. */
    searchText: v.string(),
    updatedAt: v.number(),
  })
    .index("by_status", ["status", "lastName"])
    .index("by_source", ["source", "status"])
    .index("by_subcontractor", ["subcontractorClientId"])
    .searchIndex("search", { searchField: "searchText", filterFields: ["status", "source"] }),

  /** A worker's certificate. The source of truth for every expiry check. */
  staffing_workerCertificates: defineTable({
    workerId: v.id("staffing_workers"),
    certificateTypeId: v.id("staffing_certificateTypes"),
    number: v.optional(v.string()),
    issuedAt: v.optional(v.string()),
    /** Missing: does not expire. */
    expiresAt: v.optional(v.string()),
    fileStorageId: v.optional(v.id("_storage")),
    fileName: v.optional(v.string()),
    notes: v.optional(v.string()),
    updatedAt: v.number(),
  })
    .index("by_worker", ["workerId", "certificateTypeId"])
    .index("by_type", ["certificateTypeId", "expiresAt"])
    .index("by_expires", ["expiresAt"]),

  /** Client companies (and subcontractors supplying workers). Separate from the CRM. */
  staffing_clients: defineTable({
    name: v.string(),
    /** Short unique code, upper case: `NSY`. */
    code: v.string(),
    kind: clientKindValidator,
    /** ISO 3166-1 alpha-2. */
    country: v.string(),
    vatCode: v.optional(v.string()),
    companyCode: v.optional(v.string()),
    address: v.optional(v.string()),
    contacts: v.array(clientContactValidator),
    defaultRates: v.array(tradeRateValidator),
    currency: v.string(),
    paymentTermsDays: v.number(),
    invoicingPeriod: invoicingPeriodValidator,
    notes: v.string(),
    updatedAt: v.number(),
  })
    .index("by_code", ["code"])
    .index("by_name", ["name"]),

  staffing_projects: defineTable({
    clientId: v.id("staffing_clients"),
    name: v.string(),
    /** Short unique code: `NSY-2026-03`. */
    code: v.string(),
    country: v.string(),
    city: v.string(),
    siteAddress: v.optional(v.string()),
    startDate: v.string(),
    endDate: v.optional(v.string()),
    status: projectStatusValidator,
    /** system-core user ID of the on-site coordinator. */
    coordinatorUserId: v.optional(v.string()),
    /** Hourly sell rates per trade; missing trades fall back to the client's defaults. */
    rates: v.array(tradeRateValidator),
    currency: v.string(),
    notes: v.string(),
    updatedAt: v.number(),
  })
    .index("by_code", ["code"])
    .index("by_status", ["status", "startDate"])
    .index("by_client", ["clientId", "startDate"]),

  /** A worker on a project for a period, in one trade. */
  staffing_assignments: defineTable({
    projectId: v.id("staffing_projects"),
    workerId: v.id("staffing_workers"),
    tradeId: v.id("staffing_trades"),
    startDate: v.string(),
    endDate: v.optional(v.string()),
    status: assignmentStatusValidator,
    isDriver: v.boolean(),
    notes: v.string(),
    createdBy: v.string(),
    updatedAt: v.number(),
  })
    .index("by_worker", ["workerId", "startDate"])
    .index("by_project", ["projectId", "startDate"])
    .index("by_status", ["status", "startDate"]),
}

export type StaffingTableName = keyof typeof staffingTables
