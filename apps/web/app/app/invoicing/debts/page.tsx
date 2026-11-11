import { StaffingInvoicingPermissions } from "@digimuza/staffing/invoicing/manifest"
import { requireSession } from "@/lib/system-server"
import { DebtsView } from "../_components/debts"

export default async function DebtsPage() {
  await requireSession({ permission: StaffingInvoicingPermissions.invoiceRead })
  return <DebtsView />
}
