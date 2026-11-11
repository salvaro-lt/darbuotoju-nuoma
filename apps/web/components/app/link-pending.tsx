"use client"
import { useLinkStatus } from "next/link"
import { createPortal } from "react-dom"
import { cn } from "@/lib/utils"

/**
 * Navigation feedback for a `<Link>` (render it inside one): a fixed-size dot
 * that lights up while the click is pending, plus a thin progress bar at the
 * top of the viewport. Both only show if navigation takes longer than ~120 ms
 * (prefetched routes with a loading.tsx usually don't), and neither changes
 * layout.
 */
export function LinkPending({ className }: { className?: string }) {
  const { pending } = useLinkStatus()
  return (
    <>
      <span
        aria-hidden
        data-pending={pending || undefined}
        className={cn(
          "size-1.5 shrink-0 rounded-full bg-primary opacity-0 transition-opacity duration-(--duration-fast) data-pending:animate-pulse data-pending:opacity-100 data-pending:delay-100",
          className,
        )}
      />
      {pending && typeof document !== "undefined" && createPortal(<TopProgress />, document.body)}
    </>
  )
}

/** Indeterminate bar along the top edge. */
export function TopProgress() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-x-0 top-0 z-[100] h-0.5 animate-fade-in overflow-hidden [animation-delay:120ms]">
      <div className="h-full w-2/5 animate-pending-bar rounded-full bg-primary" />
    </div>
  )
}
