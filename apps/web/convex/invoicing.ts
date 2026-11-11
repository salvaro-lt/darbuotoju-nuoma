// Invoicing area of staffing (packages/staffing/src/invoicing, module
// `staffing-invoicing`): billable hours (approved timesheet weeks + manual
// corrections), invoice drafts per client period, approval and numbering
// (DN-YYYY-NNNN), SitePro (B1) CSV export, payments, debts with reminders
// through n8n (`dr-nuoma-mokejimo-priminimas`), the closed-process chain with a
// daily missing-invoice check (`dr-nuoma-pranesimas` → the director), purchase
// invoice approval (Gavimas consumer in convex/automationsConfig.ts; approved
// ones go to SITEPRO_IMPORT_EMAIL), profitability per project, client, worker.
//
// Env (optional): SITEPRO_IMPORT_EMAIL, INVOICING_DIRECTOR_EMAIL, N8N_URL,
// N8N_WEBHOOK_SECRET. Without them deliveries are recorded as not configured.
//
// Demo data (dev only, after staffing:_seedDemo and timesheets:_seedDemo):
//   npx convex run invoicing:_seedDemo            (skips if invoices exist)
//   npx convex run invoicing:_seedDemo '{"reset":true}'
//   npx convex run invoicing:_simulatePurchaseEmail '{"from":"saskaitos@autonuoma.example","subject":"Sąskaita AN-1","text":"Suma: 120,00 EUR"}'
import { defineInvoicing } from "@digimuza/staffing"
import { system } from "./system"

export const {
  // invoices
  listInvoices,
  getInvoice,
  billingOverview,
  createDraft,
  refreshDraft,
  deleteDraft,
  approveInvoice,
  markSent,
  siteProExport,
  // payments, debts, reminders
  recordPayment,
  deletePayment,
  debts,
  sendReminder,
  runDueReminders,
  _dailyReminders,
  _deliverReminder,
  _reminderResult,
  // billable hours and surcharges
  listHours,
  addHours,
  deleteHours,
  setTerms,
  // costs and profitability
  addCost,
  deleteCost,
  portfolio,
  projectProfitability,
  clientProfitability,
  workerProfitability,
  setWageRate,
  // the closed process (chain) and the daily missing-invoice check
  chain,
  runChainCheck,
  _dailyChainCheck,
  _deliverChainAlert,
  _chainRunResult,
  // purchase invoices and suppliers
  listPurchases,
  getPurchaseFileUrl,
  generatePurchaseUploadUrl,
  createPurchase,
  updatePurchase,
  acceptSender,
  approvePurchase,
  rejectPurchase,
  forwardPurchase,
  _forwardPurchase,
  _purchaseForForward,
  _forwardPurchaseResult,
  listSuppliers,
  saveSupplier,
  _simulatePurchaseEmail,
  // dev only
  _seedDemo,
} = defineInvoicing(system, {
  numberPrefix: "DN",
  // A billing period that ended this many days ago without an issued invoice raises an alert.
  missingInvoiceAlertDays: 7,
  // Printed on invoices. Demo values: replace with the company's details.
  seller: {
    name: "UAB „Darbuotojų nuoma“ (demo)",
    companyCode: "300000000",
    vatCode: "LT100000000000",
    address: "Pavyzdžio g. 1, LT-92000 Klaipėda",
    bank: "Demo bankas",
    iban: "LT00 7000 0000 0000 0000",
    email: "saskaitos@example.com",
  },
})
