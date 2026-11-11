"use client"
// Open state of the command palette, shared by the dialog (mounted once in
// app/app/layout.tsx) and the sidebar button, which are siblings in the tree.
import { useSyncExternalStore } from "react"

let open = false
const listeners = new Set<() => void>()

function subscribe(fn: () => void) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function setPaletteOpen(next: boolean) {
  if (open === next) return
  open = next
  for (const fn of listeners) fn()
}

export const openPalette = () => setPaletteOpen(true)
export const togglePalette = () => setPaletteOpen(!open)

export function usePaletteOpen() {
  return useSyncExternalStore(
    subscribe,
    () => open,
    () => false,
  )
}

const noop = () => () => {}

/** "⌘" on Apple platforms, "Ctrl" elsewhere; null during SSR so the hint renders after hydration. */
export function useModKey(): "⌘" | "Ctrl" | null {
  return useSyncExternalStore(
    noop,
    () => (/Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent) ? "⌘" : "Ctrl"),
    () => null,
  )
}
