"use client"
import { auditToCsv } from "@digimuza/system-core/audit"
import { useConvex, useMutation } from "convex/react"
import { useRef, useState } from "react"
import { toast } from "sonner"
import { useAction } from "@/components/app/use-action"
import { api } from "@/convex/_generated/api"
import { useT } from "@/lib/i18n/client"
import { localDate, toQueryArgs, type AuditUrlFilter } from "./filters"
import { collectAudit } from "./use-audit-feed"

/** Most rows one export collects; past it the user narrows the filter. */
export const EXPORT_CAP = 10_000
/** Server pages one export may read (a sparse filter scans many short pages). */
const MAX_PAGES = 1_000

function download(csv: string, name: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }))
  const a = document.createElement("a")
  a.href = url
  a.download = name
  document.body.append(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

/**
 * CSV export of the current filter: pages through `listAudit` up to EXPORT_CAP
 * rows (progress, cancel), builds the file with `auditToCsv` (BOM for Excel),
 * downloads `audit-YYYY-MM-DD.csv`, then records `audit.export`.
 */
export function useAuditExport() {
  const { t, locale } = useT()
  const client = useConvex()
  const record = useMutation(api.system.recordAuditExport)
  const { run } = useAction()
  const [progress, setProgress] = useState<number | null>(null)
  const cancelled = useRef(false)
  const num = new Intl.NumberFormat(locale === "lt" ? "lt-LT" : "en-GB")

  async function start(filter: AuditUrlFilter) {
    if (progress !== null) return
    cancelled.current = false
    setProgress(0)
    const args = toQueryArgs(filter, Date.now())
    const res = await run(async () => {
      const r = await collectAudit(client, args, filter, {
        cursor: null,
        want: EXPORT_CAP,
        maxRounds: MAX_PAGES,
        pageSize: 200,
        isCancelled: () => cancelled.current,
        onPage: (n) => setProgress(Math.min(n, EXPORT_CAP)),
      })
      if (cancelled.current) return { status: "cancelled" as const }
      const rows = r.rows.slice(0, EXPORT_CAP)
      if (rows.length === 0) return { status: "empty" as const }
      download(auditToCsv(rows, { bom: true }), `audit-${localDate(Date.now())}.csv`)
      await record({ filter: args, count: rows.length })
      return { status: "done" as const, count: rows.length, capped: !r.done }
    })
    setProgress(null)
    if (!res) return
    if (res.status === "cancelled") toast.info(t("audit.export.cancelled"))
    else if (res.status === "empty") toast.info(t("audit.export.empty"))
    else {
      toast.success(t("audit.export.done").replace("{count}", num.format(res.count)))
      if (res.capped) toast.warning(t("audit.export.capped").replace("{max}", num.format(EXPORT_CAP)), { duration: 10_000 })
    }
  }

  return {
    start,
    cancel: () => {
      cancelled.current = true
    },
    /** Rows collected so far, or null when no export runs. */
    progress,
  }
}
