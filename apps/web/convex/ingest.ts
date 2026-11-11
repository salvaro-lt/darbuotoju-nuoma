// Gavimas (ingest) from @digimuza/system-core: the Resend integration, inboxes and
// the signed webhook. Public functions guard themselves (ingest:* permissions,
// module enabled, role view). `receiveResendWebhook` takes no session: Resend's
// signature proves the caller (app/api/ingest/resend). `_runSetup` is the setup
// button for `npx convex run ingest:_runSetup '{}'`.
// The names are the integration contract (INGEST_*_FUNCTIONS in system-core).
import { defineIngest } from "@digimuza/system-core/ingest"
import { ingestConsumers } from "./automationsConfig"
import { system } from "./system"

export const {
  getIntegration,
  listInboxes,
  getInbox,
  listEmails,
  getEmail,
  listLinkTargets,
  createInbox,
  setInboxStatus,
  deleteInbox,
  linkInbox,
  setManagedDomain,
  refreshIntegration,
  runSetup,
  enableReceivingSubdomain,
  refreshReceivingDomain,
  sendTestEmail,
  receiveResendWebhook,
  _authorize,
  _runSetup,
  _enableReceivingSubdomain,
  _createInbox,
  _setupState,
  _saveSnapshot,
  _applyWebhook,
  _applyDomain,
  _adoptInboxes,
  _prepareTest,
  _recordTest,
  _startEvent,
  _processEvent,
  _requeueEvent,
  _storeEmails,
} = defineIngest(system, { consumers: ingestConsumers }).functions
