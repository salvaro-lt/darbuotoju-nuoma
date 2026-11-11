"use client"
import { useLayoutEffect, useRef } from "react"

const DURATION = 700
const easeOut = (t: number) => 1 - (1 - t) ** 3
// Module-level so the effect doesn't restart on every parent render.
const whole = (n: number) => String(Math.round(n))

/**
 * A number that counts up from 0 once, when it first mounts; later (live)
 * changes just show the new value. Screen readers and reduced-motion users get
 * the final value straight away: the animated digits are aria-hidden and the
 * real value sits next to them for assistive tech.
 */
export function CountUp({ value, format = whole }: { value: number; format?: (n: number) => string }) {
  const ref = useRef<HTMLSpanElement>(null)
  // When the count started; -Infinity = done or skipped. Kept across effect
  // re-runs (live updates, Strict Mode) so the count runs once and is never cut short.
  const t0 = useRef<number | null>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    if (t0.current === null) {
      const skip = value === 0 || window.matchMedia("(prefers-reduced-motion: reduce)").matches
      t0.current = skip ? -Infinity : performance.now()
    }
    const start = t0.current
    let frame = 0
    const tick = () => {
      const p = Math.min(1, Math.max(0, (performance.now() - start) / DURATION))
      el.textContent = format(value * easeOut(p))
      if (p < 1) frame = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(frame)
  }, [value, format])

  return (
    <>
      <span ref={ref} aria-hidden>
        {format(value)}
      </span>
      <span className="sr-only">{format(value)}</span>
    </>
  )
}
