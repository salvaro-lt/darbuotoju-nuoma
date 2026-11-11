import type { ReactNode } from "react"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

/*
 * Loading placeholders shaped like the final layout. Each route's loading.tsx
 * and the view's "Convex data not here yet" state render the same component, so
 * the sequence loading.tsx → page → data never shifts anything: real content
 * takes over exactly the boxes these occupied (and fades in, `animate-fade-in`).
 * Heights follow the real elements: text-2xl line = h-8, text-sm = h-5,
 * text-xs = h-4, controls and buttons = h-8, small buttons = h-7.
 * Server-safe (no hooks): usable from loading.tsx directly.
 */

const range = (n: number) => Array.from({ length: n }, (_, i) => i)

/** Root of every placeholder: announced as busy, findable as `[data-skeleton]`. */
function Busy({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div data-skeleton aria-busy="true" className={className}>
      {children}
    </div>
  )
}

/** A text line: a box with the line's height holding a shorter bar, like real text. */
function Line({ box, bar, className }: { box: string; bar: string; className?: string }) {
  return (
    <div className={cn("flex items-center", box, className)}>
      <Skeleton className={cn("rounded", bar)} />
    </div>
  )
}

/** components/app/page-header.tsx: title, lead lines, action buttons. */
export function PageHeaderSkeleton({ lead = 1, actions = [] }: { lead?: 0 | 1 | 2; actions?: string[] }) {
  return (
    <div data-skeleton aria-hidden className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0 flex-1">
        <Line box="h-8" bar="h-6 w-48 max-w-full" />
        {lead > 0 && (
          <div className="mt-1 grid max-w-[60ch]">
            <Line box="h-5" bar="h-3.5 w-full" />
            {lead > 1 && <Line box="h-5" bar="h-3.5 w-2/3" />}
          </div>
        )}
      </div>
      {actions.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {actions.map((w, i) => (
            <Skeleton key={i} className={cn("h-8 rounded-lg", w)} />
          ))}
        </div>
      )}
    </div>
  )
}

/** The ghost "← Back" button above detail pages (Button size="sm", -ml-2). */
export function BackLinkSkeleton({ className = "mb-4" }: { className?: string }) {
  return (
    <div data-skeleton aria-hidden className={className}>
      <Skeleton className="h-7 w-28 rounded-lg" />
    </div>
  )
}

/** A row of filter controls (tabs, selects, search): each h-8, widths per control. */
export function FilterBarSkeleton({ items, className = "mb-4" }: { items: string[]; className?: string }) {
  return (
    <div data-skeleton aria-hidden className={cn("flex flex-wrap items-center gap-3", className)}>
      {items.map((w, i) => (
        <Skeleton key={i} className={cn("h-8 rounded-lg", w)} />
      ))}
    </div>
  )
}

/** components/app/data-table.tsx while `rows` is undefined: header h-10, rows h-12. */
export function TableSkeleton({ columns, rows = 3 }: { columns: number; rows?: number }) {
  return (
    <Busy className="overflow-hidden rounded-xl border bg-card">
      <div className="flex h-10 items-center gap-4 border-b bg-muted/50 px-4">
        {range(columns).map((j) => (
          <div key={j} className="flex-1">
            <Skeleton className="h-3 w-16 max-w-full rounded" />
          </div>
        ))}
      </div>
      {range(rows).map((i) => (
        <div key={i} className="flex h-12 items-center gap-4 border-b px-4 last:border-b-0">
          {range(columns).map((j) => (
            <div key={j} className="flex-1">
              <Skeleton className="h-4 w-3/4 rounded" />
            </div>
          ))}
        </div>
      ))}
    </Busy>
  )
}

/** Inbox-style list: icon, subject + time, sender, one body line, status badge. */
export function ListRowsSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <Busy className="divide-y overflow-hidden rounded-xl border bg-card">
      {range(rows).map((i) => (
        <div key={i} className="flex items-start gap-3 px-4 py-3">
          <Skeleton className="mt-0.5 size-8 shrink-0 rounded-lg" />
          <div className="grid min-w-0 flex-1 gap-0.5">
            <div className="flex items-center justify-between gap-3">
              <Line box="h-5" bar="h-3.5 w-1/2" className="flex-1" />
              <Skeleton className="h-3 w-20 rounded" />
            </div>
            <Line box="h-4" bar="h-3 w-1/3" />
            <Line box="h-5" bar="h-3.5 w-3/4" />
          </div>
          <Skeleton className="h-5 w-16 shrink-0 rounded-full" />
        </div>
      ))}
    </Busy>
  )
}

/** A vertical stack of equal blocks (runs, feed items). */
export function StackSkeleton({ count = 4, item = "h-16", className = "grid gap-2" }: { count?: number; item?: string; className?: string }) {
  return (
    <Busy className={className}>
      {range(count).map((i) => (
        <Skeleton key={i} className={cn("rounded-xl", item)} />
      ))}
    </Busy>
  )
}

/** A grid of cards (automations). */
export function CardGridSkeleton({ count = 3, item = "h-48", className = "grid gap-4 md:grid-cols-2 xl:grid-cols-3" }: { count?: number; item?: string; className?: string }) {
  return <StackSkeleton count={count} item={item} className={className} />
}

/* ---------- Automations ---------- */

/** app/app/automations/[id]: text back link, icon + name + badges header, tabs, panel. */
export function AutomationDetailSkeleton() {
  return (
    <Busy>
      <Line box="mb-2 h-5" bar="h-3.5 w-24" />
      <div className="mb-6 flex flex-wrap items-start gap-4">
        <Skeleton className="size-11 rounded-lg" />
        <div className="min-w-0 flex-1">
          <Line box="h-8" bar="h-6 w-64 max-w-full" />
          <Line box="mt-1 h-5" bar="h-3.5 w-80 max-w-full" />
          <div className="mt-2 flex gap-1.5">
            <Skeleton className="h-5 w-12 rounded-full" />
            <Skeleton className="h-5 w-20 rounded-full" />
            <Skeleton className="h-5 w-32 rounded" />
          </div>
        </div>
      </div>
      <Skeleton className="mb-4 h-8 w-80 max-w-full rounded-lg" />
      <Skeleton className="h-96 rounded-xl" />
    </Busy>
  )
}

/** Review queue: run list on the left, the open run on the right. */
export function ReviewSkeleton() {
  return (
    <Busy className="grid gap-4 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
      <div className="grid content-start gap-2">
        {range(4).map((i) => (
          <Skeleton key={i} className="h-16 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-96 rounded-xl" />
    </Busy>
  )
}
