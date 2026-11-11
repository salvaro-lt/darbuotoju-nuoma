import { StaffingInvoicingPermissions } from "@digimuza/staffing/invoicing/manifest"
import { requireSession } from "@/lib/system-server"
import { PurchasesView } from "../_components/purchases"

export default async function PurchasesPage() {
  await requireSession({ permission: StaffingInvoicingPermissions.invoiceRead })
  return <PurchasesView />
}
