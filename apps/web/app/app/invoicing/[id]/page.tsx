import { StaffingInvoicingPermissions } from "@digimuza/staffing/invoicing/manifest"
import { requireSession } from "@/lib/system-server"
import { InvoiceDetailView } from "../_components/invoices"

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  await requireSession({ permission: StaffingInvoicingPermissions.invoiceRead })
  const { id } = await params
  return <InvoiceDetailView invoiceId={id} />
}
