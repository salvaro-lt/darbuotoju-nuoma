import { PageHeaderSkeleton, TableSkeleton } from "@/components/app/skeletons"

// Fallback for pages without their own loading.tsx (admin, settings, account):
// most of them are a header over a table.
export default function Loading() {
  return (
    <>
      <PageHeaderSkeleton />
      <TableSkeleton columns={4} />
    </>
  )
}
