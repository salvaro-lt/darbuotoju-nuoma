import { FinancePermissions } from "@digimuza/system-core/finance"
import { requireSession } from "@/lib/system-server"
import { FinanceView } from "./finance-view"

export default async function FinancePage() {
  await requireSession({ permission: FinancePermissions.read })
  return <FinanceView />
}
