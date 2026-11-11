import { FilterBarSkeleton, PageHeaderSkeleton, StackSkeleton } from "@/components/app/skeletons"

export default function Loading() {
  return (
    <>
      <PageHeaderSkeleton />
      <FilterBarSkeleton items={["w-full sm:w-52"]} />
      <StackSkeleton />
    </>
  )
}
