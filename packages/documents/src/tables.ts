import { defineTable } from "convex/server"
import { v } from "convex/values"
import { MATCH_ALGORITHMS } from "./matching"
import { SIGNING_FIELD_TYPES, SUBMISSION_STATUSES, SUBMITTER_STATUSES } from "./signing"

export const CUSTOM_FIELD_TYPES = ["text", "number", "monetary", "date", "boolean", "url", "select"] as const
export type CustomFieldType = (typeof CUSTOM_FIELD_TYPES)[number]

const algorithm = v.union(...MATCH_ALGORITHMS.map((a) => v.literal(a)))
const rule = { match: v.string(), algorithm, caseSensitive: v.boolean() }

export const signingFieldValidator = v.object({
  id: v.string(),
  type: v.union(...SIGNING_FIELD_TYPES.map((t) => v.literal(t))),
  role: v.number(),
  label: v.string(),
  required: v.boolean(),
  page: v.number(),
  x: v.number(),
  y: v.number(),
  w: v.number(),
  h: v.number(),
})
export const pageSizeValidator = v.object({ width: v.number(), height: v.number() })
export const customFieldTypeValidator = v.union(...CUSTOM_FIELD_TYPES.map((t) => v.literal(t)))
export const matchAlgorithmValidator = algorithm
/** Who may see a restricted label. Empty lists: only holders of `documents:document:all`. */
export const tagAccessValidator = v.object({ userIds: v.array(v.string()), roleIds: v.array(v.string()) })

export const viewFilterValidator = v.object({
  search: v.optional(v.string()),
  tagIds: v.optional(v.array(v.string())),
  /** "all": every tag; "any": at least one. Default "all". */
  tagMode: v.optional(v.union(v.literal("all"), v.literal("any"))),
  withoutTags: v.optional(v.boolean()),
  correspondentId: v.optional(v.string()),
  typeId: v.optional(v.string()),
  from: v.optional(v.string()),
  to: v.optional(v.string()),
})

/**
 * Spread into the app schema next to `systemTables`. Two halves:
 * the archive (docDocuments and its labels) and signing (docTemplates,
 * docSubmissions, docSubmitters, docSigningEvents). A completed submission
 * files its signed PDF into the archive.
 */
export const documentsTables = {
  docTags: defineTable({
    name: v.string(),
    color: v.string(),
    /** New uploads get every inbox tag until someone reviews them. */
    isInbox: v.boolean(),
    /** Absent: everyone with read access sees the label. Present: restricted to these users and roles. */
    access: v.optional(tagAccessValidator),
    /** Set on labels the module manages itself: "email" is the label of archived mail. */
    system: v.optional(v.literal("email")),
    ...rule,
  }).index("by_name", ["name"]),

  docCorrespondents: defineTable({ name: v.string(), ...rule }).index("by_name", ["name"]),

  docTypes: defineTable({ name: v.string(), ...rule }).index("by_name", ["name"]),

  docCustomFields: defineTable({
    name: v.string(),
    type: customFieldTypeValidator,
    options: v.array(v.string()),
    position: v.number(),
  }).index("by_name", ["name"]),

  docDocuments: defineTable({
    title: v.string(),
    storageId: v.id("_storage"),
    thumbnailId: v.optional(v.id("_storage")),
    /** Page images for text recognition of scanned PDFs (rendered by the uploader). */
    ocrImageIds: v.array(v.id("_storage")),
    fileName: v.string(),
    mimeType: v.string(),
    size: v.number(),
    sha256: v.string(),
    pageCount: v.optional(v.number()),
    /** Recognised text: from the PDF's text layer, or from AI on scans and photos. */
    content: v.string(),
    contentSource: v.union(v.literal("pdf"), v.literal("ai"), v.literal("manual"), v.literal("none")),
    processing: v.union(v.literal("queued"), v.literal("done"), v.literal("failed")),
    processingError: v.optional(v.string()),
    /** Date of the document itself (YYYY-MM-DD), not of the upload. */
    documentDate: v.optional(v.string()),
    correspondentId: v.optional(v.id("docCorrespondents")),
    typeId: v.optional(v.id("docTypes")),
    tagIds: v.array(v.id("docTags")),
    /** { [customFieldId]: value } */
    custom: v.record(v.string(), v.any()),
    /** Archive serial number: increasing, never reused. */
    asn: v.number(),
    searchText: v.string(),
    trashed: v.boolean(),
    /** Set when the document came from a completed signing submission. */
    submissionId: v.optional(v.id("docSubmissions")),
    addedBy: v.string(),
    /** Shared with these users / roles: then only they (plus label grants, uploader, admins) see it. */
    sharedUserIds: v.optional(v.array(v.string())),
    sharedRoleIds: v.optional(v.array(v.string())),
    /** Set on documents filed from a received email (Resend email id); attachments carry `parentId`. */
    emailKey: v.optional(v.string()),
    parentId: v.optional(v.id("docDocuments")),
    updatedAt: v.number(),
  })
    .index("by_trashed", ["trashed"])
    .index("by_email", ["emailKey"])
    .index("by_parent", ["parentId"])
    .index("by_sha", ["sha256"])
    .index("by_asn", ["asn"])
    .index("by_correspondent", ["correspondentId", "trashed"])
    .index("by_type", ["typeId", "trashed"])
    .searchIndex("search", { searchField: "searchText", filterFields: ["trashed", "correspondentId", "typeId"] }),

  docNotes: defineTable({
    documentId: v.id("docDocuments"),
    body: v.string(),
    createdBy: v.string(),
    authorName: v.string(),
  }).index("by_document", ["documentId"]),

  docSavedViews: defineTable({
    name: v.string(),
    filters: viewFilterValidator,
    showInSidebar: v.boolean(),
    position: v.number(),
  }).index("by_position", ["position"]),

  docTemplates: defineTable({
    name: v.string(),
    storageId: v.id("_storage"),
    fileName: v.string(),
    sha256: v.string(),
    pages: v.array(pageSizeValidator),
    roles: v.array(v.string()),
    fields: v.array(signingFieldValidator),
    /** The archive document it was made from, if any. */
    documentId: v.optional(v.id("docDocuments")),
    archived: v.boolean(),
    createdBy: v.string(),
    updatedAt: v.number(),
  }).index("by_archived", ["archived"]),

  docSubmissions: defineTable({
    templateId: v.id("docTemplates"),
    name: v.string(),
    /** Snapshot: later template edits never change what was sent. */
    storageId: v.id("_storage"),
    sha256: v.string(),
    roles: v.array(v.string()),
    fields: v.array(signingFieldValidator),
    status: v.union(...SUBMISSION_STATUSES.map((s) => v.literal(s))),
    /** Signers sign one after another, in role order. */
    ordered: v.boolean(),
    message: v.optional(v.string()),
    expiresAt: v.optional(v.number()),
    locale: v.union(v.literal("lt"), v.literal("en")),
    signedStorageId: v.optional(v.id("_storage")),
    signedSha256: v.optional(v.string()),
    documentId: v.optional(v.id("docDocuments")),
    finalizeError: v.optional(v.string()),
    createdBy: v.string(),
    createdByName: v.string(),
    completedAt: v.optional(v.number()),
  })
    .index("by_status", ["status"])
    .index("by_template", ["templateId"]),

  docSubmitters: defineTable({
    submissionId: v.id("docSubmissions"),
    role: v.number(),
    name: v.string(),
    email: v.string(),
    /** SHA-256 of the signing link's token; the token itself is only in the email. */
    tokenHash: v.string(),
    /** SHA-256 of the link in the "everyone signed" email (view and download only). */
    downloadTokenHash: v.optional(v.string()),
    status: v.union(...SUBMITTER_STATUSES.map((s) => v.literal(s))),
    values: v.record(v.string(), v.any()),
    sentAt: v.optional(v.number()),
    openedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    userAgent: v.optional(v.string()),
    declineReason: v.optional(v.string()),
  })
    .index("by_token", ["tokenHash"])
    .index("by_download_token", ["downloadTokenHash"])
    .index("by_submission", ["submissionId", "role"]),

  docSigningEvents: defineTable({
    submissionId: v.id("docSubmissions"),
    submitterId: v.optional(v.id("docSubmitters")),
    kind: v.union(
      v.literal("created"),
      v.literal("sent"),
      v.literal("send_failed"),
      v.literal("opened"),
      v.literal("completed"),
      v.literal("declined"),
      v.literal("cancelled"),
      v.literal("finalized"),
      v.literal("finalize_failed"),
    ),
    at: v.number(),
    detail: v.optional(v.string()),
  }).index("by_submission", ["submissionId", "at"]),

  /** Inboxes whose received mail is not filed into the archive (on by default: rows only for changes). */
  docInboxArchive: defineTable({ inboxId: v.string(), store: v.boolean(), updatedAt: v.number() }).index("by_inbox", ["inboxId"]),

  /** Received emails being filed (between the ingest delivery and `_fileEmail`): the inboxes they reached. */
  docEmailQueue: defineTable({ emailKey: v.string(), inboxNames: v.array(v.string()), createdAt: v.number() }).index("by_email", ["emailKey"]),

  /** Single row: the last archive serial number handed out. */
  docCounters: defineTable({ key: v.string(), value: v.number() }).index("by_key", ["key"]),
}
