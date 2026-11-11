import type { ReactNode } from "react"
import { IngestSectionNav } from "@/components/ingest/section-nav"
import { IngestGate } from "@/components/ingest/shared"

// Each page checks its permission; Convex re-checks every call.
export default function IngestLayout({ children }: { children: ReactNode }) {
  return (
    <IngestGate>
      <IngestSectionNav />
      {children}
    </IngestGate>
  )
}
