"use client"
import { KeyRound, MessageSquare, User, Workflow } from "lucide-react"
import Link from "next/link"
import type { ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { useT } from "@/lib/i18n/client"
import { Actor, ResultBadge } from "./audit-table"
import type { PersonOption } from "./audit-filters"
import { CopyButton } from "./copy-button"
import { filterToSearch, type AuditUrlFilter } from "./filters"
import type { Lookup } from "./labels"
import { absoluteTime } from "./time"
import type { AuditRow } from "./use-audit-feed"

const pretty = (v: unknown) => JSON.stringify(v, null, 2)
const href = (f: AuditUrlFilter) => {
  const q = filterToSearch(f)
  return q ? `/app/admin/audit?${q}` : "/app/admin/audit"
}

function Field({ label, children, copy }: { label: string; children: ReactNode; copy?: string }) {
  return (
    <div className="grid grid-cols-[7.5rem_minmax(0,1fr)] items-start gap-3 py-2">
      <dt className="pt-0.5 text-xs text-muted-foreground">{label}</dt>
      <dd className="flex min-w-0 items-start gap-1 text-sm">
        <div className="min-w-0 flex-1 break-words">{children}</div>
        {copy && <CopyButton value={copy} label={label} />}
      </dd>
    </div>
  )
}

function Block({ title, value }: { title: string; value: string }) {
  return (
    <section className="grid gap-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">{title}</h3>
        <CopyButton value={value} label={title} />
      </div>
      <pre className="max-h-80 overflow-auto rounded-lg border bg-muted/40 p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words">{value}</pre>
    </section>
  )
}

interface Props {
  row: AuditRow | null
  onClose: () => void
  filter: AuditUrlFilter
  people: Map<string, PersonOption>
  tr: Lookup
  label: (row: AuditRow) => string
  moduleOf: (row: AuditRow) => string
  threadId: string | null
}

/** Everything recorded for one audit event, with links to related entries. */
export function AuditDetail({ row, onClose, filter, people, tr, label, moduleOf, threadId }: Props) {
  const { t, locale } = useT()
  // Related views keep the chosen period, except "same operation", which spans all time.
  const period: AuditUrlFilter = { range: filter.range, from: filter.from, to: filter.to }
  const reasonText = row?.reason ? (tr(`error.${row.reason}`) ?? null) : null

  return (
    <Sheet open={!!row} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-lg">
        {row && (
          <>
            <SheetHeader className="gap-1.5 border-b pr-12">
              <SheetTitle className="text-base leading-snug text-balance">{label(row)}</SheetTitle>
              <SheetDescription className="flex flex-wrap items-center gap-2 tabular-nums">
                <ResultBadge result={row.result} />
                {absoluteTime(row.at, locale)}
              </SheetDescription>
            </SheetHeader>
            <div className="grid gap-6 px-4 py-4">
              <dl className="divide-y">
                <Field label={t("audit.detail.action")} copy={row.action}>
                  <span className="font-mono text-xs">{row.action}</span>
                </Field>
                <Field label={t("audit.detail.module")}>{moduleOf(row)}</Field>
                <Field label={t("audit.detail.actor")} copy={row.actorUserId}>
                  <Actor row={row} people={people} />
                </Field>
                {row.apiKeyId && (
                  <Field label={t("audit.detail.apiKey")} copy={row.apiKeyId}>
                    <span className="font-mono text-xs">{row.apiKeyId}</span>
                  </Field>
                )}
                <Field label={t("audit.detail.target")} copy={row.targetId}>
                  <span className="font-mono text-xs">{row.targetId}</span>
                  <span className="block text-xs text-muted-foreground">{row.targetType}</span>
                </Field>
                <Field label={t("audit.detail.operation")} copy={row.operationId}>
                  <span className="font-mono text-xs">{row.operationId}</span>
                </Field>
                <Field label={t("audit.detail.eventId")} copy={row.key}>
                  <span className="font-mono text-xs text-muted-foreground">{row.key}</span>
                </Field>
              </dl>

              {row.reason && (
                <section className="grid gap-1">
                  <h3 className="text-sm font-medium">{t("audit.detail.reason")}</h3>
                  {reasonText && <p className="text-sm">{reasonText}</p>}
                  <p className="font-mono text-xs text-muted-foreground">{row.reason}</p>
                </section>
              )}

              {row.changes && Object.keys(row.changes).length > 0 ? (
                <Block title={t("audit.detail.changes")} value={pretty(row.changes)} />
              ) : (
                <section className="grid gap-1">
                  <h3 className="text-sm font-medium">{t("audit.detail.changes")}</h3>
                  <p className="text-sm text-muted-foreground">{t("audit.detail.noChanges")}</p>
                </section>
              )}

              <Separator />
              <section className="grid gap-2">
                <h3 className="text-sm font-medium">{t("audit.detail.related")}</h3>
                <div className="flex flex-wrap gap-2">
                  <Button asChild size="sm" variant="outline">
                    <Link href={href({ range: "all", op: row.operationId })} onClick={onClose}>
                      <Workflow />
                      {t("audit.detail.sameOperation")}
                    </Link>
                  </Button>
                  {row.actorUserId && (
                    <Button asChild size="sm" variant="outline">
                      <Link href={href({ ...period, actor: row.actorUserId })} onClick={onClose}>
                        <User />
                        {t("audit.detail.samePerson")}
                      </Link>
                    </Button>
                  )}
                  {row.apiKeyId && (
                    <Button asChild size="sm" variant="outline">
                      <Link href={href({ ...period, key: row.apiKeyId })} onClick={onClose}>
                        <KeyRound />
                        {t("audit.detail.sameKey")}
                      </Link>
                    </Button>
                  )}
                  {threadId && (
                    <Button asChild size="sm" variant="outline">
                      <Link href={`/app/ai/${encodeURIComponent(threadId)}`}>
                        <MessageSquare />
                        {t("audit.detail.openThread")}
                      </Link>
                    </Button>
                  )}
                </div>
              </section>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
