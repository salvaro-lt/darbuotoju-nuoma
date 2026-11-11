// Invoicing area of staffing (packages/staffing/src/invoicing, module
// `staffing-invoicing`): billable hours, invoice drafts per client period,
// approval and numbering (DN-YYYY-NNNN), SitePro (B1) CSV export, payments,
// debts with reminders through n8n (`dr-nuoma-mokejimo-priminimas`, daily in
// convex/crons.ts), project costs and profitability.
//
// Demo data (dev only, after staffing:_seedDemo):
//   npx convex run invoicing:_seedDemo            (skips if invoices exist)
//   npx convex run invoicing:_seedDemo '{"reset":true}'
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
  // dev only
  _seedDemo,
} = defineInvoicing(system, {
  numberPrefix: "DN",
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
