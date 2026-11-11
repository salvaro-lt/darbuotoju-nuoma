import { StaffingInvoicingPermissions } from "@digimuza/staffing/invoicing/manifest"
import { requireSession } from "@/lib/system-server"
import { PrintableInvoice } from "../../../app/invoicing/_components/print"

// Printable invoice outside the app shell (no sidebar): browser "Print → Save as PDF".
export default async function PrintInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  await requireSession({ permission: StaffingInvoicingPermissions.invoiceRead })
  const { id } = await params
  return <PrintableInvoice invoiceId={id} />
}
