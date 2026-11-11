import { StaffingInvoicingPermissions } from "@digimuza/staffing/invoicing/manifest"
import { requireSession } from "@/lib/system-server"
import { InvoicesList } from "./_components/invoices"

export default async function InvoicesPage() {
  await requireSession({ permission: StaffingInvoicingPermissions.invoiceRead })
  return <InvoicesList />
}
