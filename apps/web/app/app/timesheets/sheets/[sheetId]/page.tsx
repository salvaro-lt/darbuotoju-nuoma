import { StaffingTimesheetsPermissions } from "@digimuza/staffing/timesheets/manifest"
import { requireSession } from "@/lib/system-server"
import { Reconciliation } from "../../_components/reconciliation"

export default async function ClientSheetPage({ params }: { params: Promise<{ sheetId: string }> }) {
  await requireSession({ permission: StaffingTimesheetsPermissions.read })
  const { sheetId } = await params
  return <Reconciliation sheetId={sheetId} />
}
