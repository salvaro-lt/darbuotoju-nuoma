import { Suspense } from "react"
import { ObjectWorkspace } from "../_components/object-workspace"

export default async function CrmObjectPage({ params }: { params: Promise<{ object: string }> }) {
  const { object } = await params
  return (
    <Suspense>
      <ObjectWorkspace objectKey={object} />
    </Suspense>
  )
}
