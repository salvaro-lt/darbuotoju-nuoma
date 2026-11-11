import { DocumentsPermissions } from "@digimuza/documents/manifest"
import type { ReactNode } from "react"
import { requireSession } from "@/lib/system-server"

// Routing only: every documents function re-checks permission, module state and flags in Convex.
export default async function DocumentsLayout({ children }: { children: ReactNode }) {
  await requireSession({ permission: DocumentsPermissions.read })
  return children
}
