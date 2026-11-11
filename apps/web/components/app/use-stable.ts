import { useState } from "react"

/**
 * Keeps the last loaded value while a live query reloads with new arguments
 * (a filter or tab change), so the list stays on screen instead of flashing
 * back to its skeleton. `stale` is true until the new result arrives: dim the
 * list a little meanwhile (`data-stale` + `transition-opacity`).
 */
export function useStable<T>(value: T | undefined): { value: T | undefined; stale: boolean } {
  const [last, setLast] = useState(value)
  // Adjusting state from the previous render (react.dev → "you might not need an effect").
  if (value !== undefined && value !== last) setLast(value)
  return { value: value ?? last, stale: value === undefined && last !== undefined }
}
