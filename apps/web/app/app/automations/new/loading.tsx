import { CardGridSkeleton, PageHeaderSkeleton } from "@/components/app/skeletons"

export default function Loading() {
  return (
    <>
      <div data-skeleton aria-hidden className="mb-2 h-5" />
      <PageHeaderSkeleton />
      <CardGridSkeleton count={2} item="h-64" className="grid gap-4 lg:grid-cols-2" />
    </>
  )
}
