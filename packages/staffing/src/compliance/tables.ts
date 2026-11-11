import { defineTable } from "convex/server"
import { v } from "convex/values"
import { CERTIFICATE_STATUSES } from "../pure"
import { DIGEST_THRESHOLDS, MISSING_REASONS, PACKAGE_DELIVERIES, PACKAGE_LANGUAGES, PACKAGE_STATUSES, PACKAGE_TRIGGERS, REQUIREMENT_SCOPES, TEMPLATE_LANGUAGES } from "./pure"

const lit = <T extends string>(values: readonly T[]) => v.union(...values.map((x) => v.literal(x)))

export const requirementScopeValidator = lit(REQUIREMENT_SCOPES)
export const templateLanguageValidator = lit(TEMPLATE_LANGUAGES)
export const digestThresholdValidator = lit(DIGEST_THRESHOLDS)
export const DIGEST_RUN_STATUSES = ["pending", "sent", "empty", "not_configured", "failed"] as const
export type DigestRunStatus = (typeof DIGEST_RUN_STATUSES)[number]
export const digestItemValidator = v.object({
  certificateId: v.id("staffing_workerCertificates"),
  threshold: digestThresholdValidator,
  worker: v.string(),
  document: v.string(),
  expiresAt: v.string(),
  daysLeft: v.number(),
  currentProject: v.optional(v.string()),
})

export const packageStatusValidator = lit(PACKAGE_STATUSES)
export const packageLanguageValidator = lit(PACKAGE_LANGUAGES)
export const packageRecipientValidator = v.object({ email: v.string(), name: v.optional(v.string()) })
export const packageGapValidator = v.object({
  workerId: v.id("staffing_workers"),
  workerName: v.string(),
  document: v.string(),
  documentEn: v.optional(v.string()),
  reason: lit(MISSING_REASONS),
  expiresAt: v.optional(v.string()),
})
/** One required document of a member as it was when the package was built (the "version" sent). */
export const packageDocValidator = v.object({
  certificateTypeId: v.id("staffing_certificateTypes"),
  name: v.string(),
  nameEn: v.optional(v.string()),
  status: v.union(lit(CERTIFICATE_STATUSES), v.literal("notRequired")),
  expiresDuring: v.boolean(),
  certificateId: v.optional(v.id("staffing_workerCertificates")),
  number: v.optional(v.string()),
  expiresAt: v.optional(v.string()),
  /** The certificate's `updatedAt` when packed. */
  version: v.optional(v.number()),
  fileStorageId: v.optional(v.id("_storage")),
  fileName: v.optional(v.string()),
  size: v.optional(v.number()),
})
export const packageMemberValidator = v.object({
  workerId: v.id("staffing_workers"),
  workerName: v.string(),
  tradeName: v.string(),
  tradeNameEn: v.optional(v.string()),
  nationality: v.string(),
  documents: v.array(packageDocValidator),
})

export const complianceTables = {
  /**
   * One required certificate type for a country's projects (`country`) or a
   * client's projects (`clientId`); exactly one of the two is set.
   * `scope: nonEea` = only workers from outside the EU/EEA/CH (work permits).
   */
  staffing_compliance_requirements: defineTable({
    certificateTypeId: v.id("staffing_certificateTypes"),
    country: v.optional(v.string()),
    clientId: v.optional(v.id("staffing_clients")),
    scope: requirementScopeValidator,
    note: v.optional(v.string()),
    updatedAt: v.number(),
  })
    .index("by_country", ["country", "certificateTypeId"])
    .index("by_client", ["clientId", "certificateTypeId"])
    .index("by_type", ["certificateTypeId"]),

  /** Contract / order template: plain text with `{{placeholders}}`; `# ` lines are headings. */
  staffing_compliance_templates: defineTable({
    name: v.string(),
    language: templateLanguageValidator,
    body: v.string(),
    description: v.optional(v.string()),
    updatedAt: v.number(),
  }).index("by_name", ["name"]),

  /** A document generated from a template for one worker (and assignment): the filled text is frozen. */
  staffing_compliance_contracts: defineTable({
    templateId: v.optional(v.id("staffing_compliance_templates")),
    templateName: v.string(),
    language: templateLanguageValidator,
    title: v.string(),
    body: v.string(),
    /** Required placeholders that had no value. */
    missing: v.array(v.string()),
    workerId: v.id("staffing_workers"),
    assignmentId: v.optional(v.id("staffing_assignments")),
    projectId: v.optional(v.id("staffing_projects")),
    createdBy: v.string(),
  })
    .index("by_worker", ["workerId"])
    .index("by_project", ["projectId"]),

  /** Each certificate is reported in the expiry digest once per threshold (60, 30 days, expired). */
  staffing_compliance_digestLog: defineTable({
    certificateId: v.id("staffing_workerCertificates"),
    threshold: digestThresholdValidator,
    runId: v.id("staffing_compliance_digestRuns"),
    sentAt: v.number(),
  }).index("by_certificate", ["certificateId", "threshold"]),

  /** One digest attempt (daily cron or the button): what was due and what happened. */
  staffing_compliance_digestRuns: defineTable({
    trigger: v.union(v.literal("cron"), v.literal("manual")),
    status: lit(DIGEST_RUN_STATUSES),
    to: v.optional(v.string()),
    items: v.array(digestItemValidator),
    error: v.optional(v.string()),
    finishedAt: v.optional(v.number()),
  }),

  /**
   * A client document package (DIG-113) and its send log: who built it, the
   * team and every document with its version, what was missing, who approved,
   * when and to whom it went. Built complete → `ready`, else `needs_approval`.
   */
  staffing_compliance_packages: defineTable({
    projectId: v.id("staffing_projects"),
    clientId: v.id("staffing_clients"),
    status: packageStatusValidator,
    trigger: lit(PACKAGE_TRIGGERS),
    language: packageLanguageValidator,
    recipients: v.array(packageRecipientValidator),
    members: v.array(packageMemberValidator),
    missing: v.array(packageGapValidator),
    warnings: v.array(packageGapValidator),
    fileCount: v.number(),
    totalBytes: v.number(),
    delivery: lit(PACKAGE_DELIVERIES),
    note: v.optional(v.string()),
    /** Subject and text as last rendered (final at send time, with the link). */
    subject: v.string(),
    text: v.string(),
    createdBy: v.string(),
    createdByName: v.string(),
    approvedByName: v.optional(v.string()),
    approvedAt: v.optional(v.number()),
    cancelledByName: v.optional(v.string()),
    cancelledAt: v.optional(v.number()),
    queuedAt: v.optional(v.number()),
    sentAt: v.optional(v.number()),
    /** Where the mail really went (non-production: the first SUPER_USER_EMAILS). */
    redirectedTo: v.optional(v.string()),
    linkId: v.optional(v.id("staffing_compliance_packageLinks")),
    error: v.optional(v.string()),
  })
    .index("by_project", ["projectId"])
    .index("by_status", ["status"]),

  /** Per project: send complete packages automatically, default recipients and language. */
  staffing_compliance_packageSettings: defineTable({
    projectId: v.id("staffing_projects"),
    autoSend: v.boolean(),
    recipients: v.optional(v.array(packageRecipientValidator)),
    language: v.optional(packageLanguageValidator),
    updatedAt: v.number(),
  }).index("by_project", ["projectId"]),

  /** Public time-limited download link `/d/<token>`; only the token's SHA-256 is stored. */
  staffing_compliance_packageLinks: defineTable({
    packageId: v.id("staffing_compliance_packages"),
    tokenHash: v.string(),
    expiresAt: v.number(),
    revokedAt: v.optional(v.number()),
    createdByName: v.string(),
    downloads: v.number(),
    lastAccessAt: v.optional(v.number()),
  })
    .index("by_token", ["tokenHash"])
    .index("by_package", ["packageId"]),

  /** Every opening of a public link (page view or ZIP download). */
  staffing_compliance_packageDownloads: defineTable({
    linkId: v.id("staffing_compliance_packageLinks"),
    packageId: v.id("staffing_compliance_packages"),
    kind: v.union(v.literal("view"), v.literal("zip")),
    at: v.number(),
    userAgent: v.optional(v.string()),
  }).index("by_package", ["packageId", "at"]),

  /** One row per worker per sent package: "Paskutinį kartą siųsta klientui …" on the worker card. */
  staffing_compliance_packageSends: defineTable({
    workerId: v.id("staffing_workers"),
    packageId: v.id("staffing_compliance_packages"),
    projectId: v.id("staffing_projects"),
    sentAt: v.number(),
    to: v.array(v.string()),
    documents: v.number(),
    missing: v.number(),
  })
    .index("by_worker", ["workerId", "sentAt"])
    .index("by_project", ["projectId", "sentAt"]),
}

export type ComplianceTableName = keyof typeof complianceTables
