"use client"
// DIG-111: personal hours links of a project's workers: create, copy, email, QR list.
import type { WorkerLinkRow } from "@digimuza/staffing"
import { useMutation, useQuery } from "convex/react"
import { Copy, ExternalLink, Hand, LinkIcon, Mail, MoreHorizontal, Plus, QrCode, RefreshCw } from "lucide-react"
import Link from "next/link"
import { toast } from "sonner"
import { EmptyState } from "@/components/app/empty-state"
import { useAction } from "@/components/app/use-action"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { useT } from "@/lib/i18n/client"
import type { MessageKey } from "@/lib/i18n/messages"
import { fmt, qrListHref, useDateFormat, workerLinkUrl } from "./timesheets-ui"

export function WorkerLinks({ projectId }: { projectId: string }) {
  const { t } = useT()
  const pid = projectId as Id<"staffing_projects">
  const data = useQuery(api.timesheets.listWorkerLinks, { projectId: pid })
  const create = useMutation(api.timesheets.createWorkerLinks)
  const { run, busy } = useAction()
  if (data === undefined) return <Skeleton className="mt-3 h-64 w-full rounded-xl" />
  if (data === null) return null
  const missing = data.rows.filter((r) => !r.link).length
  return (
    <div className="mt-3 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-[65ch] text-sm text-muted-foreground">{t("wl.lead")}</p>
        <div className="flex flex-wrap gap-2">
          {missing > 0 && (
            <Button size="sm" disabled={busy} onClick={async () => {
              const r = await run(() => create({ projectId: pid }))
              if (r) toast.success(fmt(t("wl.created"), { n: r.created }))
            }}>
              <Plus />
              {t("wl.createMissing")}
            </Button>
          )}
          <Button size="sm" variant="outline" asChild>
            <Link href={qrListHref(projectId)} target="_blank">
              <QrCode />
              {t("wl.printQr")}
            </Link>
          </Button>
        </div>
      </div>
      {data.rows.length === 0 ? (
        <EmptyState icon={<LinkIcon />} title={t("wl.empty")} />
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="px-4">{t("wl.worker")}</TableHead>
                <TableHead>{t("wl.link")}</TableHead>
                <TableHead>{t("wl.activity")}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.rows.map((r) => (
                <LinkRow key={r.workerId} projectId={pid} row={r} />
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}

function LinkRow({ projectId, row }: { projectId: Id<"staffing_projects">; row: WorkerLinkRow }) {
  const { t } = useT()
  const d = useDateFormat()
  const create = useMutation(api.timesheets.createWorkerLinks)
  const send = useMutation(api.timesheets.sendWorkerLink)
  const regenerate = useMutation(api.timesheets.regenerateWorkerLink)
  const { run, busy } = useAction()
  const workerId = row.workerId as Id<"staffing_workers">
  const url = row.link ? workerLinkUrl(row.link.token) : null
  const copy = async () => {
    if (!url) return
    await navigator.clipboard.writeText(url)
    toast.success(t("wl.copied"))
  }
  return (
    <TableRow>
      <TableCell className="px-4">
        <div className="font-medium">{row.workerName}</div>
        <div className="text-xs text-muted-foreground">
          {row.trade}
          {row.email ? ` · ${row.email}` : ""}
        </div>
      </TableCell>
      <TableCell className="max-w-72">
        {row.link && url ? (
          <div className="grid gap-0.5">
            <code className="truncate font-mono text-xs text-muted-foreground" title={url}>
              /h/{row.link.token}
            </code>
            {row.link.lastSentAt && (
              <span className="text-xs text-muted-foreground">
                {fmt(t("wl.lastSent"), { date: d.stamp(row.link.lastSentAt) })}
                {row.link.lastSendStatus && ` (${t(`wl.send.${row.link.lastSendStatus}` as MessageKey)})`}
              </span>
            )}
          </div>
        ) : (
          <Badge variant="outline">{t("wl.noLink")}</Badge>
        )}
      </TableCell>
      <TableCell className="text-sm">
        {row.link?.lastActivityAt ? (
          <div className="grid gap-0.5">
            <span>{fmt(t("wl.lastActivity"), { date: d.stamp(row.link.lastActivityAt) })}</span>
            <span className="text-xs text-muted-foreground">{fmt(t("wl.recentDays"), { n: row.recentDays })}</span>
          </div>
        ) : (
          <span className="text-muted-foreground">{row.link ? t("wl.never") : ""}</span>
        )}
        {row.flags > 0 && (
          <Badge variant="outline" className="ml-0 mt-1 border-marking-foreground/40 bg-marking/20 text-marking-foreground">
            <Hand />
            {fmt(t("wl.flags"), { n: row.flags })}
          </Badge>
        )}
      </TableCell>
      <TableCell className="whitespace-nowrap pr-3 text-right">
        {row.link ? (
          <div className="inline-flex gap-1">
            <Button size="sm" variant="outline" className="h-8" onClick={copy}>
              <Copy />
              {t("wl.copy")}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="icon" variant="ghost" className="size-8" aria-label="…">
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem asChild>
                  <a href={url ?? "#"} target="_blank" rel="noreferrer">
                    <ExternalLink />
                    {t("wl.open")}
                  </a>
                </DropdownMenuItem>
                <DropdownMenuItem disabled={busy || !row.email} onSelect={() => run(() => send({ workerId }), { success: fmt(t("wl.sent"), { email: row.email ?? "" }) })}>
                  <Mail />
                  {row.email ? t("wl.send") : t("wl.noEmail")}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem disabled={busy} onSelect={() => run(() => regenerate({ workerId }), { success: t("wl.regenerated") })}>
                  <RefreshCw />
                  {t("wl.regenerate")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ) : (
          <Button size="sm" className="h-8" disabled={busy} onClick={() => run(() => create({ projectId, workerId }))}>
            <Plus />
            {t("wl.create")}
          </Button>
        )}
      </TableCell>
    </TableRow>
  )
}
