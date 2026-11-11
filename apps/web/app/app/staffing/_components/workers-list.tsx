"use client"
import type { WorkerSource, WorkerStatus } from "@digimuza/staffing"
import { StaffingPermissions } from "@digimuza/staffing/manifest"
import { Can } from "@digimuza/system-core/react"
import { useQuery } from "convex/react"
import { Plus, Search, Users } from "lucide-react"
import Link from "next/link"
import { useDeferredValue, useState } from "react"
import { EmptyState } from "@/components/app/empty-state"
import { PageHeader } from "@/components/app/page-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { useT } from "@/lib/i18n/client"
import type { MessageKey } from "@/lib/i18n/messages"
import { CertBadge, Disabled, NativeSelect, useStaffingEnabled, useTradeName, useTrades, workerHref } from "./staffing-ui"
import { WorkerFormDialog } from "./worker-form"

export function WorkersList() {
  const { t } = useT()
  const enabled = useStaffingEnabled()
  const trades = useTrades() ?? []
  const tradeName = useTradeName()
  const [search, setSearch] = useState("")
  const [tradeId, setTradeId] = useState("")
  const [status, setStatus] = useState<"" | WorkerStatus>("active")
  const [source, setSource] = useState<"" | WorkerSource>("")
  const [creating, setCreating] = useState(false)
  const q = useDeferredValue(search)
  const workers = useQuery(
    api.staffing.listWorkers,
    enabled
      ? {
          ...(q.trim() ? { search: q } : {}),
          ...(tradeId ? { tradeId: tradeId as Id<"staffing_trades"> } : {}),
          ...(status ? { status } : {}),
          ...(source ? { source } : {}),
        }
      : "skip",
  )
  if (!enabled) return <Disabled />

  return (
    <div>
      <PageHeader
        title={t("staffing.workers.title")}
        lead={t("staffing.workers.lead")}
        actions={
          <Can permission={StaffingPermissions.workerCreate}>
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus />
              {t("staffing.workers.new")}
            </Button>
          </Can>
        }
      />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-8" placeholder={t("staffing.workers.searchPlaceholder")} aria-label={t("staffing.common.search")} value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <NativeSelect aria-label={t("staffing.workers.col.trades")} value={tradeId} onChange={setTradeId}>
          <option value="">{t("staffing.workers.anyTrade")}</option>
          {trades.map((tr) => (
            <option key={tr.id} value={tr.id}>
              {tradeName(tr)}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect aria-label={t("staffing.common.status")} value={status} onChange={(v) => setStatus(v as WorkerStatus | "")}>
          <option value="">{t("staffing.workers.anyStatus")}</option>
          <option value="active">{t("staffing.workerStatus.active")}</option>
          <option value="inactive">{t("staffing.workerStatus.inactive")}</option>
        </NativeSelect>
        <NativeSelect aria-label={t("staffing.workers.col.source")} value={source} onChange={(v) => setSource(v as WorkerSource | "")}>
          <option value="">{t("staffing.workers.anySource")}</option>
          <option value="own">{t("staffing.source.own")}</option>
          <option value="subcontractor">{t("staffing.source.subcontractor")}</option>
        </NativeSelect>
        {workers && (
          <span className="ml-auto text-sm text-muted-foreground tabular-nums">
            {t("staffing.workers.count")}: {workers.length}
          </span>
        )}
      </div>
      {!workers ? (
        <Skeleton className="h-96 w-full rounded-xl" />
      ) : workers.length === 0 ? (
        <EmptyState icon={<Users />} title={t("staffing.workers.empty")} body={t("staffing.workers.emptyBody")} />
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="px-4">{t("staffing.workers.col.name")}</TableHead>
                <TableHead>{t("staffing.workers.col.trades")}</TableHead>
                <TableHead>{t("staffing.workers.col.nationality")}</TableHead>
                <TableHead>{t("staffing.workers.col.source")}</TableHead>
                <TableHead>{t("staffing.workers.col.phone")}</TableHead>
                <TableHead>{t("staffing.workers.col.certs")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {workers.map((w) => (
                <TableRow key={w.id} className={w.status === "inactive" ? "text-muted-foreground" : undefined}>
                  <TableCell className="px-4 font-medium">
                    <Link href={workerHref(w.id)} className="hover:underline">
                      {w.lastName} {w.firstName}
                    </Link>
                    {w.status === "inactive" && <span className="ml-2 text-xs">({t("staffing.workerStatus.inactive")})</span>}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {w.trades.map((tr) => (
                        <Badge key={tr.id} variant="outline" title={`${tradeName(tr)} · ${t(`staffing.level.${tr.level}` as MessageKey)}`}>
                          {tr.code}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell>{w.nationality}</TableCell>
                  <TableCell className="whitespace-nowrap">{w.subcontractorName ?? t(`staffing.source.${w.source}` as MessageKey)}</TableCell>
                  <TableCell className="whitespace-nowrap tabular-nums">{w.phone}</TableCell>
                  <TableCell>
                    <CertBadge status={w.certStatus} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {creating && <WorkerFormDialog onClose={() => setCreating(false)} />}
    </div>
  )
}
