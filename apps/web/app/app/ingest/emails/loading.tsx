import { ListRowsSkeleton, PageHeaderSkeleton } from "@/components/app/skeletons"

export default function Loading() {
  return (
    <>
      <PageHeaderSkeleton />
      <ListRowsSkeleton rows={5} />
    </>
  )
}
