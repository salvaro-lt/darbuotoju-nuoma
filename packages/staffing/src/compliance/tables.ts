import { defineTable } from "convex/server"
import { v } from "convex/values"
import { DIGEST_THRESHOLDS, REQUIREMENT_SCOPES, TEMPLATE_LANGUAGES } from "./pure"

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
}

export type ComplianceTableName = keyof typeof complianceTables
