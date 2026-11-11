// Invoicing area (`staffing-invoicing`): billable hours (approved timesheets +
// manual corrections), invoices, the closed-process chain, SitePro export,
// payments, debts and reminders, purchase invoice approval, project costs and
// profitability per project, client and worker.
export { staffingInvoicing, StaffingInvoicingPermissions, STAFFING_INVOICING_MODULE_ID, type StaffingInvoicingPermission } from "./manifest"
export * from "./tables"
export * from "./pure"
export { billableHours, surchargesFor, buildDraft, allocateInvoiceNumber, type InvoiceView, type InvoiceDoc, type InvoiceId, type BillableHours } from "./operations"
export { chainOverview, chainAlerts, profitData, clientProfit, workerProfit, type ChainClientRow, type ChainPeriod, type ChainAlert, type ClientProfitRow, type WorkerProfitRow } from "./insights"
export { definePurchases, queuePurchaseEmail, type PurchaseView, type PurchaseEmail, type PurchaseDoc, type SupplierDoc } from "./purchases"
export { purchasesIngestConsumer, PURCHASES_CONSUMER_ID } from "./email"
export { defineInvoicing, type InvoicingFunctions, type InvoicingOptions, type InvoiceDetail, type ProfitRow, type SellerInfo } from "./functions"
