import { StaffingInvoicingPermissions } from "@digimuza/staffing/invoicing/manifest"
import { requireSession } from "@/lib/system-server"
import { PortfolioView } from "../_components/profit"

export default async function ProfitabilityPage() {
  await requireSession({ permission: StaffingInvoicingPermissions.profitRead })
  return <PortfolioView />
}
