import { CardGridSkeleton, PageHeaderSkeleton } from "@/components/app/skeletons"

// The dashboard: greeting, then the grid of section cards (dashboard-view.tsx).
export default function Loading() {
  return (
    <>
      <PageHeaderSkeleton />
      <CardGridSkeleton count={3} item="h-36" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" />
    </>
  )
}
