"use client"
import { StaffingTeamsPermissions } from "@digimuza/staffing/teams/manifest"
import { REQUEST_STATUSES, type RequestStatus } from "@digimuza/staffing/teams/matching"
import { Can } from "@digimuza/system-core/react"
import { useQuery } from "convex/react"
import { Plus, UsersRound } from "lucide-react"
import Link from "next/link"
import { useState } from "react"
import { EmptyState } from "@/components/app/empty-state"
import { PageHeader } from "@/components/app/page-header"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { api } from "@/convex/_generated/api"
import { useT } from "@/lib/i18n/client"
import type { MessageKey } from "@/lib/i18n/messages"
import { NativeSelect, Period } from "../../staffing/_components/staffing-ui"
import { useTeamsEnabled } from "./teams-nav"
import { RequestStatusBadge, TeamCount } from "./teams-ui"

export function RequestsList() {
  const { t, locale } = useT()
  const enabled = useTeamsEnabled()
  const [status, setStatus] = useState<"" | RequestStatus>("")
  const rows = useQuery(api.teams.listRequests, enabled ? (status ? { status } : {}) : "skip")
  if (!enabled) return <p className="text-sm text-muted-foreground">{t("teams.disabled")}</p>
  const newButton = (
    <Can permission={StaffingTeamsPermissions.requestWrite}>
      <Button size="sm" asChild>
        <Link href="/app/teams/new">
          <Plus />
          {t("teams.list.new")}
        </Link>
      </Button>
    </Can>
  )
  return (
    <div>
      <PageHeader title={t("teams.list.title")} lead={t("teams.list.lead")} actions={newButton} />
      <div className="mb-3 flex gap-2">
        <NativeSelect aria-label={t("staffing.common.status")} value={status} onChange={(v) => setStatus(v as RequestStatus | "")}>
          <option value="">{t("teams.list.anyStatus")}</option>
          {REQUEST_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`teams.status.${s}` as MessageKey)}
            </option>
          ))}
        </NativeSelect>
      </div>
      {!rows ? (
        <Skeleton className="h-64 w-full rounded-xl" />
      ) : rows.length === 0 ? (
        <EmptyState icon={<UsersRound />} title={t("teams.list.empty")} body={t("teams.list.emptyBody")} action={newButton} />
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="px-4">{t("teams.list.client")}</TableHead>
                <TableHead>{t("teams.list.needs")}</TableHead>
                <TableHead>{t("teams.list.site")}</TableHead>
                <TableHead>{t("teams.list.period")}</TableHead>
                <TableHead>{t("staffing.common.status")}</TableHead>
                <TableHead className="text-right">{t("teams.list.team")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="px-4">
                    <Link href={`/app/teams/${r.id}`} className="font-medium hover:underline">
                      {r.clientName}
                    </Link>
                    <div className="max-w-[28ch] truncate text-xs text-muted-foreground">{r.projectLabel}</div>
                  </TableCell>
                  <TableCell className="text-sm">
                    {r.lines.map((l) => (
                      <div key={l.tradeId} className="whitespace-nowrap">
                        <span className="tabular-nums">{l.count} ×</span> {locale === "en" ? l.tradeNameEn : l.tradeName}
                      </div>
                    ))}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {r.site}, {r.country}
                  </TableCell>
                  <TableCell>
                    <Period from={r.startDate} to={r.endDate} />
                  </TableCell>
                  <TableCell>
                    <RequestStatusBadge status={r.status} />
                  </TableCell>
                  <TableCell className="text-right">{r.picked === null ? <span className="tabular-nums text-muted-foreground">– / {r.needed}</span> : <TeamCount picked={r.picked} needed={r.needed} />}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
