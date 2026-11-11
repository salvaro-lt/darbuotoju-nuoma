import { CrmPermissions } from "@digimuza/crm/manifest"
import type { ReactNode } from "react"
import { requireSession } from "@/lib/system-server"

// Routing only: every CRM function re-checks permission and module state in Convex.
export default async function CrmLayout({ children }: { children: ReactNode }) {
  await requireSession({ permission: CrmPermissions.read })
  return children
}
