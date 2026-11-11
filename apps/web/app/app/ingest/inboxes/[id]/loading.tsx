import { BackLinkSkeleton, PageHeaderSkeleton, StackSkeleton } from "@/components/app/skeletons"

export default function Loading() {
  return (
    <>
      <BackLinkSkeleton />
      <PageHeaderSkeleton lead={0} actions={["w-24", "w-24"]} />
      <StackSkeleton count={3} item="h-24" />
    </>
  )
}
