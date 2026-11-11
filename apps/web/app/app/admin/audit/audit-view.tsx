"use client"
import { auditModuleOf } from "@digimuza/system-core/audit"
import { SystemPermissions as P } from "@digimuza/system-core/modules"
import { useCan, useCurrentUser } from "@digimuza/system-core/react"
import { useQuery } from "convex/react"
import { CircleAlert, Download, Loader2, Lock, RotateCw, ScrollText, X } from "lucide-react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useMemo, useState } from "react"
import { AuditDetail } from "@/components/audit/audit-detail"
import { AuditFilters, type PersonOption } from "@/components/audit/audit-filters"
import { AuditTable } from "@/components/audit/audit-table"
import { CopyButton } from "@/components/audit/copy-button"
import { DEFAULT_RANGE, filterToSearch, isFiltered, parseFilter, type AuditUrlFilter } from "@/components/audit/filters"
import { actionLabel, actionTypeLabel, moduleLabel, threadIdOf, type Lookup } from "@/components/audit/labels"
import { useNow } from "@/components/audit/time"
import { useAuditExport } from "@/components/audit/use-audit-export"
import { useAuditFeed, type AuditRow } from "@/components/audit/use-audit-feed"
import { EmptyState } from "@/components/app/empty-state"
import { PageHeader } from "@/components/app/page-header"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { api } from "@/convex/_generated/api"
import { useT } from "@/lib/i18n/client"
import { MESSAGES } from "@/lib/i18n/messages"

export function AuditView() {
  const { t, locale } = useT()
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const filter = useMemo(() => parseFilter(params), [params])
  const search = filterToSearch(filter)
  const [nonce, setNonce] = useState(0)
  const feed = useAuditFeed(nonce ? `${search}&_r=${nonce}` : search)
  const exporter = useAuditExport()
  const now = useNow()
  const me = useCurrentUser()

  const facets = useQuery(api.system.listAuditFacets, {})
  // Names need users:user:read; without it actors show as IDs and the person filter hides.
  const canUsers = useCan(P.usersRead)
  const users = useQuery(api.system.listUsers, canUsers ? { limit: 200 } : "skip")
  const people = useMemo(() => (users?.items ?? []).map<PersonOption>((u) => ({ id: u.id, name: u.displayName ?? u.email, email: u.email })), [users])
  const peopleById = useMemo(() => new Map(people.map((p) => [p.id, p])), [people])

  const [open, setOpen] = useState<AuditRow | null>(null)

  const dict = MESSAGES[locale] as Record<string, string>
  const tr: Lookup = (k) => dict[k] ?? null
  const label = (row: AuditRow) => actionLabel(tr, row)
  const moduleOf = (row: AuditRow) => moduleLabel(tr, auditModuleOf(row.action))
  const num = new Intl.NumberFormat(locale === "lt" ? "lt-LT" : "en-GB")

  const setFilter = (next: AuditUrlFilter) => {
    const q = filterToSearch(next)
    router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false })
  }
  const reload = () => setNonce((n) => n + 1)
  const filtered = isFiltered(filter)

  const actions =
    exporter.progress !== null ? (
      <div className="flex items-center gap-2" role="status" aria-live="polite">
        <Loader2 className="size-4 animate-spin text-muted-foreground" />
        <span className="text-sm text-muted-foreground tabular-nums">
          {t("audit.export.progress")} {num.format(exporter.progress)}
        </span>
        <Button variant="outline" onClick={exporter.cancel}>
          <X />
          {t("common.cancel")}
        </Button>
      </div>
    ) : (
      <>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" aria-label={t("audit.refresh")} onClick={reload} disabled={feed.loading}>
              <RotateCw />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t("audit.refresh")}</TooltipContent>
        </Tooltip>
        <Button variant="outline" onClick={() => void exporter.start(filter)} disabled={!!feed.error || feed.rows?.length === 0}>
          <Download />
          {t("audit.export")}
        </Button>
      </>
    )

  let body
  if (feed.error?.code === "FORBIDDEN") {
    body = <EmptyState icon={<Lock />} title={t("audit.denied.title")} body={t("audit.denied.body")} />
  } else if (feed.error) {
    body = (
      <EmptyState
        icon={<CircleAlert />}
        title={t("audit.error.title")}
        body={t("audit.error.body")}
        action={
          <div className="grid justify-items-center gap-3">
            {feed.error.operationId && (
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                {t("state.operation")} <span className="font-mono text-foreground">{feed.error.operationId}</span>
                <CopyButton value={feed.error.operationId} label={t("state.operation")} />
              </div>
            )}
            <Button onClick={reload}>{t("common.retry")}</Button>
          </div>
        }
      />
    )
  } else if (feed.rows?.length === 0 && !feed.exhausted) {
    body = filtered ? (
      <EmptyState
        icon={<ScrollText />}
        title={t("audit.emptyFiltered.title")}
        body={t("audit.emptyFiltered.body")}
        action={
          <Button variant="outline" onClick={() => setFilter({ range: DEFAULT_RANGE })}>
            {t("audit.filter.clear")}
          </Button>
        }
      />
    ) : (
      <EmptyState icon={<ScrollText />} title={t("audit.empty.title")} body={t("audit.empty.body")} />
    )
  } else {
    body = (
      <>
        {feed.rows?.length !== 0 && <AuditTable rows={feed.rows} people={peopleById} label={label} moduleOf={moduleOf} now={now} selectedKey={open?.key} onOpen={setOpen} />}
        {feed.rows && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
            <span className="tabular-nums">
              {t("audit.shown")} {num.format(feed.rows.length)}
            </span>
            {feed.done ? (
              feed.rows.length > 0 && <span>{t("audit.end")}</span>
            ) : (
              <div className="flex flex-wrap items-center gap-3">
                {feed.exhausted && <span>{t("audit.scannedMore")}</span>}
                <Button variant="outline" onClick={() => void feed.loadMore()} disabled={feed.loadingMore}>
                  {feed.loadingMore && <Loader2 className="animate-spin" />}
                  {feed.loadingMore ? t("audit.loading") : feed.exhausted ? t("audit.keepLooking") : t("audit.loadMore")}
                </Button>
              </div>
            )}
          </div>
        )}
      </>
    )
  }

  return (
    <>
      <PageHeader title={t("audit.title")} lead={t("audit.lead")} actions={actions} />
      <AuditFilters filter={filter} onChange={setFilter} people={canUsers ? people : undefined} facets={facets} tr={tr} label={(action) => actionTypeLabel(tr, action)} />
      {body}
      <AuditDetail row={open} onClose={() => setOpen(null)} filter={filter} people={peopleById} tr={tr} label={label} moduleOf={moduleOf} threadId={open ? threadIdOf(open, me?.userId) : null} />
    </>
  )
}
