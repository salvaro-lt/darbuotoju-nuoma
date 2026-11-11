// `@digimuza/documents`: a document archive with labels (in the spirit of
// Paperless-ngx) and e-signing (in the spirit of DocuSeal) for system-core apps.
//
//   // modules/index.ts
//   import { documents } from "@digimuza/documents"
//   export const appModules = [..., documents]
//   // convex/schema.ts
//   export default defineSchema({ ...systemTables, ...documentsTables })
//   // convex/documents.ts
//   export const { listDocuments, createDocument, sendSubmission, … } = defineDocuments(system, {
//     signingUrl: (token) => `${SITE_URL}/sign/${token}`,
//     deliver: sendMail,
//   })
import type { ConvexSystem } from "@digimuza/system-core/convex"
import { defineArchive, type ArchiveOptions } from "./archive"
import { defineSigning, type SigningOptions } from "./signing-functions"

export { documents, DocumentsFlags, DocumentsPermissions, DOCUMENTS_MODULE_ID } from "./manifest"
export { documentsTables, CUSTOM_FIELD_TYPES, type CustomFieldType } from "./tables"
export { documentsTools, documentsSearchTool, documentsListSubmissionsTool } from "./ai-tools"
export * from "./matching"
export * from "./signing"
export type {
  CustomFieldView,
  DocumentDetail,
  DocumentListResult,
  DocumentNoteView,
  DocumentsLabels,
  DocumentView,
  LabelKind,
  LabelView,
  SavedViewView,
  TagView,
} from "./archive"
export type { SigningEventView, SigningMail, SigningSession, SubmissionDetail, SubmissionView, SubmitterView, TemplateDetail, TemplateView } from "./signing-functions"
export type { ViewFilters, DocumentId, TemplateId, SubmissionId, SubmitterId } from "./shared"

export interface DocumentsOptions extends ArchiveOptions, SigningOptions {
  /** Module path (relative to `convex/`) where the functions are exported. Default "documents". */
  functionsModule?: string
}

/** The documents module's Convex functions. Re-export them from the app's `convex/documents.ts`. */
export function defineDocuments(system: ConvexSystem, options: DocumentsOptions) {
  const functionsModule = options.functionsModule ?? "documents"
  return { ...defineArchive(system, { ...options, functionsModule }), ...defineSigning(system, { ...options, functionsModule }) }
}

export type DocumentsFunctions = ReturnType<typeof defineDocuments>
