import { Suspense } from "react"
import { ArchiveWorkspace } from "./_components/archive-workspace"

export default function DocumentsPage() {
  return (
    <Suspense>
      <ArchiveWorkspace />
    </Suspense>
  )
}
