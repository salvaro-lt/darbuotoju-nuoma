"use client"
import { KeyRound } from "lucide-react"
import { StatusBadge } from "@/components/app/status-badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useT } from "@/lib/i18n/client"
import { cn } from "@/lib/utils"
import { CopyButton } from "./copy-button"
import type { PersonOption } from "./audit-filters"
import { absoluteTime, relativeTime } from "./time"
import type { AuditRow } from "./use-audit-feed"

/** Success stays quiet; denied and failed stand out in a long list. */
export const RESULT_TONE = { success: "neutral", denied: "failed", failed: "failed" } as const

export function ResultBadge({ result }: { result: AuditRow["result"] }) {
  const { t } = useT()
  return <StatusBadge tone={RESULT_TONE[result] ?? "neutral"}>{t(`audit.result.${result}`)}</StatusBadge>
}

/** Who acted: a person (name + email), an API key and its owner, the system, or nobody. */
export function Actor({ row, people, compact }: { row: AuditRow; people: Map<string, PersonOption>; compact?: boolean }) {
  const { t } = useT()
  if (row.actorKind === "system") return <span className="text-muted-foreground">{t("audit.actor.system")}</span>
  if (row.actorKind === "anonymous" || !row.actorUserId) return <span className="text-muted-foreground">{t("audit.actor.anonymous")}</span>
  const person = people.get(row.actorUserId)
  const name = person?.name ?? row.actorUserId
  return (
    <div className="grid min-w-0 leading-tight">
      <span className={cn("truncate", person ? "font-medium" : "font-mono text-xs")}>{name}</span>
      {row.apiKeyId ? (
        <span className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
          <KeyRound className="size-3 shrink-0" />
          <span className="truncate">{t("audit.actor.apiKey")}</span>
        </span>
      ) : (
        !compact && person?.email && person.email !== name && <span className="truncate text-xs text-muted-foreground">{person.email}</span>
      )}
    </div>
  )
}

const short = (id: string) => (id.length > 10 ? `${id.slice(0, 8)}…` : id)

interface Props {
  rows: AuditRow[] | undefined
  people: Map<string, PersonOption>
  label: (row: AuditRow) => string
  moduleOf: (row: AuditRow) => string
  now: number
  selectedKey?: string
  onOpen: (row: AuditRow) => void
}

/**
 * Dense audit list. A row opens the detail panel (the action cell is the
 * keyboard target); target and operation columns give way on narrow screens.
 */
export function AuditTable({ rows, people, label, moduleOf, now, selectedKey, onOpen }: Props) {
  const { t, locale } = useT()
  const head = "h-10 px-3 text-xs font-medium text-muted-foreground first:pl-4 last:pr-4"
  const cell = "px-3 py-2 first:pl-4 last:pr-4"
  return (
    <div className="overflow-hidden rounded-xl border bg-card" role="region" aria-label={t("audit.title")} aria-busy={rows === undefined}>
      <Table className="min-w-[38rem] table-fixed">
        <TableHeader className="bg-muted/50">
          <TableRow className="hover:bg-transparent">
            <TableHead className={cn(head, "w-24 sm:w-28")}>{t("audit.col.time")}</TableHead>
            <TableHead className={cn(head, "w-40 sm:w-44 lg:w-52")}>{t("audit.col.actor")}</TableHead>
            <TableHead className={head}>{t("audit.col.action")}</TableHead>
            <TableHead className={cn(head, "hidden w-48 lg:table-cell")}>{t("audit.col.target")}</TableHead>
            <TableHead className={cn(head, "w-24 sm:w-28")}>{t("audit.col.result")}</TableHead>
            <TableHead className={cn(head, "hidden w-36 md:table-cell")}>{t("audit.col.operation")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows === undefined
            ? Array.from({ length: 8 }, (_, i) => (
                <TableRow key={i} className="hover:bg-transparent">
                  <TableCell className={cn(cell, "h-12")}>
                    <Skeleton className="h-4 w-16" />
                  </TableCell>
                  <TableCell className={cell}>
                    <Skeleton className="h-4 w-28" />
                  </TableCell>
                  <TableCell className={cell}>
                    <Skeleton className="h-4 w-3/5" />
                  </TableCell>
                  <TableCell className={cn(cell, "hidden lg:table-cell")}>
                    <Skeleton className="h-4 w-28" />
                  </TableCell>
                  <TableCell className={cell}>
                    <Skeleton className="h-5 w-16 rounded-full" />
                  </TableCell>
                  <TableCell className={cn(cell, "hidden md:table-cell")}>
                    <Skeleton className="h-4 w-20" />
                  </TableCell>
                </TableRow>
              ))
            : rows.map((row) => (
                <TableRow key={row.key} data-state={row.key === selectedKey ? "selected" : undefined} className="cursor-pointer" onClick={() => onOpen(row)}>
                  <TableCell className={cn(cell, "h-12 text-muted-foreground tabular-nums")}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <time dateTime={new Date(row.at).toISOString()} className="whitespace-nowrap">
                          {relativeTime(row.at, now, locale)}
                        </time>
                      </TooltipTrigger>
                      <TooltipContent>{absoluteTime(row.at, locale)}</TooltipContent>
                    </Tooltip>
                  </TableCell>
                  <TableCell className={cell}>
                    <Actor row={row} people={people} compact />
                  </TableCell>
                  <TableCell className={cell}>
                    <button
                      type="button"
                      className="grid w-full min-w-0 rounded-sm text-left leading-tight outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                      onClick={(e) => {
                        e.stopPropagation()
                        onOpen(row)
                      }}
                    >
                      <span className="truncate font-medium">{label(row)}</span>
                      <span className="truncate text-xs text-muted-foreground">{moduleOf(row)}</span>
                    </button>
                  </TableCell>
                  <TableCell className={cn(cell, "hidden lg:table-cell")}>
                    <div className="grid min-w-0 leading-tight">
                      <span className="truncate font-mono text-xs">{row.targetId}</span>
                      <span className="truncate text-xs text-muted-foreground">{row.targetType}</span>
                    </div>
                  </TableCell>
                  <TableCell className={cell}>
                    <ResultBadge result={row.result} />
                  </TableCell>
                  <TableCell className={cn(cell, "hidden md:table-cell")}>
                    <div className="flex items-center gap-1">
                      <span className="truncate font-mono text-xs text-muted-foreground" title={row.operationId}>
                        {short(row.operationId)}
                      </span>
                      <CopyButton value={row.operationId} label={t("audit.col.operation")} />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
        </TableBody>
      </Table>
    </div>
  )
}
