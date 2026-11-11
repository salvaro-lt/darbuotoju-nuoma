"use client"
// Debounced record search over api.search.search. One-shot queries (not a live
// subscription): results stay put while the user moves through them, the
// previous results stay visible while the next query loads, and failures go
// through useAction() (toast with the error code and operation ID).
import type { SearchResult } from "@digimuza/system-core/search"
import { useConvex } from "convex/react"
import { useEffect, useEffectEvent, useState } from "react"
import { useAction } from "@/components/app/use-action"
import { api } from "@/convex/_generated/api"

export const SEARCH_MIN = 2
export const SEARCH_MAX = 100
const DEBOUNCE_MS = 200

interface Settled {
  query: string
  result: SearchResult | undefined
  failed: boolean
}

export function useRecordSearch(input: string, enabled: boolean) {
  const convex = useConvex()
  const { run } = useAction()
  const query = input.trim()
  const active = enabled && query.length >= SEARCH_MIN && query.length <= SEARCH_MAX
  const [settled, setSettled] = useState<Settled>({ query: "", result: undefined, failed: false })
  const [attempt, setAttempt] = useState(0)

  const search = useEffectEvent(async (q: string, isCurrent: () => boolean) => {
    let result: SearchResult | undefined
    try {
      result = await run(() => convex.query(api.search.search, { query: q }))
    } finally {
      if (isCurrent()) setSettled((s) => ({ query: q, result: result ?? s.result, failed: result === undefined }))
    }
  })

  useEffect(() => {
    if (!active) return
    let current = true
    const timer = setTimeout(() => void search(query, () => current), DEBOUNCE_MS)
    return () => {
      current = false
      clearTimeout(timer)
    }
  }, [active, query, attempt])

  const fresh = active && settled.query === query
  return {
    active,
    /** Last results, possibly for an earlier query while the next one loads. */
    result: active ? settled.result : undefined,
    loading: active && !fresh,
    failed: fresh && settled.failed,
    retry: () => {
      setSettled((s) => ({ ...s, query: "" }))
      setAttempt((n) => n + 1)
    },
  }
}
