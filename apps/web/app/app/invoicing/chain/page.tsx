import { StaffingInvoicingPermissions } from "@digimuza/staffing/invoicing/manifest"
import { requireSession } from "@/lib/system-server"
import { ChainView } from "../_components/chain"

export default async function ChainPage() {
  await requireSession({ permission: StaffingInvoicingPermissions.invoiceRead })
  return <ChainView />
}
