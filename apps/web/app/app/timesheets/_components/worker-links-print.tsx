"use client"
// DIG-111: a printable sheet of QR codes, one per worker, for the coordinator
// to hand out on site (outside the app shell: /print/timesheets/links/<project>).
import { useQuery } from "convex/react"
import { Printer } from "lucide-react"
import { useMemo } from "react"
import { encode } from "uqr"
import { brand } from "@/brand"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { useT } from "@/lib/i18n/client"
import { workerLinkUrl } from "./timesheets-ui"

/** A QR code as one SVG path (dark modules in the current text colour). */
export function QrSvg({ value, className }: { value: string; className?: string }) {
  const { path, size } = useMemo(() => {
    const qr = encode(value, { ecc: "M", border: 2 })
    let d = ""
    qr.data.forEach((row, y) => row.forEach((on, x) => (d += on ? `M${x} ${y}h1v1h-1z` : "")))
    return { path: d, size: qr.size }
  }, [value])
  return (
    <svg viewBox={`0 0 ${size} ${size}`} className={className} shapeRendering="crispEdges" role="img" aria-label={value}>
      <rect width={size} height={size} className="fill-background" />
      <path d={path} className="fill-foreground" />
    </svg>
  )
}

export function WorkerLinksPrint({ projectId }: { projectId: string }) {
  const { t } = useT()
  const data = useQuery(api.timesheets.listWorkerLinks, { projectId: projectId as Id<"staffing_projects"> })
  if (data === undefined) return <Skeleton className="m-6 h-96" />
  if (data === null) return <p className="p-6 text-sm text-muted-foreground">{t("staffing.common.notFound")}</p>
  const rows = data.rows.filter((r) => r.link)
  return (
    <div className="mx-auto max-w-4xl bg-background p-6 text-foreground print:p-0">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3 border-b-2 border-foreground pb-3">
        <div>
          <div className="font-mono text-xs text-muted-foreground">
            {data.project.code} · {data.project.clientName}
          </div>
          <h1 className="font-stencil-title text-3xl">{t("wl.qrTitle")}</h1>
          <p className="text-sm text-muted-foreground">
            {data.project.name} · {brand.name}
          </p>
        </div>
        <Button size="sm" className="print:hidden" onClick={() => window.print()}>
          <Printer />
          {t("wl.qrPrint")}
        </Button>
      </header>
      <p className="mb-4 text-sm">{t("wl.qrLead")}</p>
      <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        {rows.map((r) => {
          const url = workerLinkUrl(r.link!.token)
          return (
            <li key={r.workerId} className="flex break-inside-avoid flex-col items-center gap-2 rounded-md border border-dashed p-3 text-center">
              <QrSvg value={url} className="size-36" />
              <div className="font-semibold leading-tight">{r.workerName}</div>
              <div className="text-xs text-muted-foreground">{r.trade}</div>
              <div className="break-all font-mono text-[0.6rem] text-muted-foreground">{url.replace(/^https?:\/\//, "")}</div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
