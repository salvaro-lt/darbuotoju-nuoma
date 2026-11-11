import { CardGridSkeleton, PageHeaderSkeleton } from "@/components/app/skeletons"

// Renders under the automations section nav (layout.tsx), which stays.
export default function Loading() {
  return (
    <>
      <PageHeaderSkeleton />
      <CardGridSkeleton />
    </>
  )
}
