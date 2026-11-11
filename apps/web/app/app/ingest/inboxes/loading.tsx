import { CardGridSkeleton, PageHeaderSkeleton } from "@/components/app/skeletons"

export default function Loading() {
  return (
    <>
      <PageHeaderSkeleton actions={["w-32"]} />
      <CardGridSkeleton item="h-40" />
    </>
  )
}
