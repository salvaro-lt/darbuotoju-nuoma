"use client"
import { systemErrorOf } from "@digimuza/system-core/react"
import { useConvex } from "convex/react"
import type { FunctionReturnType } from "convex/server"
import { useEffect, useState } from "react"
import { useAction } from "@/components/app/use-action"
import { api } from "@/convex/_generated/api"
import { matchesClient, parseFilter, toQueryArgs, type AuditQueryArgs, type AuditUrlFilter } from "./filters"

export type AuditRow = FunctionReturnType<typeof api.system.listAudit>["items"][number]
type Client = ReturnType<typeof useConvex>

/** Server page size, rows wanted per "load more", and server pages per load at most. */
const PAGE = 100
const WANT = 50
const MAX_ROUNDS = 12

export interface FeedError {
  code: string
  operationId: string | null
}

interface Feed {
  /** Search string the state belongs to; a different one means a new search is loading. */
  key: string
  args: AuditQueryArgs
  rows: AuditRow[]
  cursor: string | null
  done: boolean
  /** The last load hit MAX_ROUNDS without filling a page: more may exist further back. */
  exhausted: boolean
  error: FeedError | null
}

const toError = (e: unknown): FeedError => {
  const se = systemErrorOf(e)
  return { code: se?.code ?? "unknown", operationId: se?.operationId ?? null }
}

/**
 * Collects matching rows from `listAudit`. With module, prefix, time or result
 * filters a server page can be short or empty while `done` is false, so this
 * keeps paging until it has `want` rows, the log ends, or `maxRounds` pages.
 */
export async function collectAudit(
  client: Client,
  args: AuditQueryArgs,
  filter: AuditUrlFilter,
  start: { cursor: string | null; want: number; maxRounds: number; pageSize?: number; isCancelled?: () => boolean; onPage?: (rows: number) => void },
) {
  const rows: AuditRow[] = []
  let cursor = start.cursor
  let done = false
  for (let round = 0; round < start.maxRounds; round++) {
    const page = await client.query(api.system.listAudit, { ...args, cursor, limit: start.pageSize ?? PAGE })
    if (start.isCancelled?.()) break
    for (const r of page.items) if (matchesClient(filter, r)) rows.push(r)
    cursor = page.cursor
    done = page.done || !page.cursor
    start.onPage?.(rows.length)
    if (done || rows.length >= start.want) break
  }
  return { rows, cursor, done, exhausted: !done && rows.length < start.want }
}

/**
 * "Load more" audit feed for the filter in `search` (a URL query string; add a
 * refresh nonce to reload). Not live: new events appear on refresh.
 */
export function useAuditFeed(search: string) {
  const client = useConvex()
  const [feed, setFeed] = useState<Feed | null>(null)
  // Later pages fail with a toast (code + operation ID) and keep the rows already shown.
  const { run, busy: loadingMore } = useAction()

  useEffect(() => {
    let cancelled = false
    const filter = parseFilter(new URLSearchParams(search))
    const args = toQueryArgs(filter, Date.now())
    collectAudit(client, args, filter, { cursor: null, want: WANT, maxRounds: MAX_ROUNDS })
      .then((r) => !cancelled && setFeed({ key: search, args, ...r, error: null }))
      .catch((e: unknown) => !cancelled && setFeed({ key: search, args, rows: [], cursor: null, done: true, exhausted: false, error: toError(e) }))
    return () => {
      cancelled = true
    }
  }, [client, search])

  const current = feed?.key === search ? feed : null

  async function loadMore() {
    if (!current || current.done || loadingMore) return
    const filter = parseFilter(new URLSearchParams(search))
    const r = await run(() => collectAudit(client, current.args, filter, { cursor: current.cursor, want: WANT, maxRounds: MAX_ROUNDS }))
    if (r) setFeed((f) => (f && f.key === search ? { ...f, rows: [...f.rows, ...r.rows], cursor: r.cursor, done: r.done, exhausted: r.exhausted } : f))
  }

  return {
    rows: current?.rows,
    done: current?.done ?? false,
    exhausted: current?.exhausted ?? false,
    error: current?.error ?? null,
    loading: !current,
    loadingMore,
    loadMore,
  }
}
