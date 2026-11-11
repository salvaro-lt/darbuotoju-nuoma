import { PageHeaderSkeleton, StackSkeleton } from "@/components/app/skeletons"

// Renders under the ingest section nav (layout.tsx), which stays.
export default function Loading() {
  return (
    <>
      <PageHeaderSkeleton actions={["w-56"]} />
      <StackSkeleton count={3} item="h-40" className="grid gap-4" />
    </>
  )
}
