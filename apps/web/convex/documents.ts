// The documents module (packages/documents): an archive with tags,
// correspondents, document types, custom fields, matching rules and saved
// views, plus e-signing (templates → submissions → signed PDF). Every
// function guards itself (permission, module enabled, flags, role view) and
// audits its writes. The public signing functions (getSigningSession,
// markSigningOpened, submitSignature, declineSignature) take no session: the
// signing link's token proves the signer.
//
// Per-client configuration lives here:
// - `signingUrl`: the public page app/sign/[token].
// - `deliver`: signing invitations go out through convex/mail.ts.
// - `font`: a TrueType font with Lithuanian letters for signed PDFs (public/fonts).
// - `aiModel`: vision model for scans and `auto` labels (DOCUMENTS_AI_MODEL / AI_MODEL override it).
// - Feature flags (Super → Modules): documents:signing, documents:ai.
// - Roles: compose documents:viewer / documents:editor / documents:admin.
import { defineDocuments } from "@digimuza/documents"
import { getConvexEnv } from "../env"
import { sendMail } from "./mail"
import { system } from "./system"

const siteUrl = () => getConvexEnv().SITE_URL.replace(/\/+$/, "")

export const {
  // archive: labels, custom fields, saved views
  getLabels,
  createLabel,
  updateLabel,
  deleteLabel,
  testRule,
  createCustomField,
  updateCustomField,
  deleteCustomField,
  saveView,
  deleteView,
  // archive: documents and notes
  listDocuments,
  getDocument,
  generateUploadUrl,
  createDocument,
  updateDocument,
  bulkEditDocuments,
  setDocumentsTrashed,
  deleteDocuments,
  reprocessDocument,
  addNote,
  deleteNote,
  // archive: access (label grants are on createLabel / updateLabel)
  shareDocument,
  getAccessOptions,
  _processContext,
  _processDocument,
  _applyProcessing,
  _fileSignedDocument,
  // email archive: every received email (Gavimas) filed as a document, per-inbox switch
  getEmailArchive,
  setInboxArchive,
  _archiveEmail,
  _fileEmail,
  _addEmailInbox,
  // signing: templates and submissions
  listTemplates,
  getTemplate,
  generateTemplateUploadUrl,
  createTemplate,
  updateTemplate,
  setTemplateArchived,
  sendSubmission,
  listSubmissions,
  getSubmission,
  cancelSubmission,
  resendInvite,
  retryFinalize,
  // signing: public, by token
  getSigningSession,
  markSigningOpened,
  submitSignature,
  declineSignature,
  // signing: background
  _inviteContext,
  _inviteContextBySubmission,
  _deliverInvite,
  _recordDelivery,
  _finalizeContext,
  _finalizeSubmission,
  _completeFinalize,
  _failFinalize,
  _completedLinks,
  _deliverCompleted,
} = defineDocuments(system, {
  signingUrl: (token) => `${siteUrl()}/sign/${encodeURIComponent(token)}`,
  deliver: sendMail,
  font: async () => {
    try {
      const res = await fetch(`${siteUrl()}/fonts/NotoSans-Regular.ttf`)
      return res.ok ? new Uint8Array(await res.arrayBuffer()) : null
    } catch {
      return null
    }
  },
  aiModel: "cc/claude-haiku-4-5-20251001",
})
