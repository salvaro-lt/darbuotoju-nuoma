import { cn } from "@/lib/utils"

/**
 * The frame ruler: the app's signature, frame numbers along a hull. Major ticks
 * every 64px carry "FR n"; `start` offsets the numbering so each page reads as
 * its own section of the hull. Purely visual (aria-hidden).
 */
export function FrameRuler({ start = 0, step = 10, count = 40, className }: { start?: number; step?: number; count?: number; className?: string }) {
  return (
    <div aria-hidden className={cn("frame-ruler relative h-3.5 w-full min-w-0 overflow-hidden select-none", className)}>
      {/* Absolute: the labels never give the ruler an intrinsic width. */}
      <div className="absolute inset-y-0 left-0 flex">
        {Array.from({ length: count }, (_, i) => (
          <span key={i} className="label-marking w-16 shrink-0 pt-[5px] pl-1 text-[9px] leading-none text-muted-foreground">
            FR {start + i * step}
          </span>
        ))}
      </div>
    </div>
  )
}

/** Vertical variant for the sidebar's outer edge. */
export function FrameRulerVertical({ start = 0, step = 10, count = 30, className }: { start?: number; step?: number; count?: number; className?: string }) {
  return (
    <div aria-hidden className={cn("frame-ruler-v pointer-events-none absolute inset-y-0 right-0 w-5 overflow-hidden select-none", className)}>
      <div className="absolute inset-x-0 top-0 flex flex-col">
        {Array.from({ length: count }, (_, i) => (
          <span key={i} className="label-marking h-16 shrink-0 pt-1 pr-2.5 text-right text-[8px] leading-none text-sidebar-foreground/45 [writing-mode:vertical-rl]">
            {start + i * step}
          </span>
        ))}
      </div>
    </div>
  )
}

/** Stable per-route number so every page gets its own stretch of hull. */
export function frameStartFor(key: string): number {
  let h = 0
  for (const c of key) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return (h % 18) * 10
}
