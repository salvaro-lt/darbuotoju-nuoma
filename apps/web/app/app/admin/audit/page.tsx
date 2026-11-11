import { SystemPermissions } from "@digimuza/system-core/modules"
import { Suspense } from "react"
import { requireSession } from "@/lib/system-server"
import { AuditView } from "./audit-view"

export default async function AuditPage() {
  await requireSession({ permission: SystemPermissions.auditRead })
  // The view reads its filters from the URL (useSearchParams).
  return (
    <Suspense>
      <AuditView />
    </Suspense>
  )
}
