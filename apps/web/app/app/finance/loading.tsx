import { PageHeaderSkeleton, TableSkeleton } from "@/components/app/skeletons"

export default function Loading() {
  return (
    <>
      <PageHeaderSkeleton actions={["w-36"]} />
      <TableSkeleton columns={5} />
    </>
  )
}
