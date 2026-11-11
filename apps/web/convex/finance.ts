// The finance business module from @digimuza/system-core. Every function guards
// itself (permission, module enabled, role view) and audits its writes.
import { defineFinance } from "@digimuza/system-core/finance"
import { system } from "./system"

export const { listInvoices, createInvoice, approveInvoice, bulkApproveInvoices } = defineFinance(system)
