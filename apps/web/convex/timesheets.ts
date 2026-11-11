// Timesheets area (packages/staffing/src/timesheets, module `staffing-timesheets`):
// own daily hours, week approval, client timesheet import + reconciliation,
// late timesheet reminders (n8n `dr-nuoma-tabelio-priminimas`, daily cron in
// convex/crons.ts) and the subcontractor export.
//
// Demo data (dev only, after staffing:_seedDemo):
//   npx convex run timesheets:_seedDemo            (skips if entries exist)
//   npx convex run timesheets:_seedDemo '{"reset":true}'
import { defineTimesheets } from "@digimuza/staffing"
import { system } from "./system"

export const {
  overview,
  weekGrid,
  listApprovedHours,
  listClientSheets,
  getReconciliation,
  getClientSheetFileUrl,
  listSubcontractors,
  subcontractorTimesheet,
  saveEntry,
  fillWeek,
  approveWeek,
  reopenWeek,
  generateClientSheetUploadUrl,
  importClientSheet,
  retryAiParse,
  addClientRows,
  removeClientRow,
  mapClientName,
  resolveLine,
  deleteClientSheet,
  saveSettings,
  sendReminder,
  // DIG-111: worker self-entry (public, token only: /h/<token>), links, three sources
  workerPortal,
  saveMyHours,
  flagMyDay,
  clearMyFlag,
  listWorkerLinks,
  createWorkerLinks,
  regenerateWorkerLink,
  sendWorkerLink,
  threeWayWeek,
  // DIG-111: disputes
  listDisputes,
  getDispute,
  createDispute,
  setDisputeStatus,
  addDisputeNote,
  // DIG-111: client PDFs by email (Gavimas consumer `timesheets`, convex/automationsConfig.ts)
  listIntake,
  listReceivedPdfEmails,
  importReceivedEmail,
  assignIntake,
  confirmSheetReview,
  // internal
  _workerLinkPayload,
  _sendWorkerLink,
  _workerLinkSent,
  _matchIntake,
  _intakeCreateSheet,
  _intakeFailed,
  _processIntake,
  _dailyReminders,
  _reminderPayload,
  _sendReminder,
  _reminderResult,
  _aiContext,
  _parseWithAi,
  _applyAiRows,
  _seedDemo,
} = defineTimesheets(system, { functionsModule: "timesheets" })
