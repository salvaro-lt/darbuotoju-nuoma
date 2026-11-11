// Automations from @digimuza/system-core: On <channel> → AI extraction → insert.
// Public functions guard themselves (automations:* permissions, module enabled,
// role view). `ingestWebhook` / `ingestResendWebhook` take no session: the
// automation's token or Resend's signature proves the caller (app/api/automations).
// The names are the integration contract (AUTOMATIONS_*_FUNCTIONS in system-core).
import { defineAutomations } from "@digimuza/system-core/automations"
import { automationsOptions } from "./automationsConfig"
import { system } from "./system"

export const {
  listAutomations,
  getAutomation,
  listAutomationTargets,
  listAutomationRoles,
  validateAutomation,
  listRuns,
  getRun,
  countPendingRuns,
  getInboundSetup,
  createAutomation,
  updateAutomation,
  setAutomationEnabled,
  archiveAutomation,
  reviewRun,
  bulkReviewRuns,
  rotateHookSecret,
  testExtract,
  testAutomation,
  submitTestRun,
  ingestWebhook,
  ingestResendWebhook,
  _authorize,
  _rotateHookSecret,
  _startProcessing,
  _completeExtraction,
  _failRun,
  _processRun,
  _testExtractTool,
  _testPrepare,
  _testActions,
} = defineAutomations(system, automationsOptions).functions
