import { StaffingInvoicingPermissions } from "@digimuza/staffing/invoicing/manifest"
import { requireSession } from "@/lib/system-server"
import { HoursView } from "../_components/hours"

export default async function HoursPage() {
  await requireSession({ permission: StaffingInvoicingPermissions.invoiceRead })
  return <HoursView />
}
